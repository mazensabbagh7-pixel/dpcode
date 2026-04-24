// FILE: MitmProxy.ts
// Purpose: Local HTTPS MITM proxy. Accepts HTTP CONNECT tunnels from CLI
// subprocesses (which we direct here via HTTPS_PROXY), terminates TLS using
// leaf certificates freshly minted by our local root CA, and forwards
// decrypted HTTPS traffic to the real upstream host. On every response we
// emit the response headers to a caller-provided callback — that's how we
// capture `anthropic-ratelimit-*` without touching vendor CLIs.
//
// We do NOT log bodies. We do NOT log auth headers. The only thing we
// pull out of decrypted traffic is the response header map, which the
// caller can then filter.

import * as http from "node:http";
import * as https from "node:https";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import * as tls from "node:tls";
import forge from "node-forge";
import type { CertificateAuthority } from "./CertificateAuthority.ts";

const LEAF_VALIDITY_DAYS = 7;
const LEAF_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
// Keep leaf certs fresh but avoid regenerating per-request — 6h balances cost
// vs. cert-rotation hygiene, and any CLI reconnecting within the window reuses
// the cached secure context.

export interface MitmResponseObservation {
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
}

export interface MitmProxyHandle {
  readonly proxyUrl: string;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

interface CachedLeaf {
  readonly context: tls.SecureContext;
  readonly expiresAt: number;
}

function mintLeafContext(
  ca: CertificateAuthority,
  host: string,
): tls.SecureContext {
  // Mint a leaf certificate for `host`, signed by our root CA. The leaf's
  // subject CN + subjectAltName include the host so Node's TLS verifier
  // (which Node's own http client will use on the CLI side) accepts it.
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = keypair.publicKey;
  leaf.serialNumber = `${Date.now().toString(16)}${Math.floor(
    Math.random() * 1_000_000,
  )
    .toString(16)
    .padStart(6, "0")}`;
  leaf.validity.notBefore = new Date();
  leaf.validity.notAfter = new Date();
  leaf.validity.notAfter.setDate(
    leaf.validity.notAfter.getDate() + LEAF_VALIDITY_DAYS,
  );
  leaf.setSubject([{ name: "commonName", value: host }]);
  leaf.setIssuer(ca.caCert.subject.attributes);
  leaf.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      critical: true,
      digitalSignature: true,
      keyEncipherment: true,
    },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    {
      name: "subjectAltName",
      altNames: [{ type: 2, value: host }],
    },
  ]);
  leaf.sign(ca.caKey, forge.md.sha256.create());
  return tls.createSecureContext({
    cert: forge.pki.certificateToPem(leaf),
    key: forge.pki.privateKeyToPem(keypair.privateKey),
  });
}

function createLeafCache(ca: CertificateAuthority) {
  const cache = new Map<string, CachedLeaf>();
  return (host: string): tls.SecureContext => {
    const now = Date.now();
    const cached = cache.get(host);
    if (cached && cached.expiresAt > now) {
      return cached.context;
    }
    const context = mintLeafContext(ca, host);
    cache.set(host, { context, expiresAt: now + LEAF_CACHE_TTL_MS });
    return context;
  };
}

function inferHost(req: IncomingMessage, fallback: string): string {
  const headerHost = req.headers.host;
  if (typeof headerHost === "string" && headerHost.length > 0) {
    return headerHost.split(":")[0] ?? fallback;
  }
  return fallback;
}

export async function startMitmProxy(opts: {
  readonly ca: CertificateAuthority;
  readonly onResponse?: (observation: MitmResponseObservation) => void;
  readonly onError?: (cause: unknown) => void;
}): Promise<MitmProxyHandle> {
  const { ca, onResponse, onError } = opts;
  const leafFor = createLeafCache(ca);

  // Single shared inner HTTPS server handles every decrypted TLS connection.
  // SNICallback picks the right leaf cert on the fly based on the SNI the
  // CLI sent — that matters because we terminate TLS ourselves and need a
  // cert whose CN/SAN matches the host the CLI was trying to reach.
  const httpsServer = https.createServer({
    SNICallback: (servername, callback) => {
      try {
        callback(null, leafFor(servername));
      } catch (cause) {
        onError?.(cause);
        callback(cause instanceof Error ? cause : new Error(String(cause)));
      }
    },
  });

  httpsServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
    // After TLS termination, `req` is a plain decrypted HTTP request. We
    // forward it to the real upstream verbatim, capture the response
    // headers, then stream the response body back unchanged.
    const host = inferHost(req, "unknown");
    const upstreamReq = https.request(
      {
        host,
        port: 443,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host },
        // Node's default agent keeps connections alive; pipelining with our
        // short-lived leaf certs works fine because session state lives on
        // the upstream side, not ours.
      },
      (upstreamRes) => {
        try {
          onResponse?.({
            host,
            method: req.method ?? "GET",
            path: req.url ?? "/",
            statusCode: upstreamRes.statusCode ?? 0,
            headers: upstreamRes.headers,
          });
        } catch (cause) {
          onError?.(cause);
        }
        res.writeHead(
          upstreamRes.statusCode ?? 502,
          upstreamRes.statusMessage,
          upstreamRes.headers,
        );
        upstreamRes.pipe(res);
      },
    );
    upstreamReq.on("error", (cause) => {
      onError?.(cause);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
      }
      res.end(`MITM proxy upstream error: ${cause.message}`);
    });
    req.pipe(upstreamReq);
  });

  httpsServer.on("error", (cause) => onError?.(cause));

  // Outer HTTP server is what the CLI connects to via HTTPS_PROXY. It only
  // ever handles CONNECT — the CLI issues `CONNECT api.anthropic.com:443`
  // and we hand the socket off to the inner HTTPS server above.
  const httpServer = http.createServer((_req, res) => {
    // Non-CONNECT requests: respond 405. We don't proxy plain HTTP — we
    // are exclusively a TLS MITM for the allowlisted vendor hosts.
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("MITM proxy accepts only HTTP CONNECT requests.");
  });

  httpServer.on("connect", (req, clientSocket, head) => {
    // The CLI has opened a tunnel. Acknowledge with 200, then feed the
    // now-raw socket into the inner HTTPS server. The inner server will
    // perform the TLS handshake (presenting our leaf cert via SNICallback),
    // decrypt, and dispatch through its 'request' handler.
    clientSocket.on("error", (cause) => onError?.(cause));
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length > 0) {
      clientSocket.unshift(head);
    }
    httpsServer.emit("connection", clientSocket);
  });

  httpServer.on("error", (cause) => onError?.(cause));

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address() as AddressInfo;
  const port = address.port;
  const proxyUrl = `http://127.0.0.1:${port}`;

  const stop = () =>
    new Promise<void>((resolve) => {
      httpsServer.close(() => {
        httpServer.close(() => resolve());
      });
    });

  return { proxyUrl, port, stop };
}
