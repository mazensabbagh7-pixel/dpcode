// FILE: headerCapture.ts
// Purpose: Extract the rate-limit-relevant subset of response headers from
// upstream vendor APIs. The MITM proxy hands us every response header map;
// this module filters it into a normalized snapshot keyed by provider.
//
// Anthropic's documented rate-limit headers (docs.anthropic.com/en/api/rate-limits):
//   anthropic-ratelimit-requests-{limit,remaining,reset}
//   anthropic-ratelimit-tokens-{limit,remaining,reset}
//   anthropic-ratelimit-input-tokens-{limit,remaining,reset}
//   anthropic-ratelimit-output-tokens-{limit,remaining,reset}
//   retry-after  (on 429 only)
// Claude Max subscription traffic may also carry an `anthropic-priority-*`
// variant of the token family — we capture anything matching either prefix
// so the UI can render whatever the account actually returns.

import type { IncomingHttpHeaders } from "node:http";

export type Provider = "claudeAgent" | "codex" | "gemini";

export interface RateLimitDimension {
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetsAt?: string;
}

export interface AnthropicRateLimitSnapshot {
  readonly provider: "claudeAgent";
  readonly capturedAt: string;
  readonly host: string;
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;
  readonly dimensions: Record<string, RateLimitDimension>;
}

const ANTHROPIC_PREFIXES = ["anthropic-ratelimit-", "anthropic-priority-"];

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseNumeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseResetsAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Anthropic returns RFC 3339 timestamps; pass them through after a sanity
  // parse so invalid values get dropped rather than poisoning downstream.
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function stripPrefix(name: string): { prefix: string; rest: string } | null {
  for (const prefix of ANTHROPIC_PREFIXES) {
    if (name.startsWith(prefix)) {
      return { prefix, rest: name.slice(prefix.length) };
    }
  }
  return null;
}

interface DimensionAccumulator {
  limit?: number;
  remaining?: number;
  resetsAt?: string;
}

function emptyAccumulator(): DimensionAccumulator {
  return {};
}

/**
 * Parse an Anthropic response's headers into a rate-limit snapshot. Returns
 * null when the response carries zero recognizable rate-limit headers — that
 * happens for non-message endpoints (auth refresh, telemetry, etc.) which we
 * don't want to surface as a usage event.
 */
export function captureAnthropicHeaders(input: {
  headers: IncomingHttpHeaders;
  host: string;
  statusCode: number;
  now?: Date;
}): AnthropicRateLimitSnapshot | null {
  const { headers, host, statusCode } = input;
  const accumulators = new Map<string, DimensionAccumulator>();

  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    const stripped = stripPrefix(name);
    if (!stripped) continue;

    // rest is e.g. "requests-limit", "input-tokens-remaining", "tokens-reset".
    const lastDash = stripped.rest.lastIndexOf("-");
    if (lastDash === -1) continue;
    const dimensionKey = `${stripped.prefix}${stripped.rest.slice(0, lastDash)}`;
    const suffix = stripped.rest.slice(lastDash + 1);
    const value = headerValue(rawValue);

    const acc = accumulators.get(dimensionKey) ?? emptyAccumulator();
    switch (suffix) {
      case "limit": {
        const parsed = parseNumeric(value);
        if (parsed !== undefined) acc.limit = parsed;
        break;
      }
      case "remaining": {
        const parsed = parseNumeric(value);
        if (parsed !== undefined) acc.remaining = parsed;
        break;
      }
      case "reset": {
        const parsed = parseResetsAt(value);
        if (parsed !== undefined) acc.resetsAt = parsed;
        break;
      }
      default:
        // Unknown suffix — keep quietly. Future proofing for fields like
        // anthropic-ratelimit-tokens-reset-after without breaking.
        break;
    }
    accumulators.set(dimensionKey, acc);
  }

  if (accumulators.size === 0) {
    return null;
  }

  const dimensions: Record<string, RateLimitDimension> = {};
  for (const [key, acc] of accumulators) {
    // Drop dimensions that have nothing useful — keeps the UI from rendering
    // empty rows just because a header arrived with an unparseable value.
    if (acc.limit === undefined && acc.remaining === undefined && acc.resetsAt === undefined) {
      continue;
    }
    dimensions[key] = {
      ...(acc.limit !== undefined ? { limit: acc.limit } : {}),
      ...(acc.remaining !== undefined ? { remaining: acc.remaining } : {}),
      ...(acc.resetsAt ? { resetsAt: acc.resetsAt } : {}),
    };
  }

  if (Object.keys(dimensions).length === 0) {
    return null;
  }

  const retryAfter =
    statusCode === 429 ? parseNumeric(headerValue(headers["retry-after"])) : undefined;

  return {
    provider: "claudeAgent",
    capturedAt: (input.now ?? new Date()).toISOString(),
    host,
    statusCode,
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
    dimensions,
  };
}
