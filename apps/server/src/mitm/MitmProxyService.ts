// FILE: MitmProxyService.ts
// Purpose: Service interface for the local MITM proxy. Adapters consume this
// service to get (a) the env vars they must inject into CLI subprocesses so
// traffic routes through us, and (b) an Effect-friendly handle to the latest
// captured Anthropic rate-limit snapshot for UI consumption.

import { Effect, ServiceMap } from "effect";
import type { AnthropicRateLimitSnapshot } from "./headerCapture.ts";

export interface MitmProxyShape {
  /** True when the proxy is live and CLI subprocesses should route through it. */
  readonly enabled: boolean;
  /** `http://127.0.0.1:PORT`. Empty string when disabled. */
  readonly proxyUrl: string;
  /** Absolute path to the root CA PEM. Empty string when disabled. */
  readonly caPath: string;
  /**
   * Env vars to merge into a CLI subprocess spawn. Returns an empty object
   * when the proxy is disabled so callers can unconditionally spread it.
   */
  readonly subprocessEnv: () => Readonly<Record<string, string>>;
  /** Most recent Anthropic rate-limit snapshot, or null if none captured yet. */
  readonly latestAnthropicSnapshot: Effect.Effect<AnthropicRateLimitSnapshot | null>;
}

export class MitmProxyService extends ServiceMap.Service<
  MitmProxyService,
  MitmProxyShape
>()("t3/mitm/MitmProxyService") {}
