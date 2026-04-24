// FILE: MitmProxyLayer.ts
// Purpose: Effect layer that boots the local MITM proxy on server startup
// and exposes MitmProxyService. Honors the DPCODE_MITM_ENABLED env var — when
// set to "true"/"1"/"yes"/"on", the layer starts the proxy; otherwise it
// returns a no-op service and never opens a listener or CA on disk.
//
// Phase B1 scope: capture Anthropic rate-limit snapshots into an in-memory
// Ref. No activity emission yet — Phase B3 wires the snapshot into the UI.

import { Effect, Layer, Ref } from "effect";
import { loadOrCreateCertificateAuthority } from "./CertificateAuthority.ts";
import type { AnthropicRateLimitSnapshot } from "./headerCapture.ts";
import { captureAnthropicHeaders } from "./headerCapture.ts";
import type { MitmProxyHandle } from "./MitmProxy.ts";
import { startMitmProxy } from "./MitmProxy.ts";
import type { MitmProxyShape } from "./MitmProxyService.ts";
import { MitmProxyService } from "./MitmProxyService.ts";

const ANTHROPIC_HOST = "api.anthropic.com";

function isEnabled(): boolean {
  const raw = process.env.DPCODE_MITM_ENABLED?.toLowerCase().trim();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) || fallback;
  } catch {
    return fallback;
  }
}

function buildDisabledShape(
  latestRef: Ref.Ref<AnthropicRateLimitSnapshot | null>,
): MitmProxyShape {
  return {
    enabled: false,
    proxyUrl: "",
    caPath: "",
    subprocessEnv: () => ({}),
    latestAnthropicSnapshot: Ref.get(latestRef),
  };
}

export const MitmProxyLive = Layer.effect(
  MitmProxyService,
  Effect.gen(function* () {
    const latestRef = yield* Ref.make<AnthropicRateLimitSnapshot | null>(null);

    if (!isEnabled()) {
      yield* Effect.logInfo(
        "MITM proxy disabled via DPCODE_MITM_ENABLED — Claude rate-limit data will come only from SDK transition events.",
      );
      return MitmProxyService.of(buildDisabledShape(latestRef));
    }

    // Bootstrap CA. A failure here degrades to a no-op service instead of
    // crashing the server — losing usage telemetry is strictly better than
    // blocking startup.
    const ca = yield* Effect.tryPromise({
      try: () => loadOrCreateCertificateAuthority(),
      catch: (cause) => toMessage(cause, "CA bootstrap failed"),
    }).pipe(
      Effect.tap((created) =>
        Effect.logInfo(
          `MITM root CA ready at ${created.caCertPath} (valid through ${created.validTo.toISOString()}).`,
        ),
      ),
      Effect.catch((detail) =>
        Effect.logWarning(`MITM proxy: failed to load or create root CA: ${detail}`).pipe(
          Effect.as(null),
        ),
      ),
    );

    if (!ca) {
      return MitmProxyService.of(buildDisabledShape(latestRef));
    }

    const handle = yield* Effect.tryPromise({
      try: (): Promise<MitmProxyHandle> =>
        startMitmProxy({
          ca,
          onResponse: (observation) => {
            if (!observation.host.endsWith(ANTHROPIC_HOST)) return;
            const snapshot = captureAnthropicHeaders({
              headers: observation.headers,
              host: observation.host,
              statusCode: observation.statusCode,
            });
            if (!snapshot) return;
            // Synchronous Ref set from non-Effect callback context.
            Effect.runSync(Ref.set(latestRef, snapshot));
          },
          onError: (cause) => {
            // eslint-disable-next-line no-console
            console.warn("[mitm] proxy error:", cause);
          },
        }),
      catch: (cause) => toMessage(cause, "proxy start failed"),
    }).pipe(
      Effect.catch((detail) =>
        Effect.logWarning(`MITM proxy: failed to start listener: ${detail}`).pipe(
          Effect.as(null),
        ),
      ),
    );

    if (!handle) {
      return MitmProxyService.of(buildDisabledShape(latestRef));
    }

    yield* Effect.logInfo(`MITM proxy listening on ${handle.proxyUrl}.`);

    // Register stop() as a finalizer so the socket closes cleanly on shutdown.
    // handle.stop() swallows its own errors (proxy teardown is best-effort).
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => handle.stop()).pipe(
        Effect.tap(() => Effect.logInfo("MITM proxy stopped.")),
      ),
    );

    const subprocessEnv = (): Readonly<Record<string, string>> => ({
      HTTPS_PROXY: handle.proxyUrl,
      https_proxy: handle.proxyUrl,
      NODE_EXTRA_CA_CERTS: ca.caCertPath,
    });

    const shape: MitmProxyShape = {
      enabled: true,
      proxyUrl: handle.proxyUrl,
      caPath: ca.caCertPath,
      subprocessEnv,
      latestAnthropicSnapshot: Ref.get(latestRef),
    };
    return MitmProxyService.of(shape);
  }),
);
