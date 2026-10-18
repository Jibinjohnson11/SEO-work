import "server-only"
import { isIP } from "node:net"

/**
 * Where the real client IP can be read from, if anywhere. Only headers that a proxy in front of the
 * app OVERWRITES (or appends to) can be trusted; anything else may be sent by the client itself.
 *   - "single":    the whole header is the client IP (cf-connecting-ip, x-real-ip, true-client-ip)
 *   - "rightmost": X-Forwarded-For-style list; the entry added by our own proxy is `hops` from the right
 */
export type IpSource = { header: string; mode: "single" | "rightmost"; hops: number }

export function trustedIpSource(env: Record<string, string | undefined> = process.env): IpSource | null {
  const configured = env.CLIENT_IP_HEADER?.trim().toLowerCase()
  if (configured) {
    const hops = Math.max(1, Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1)
    return { header: configured, mode: configured === "x-forwarded-for" ? "rightmost" : "single", hops }
  }
  if (env.VERCEL) return { header: "x-real-ip", mode: "single", hops: 1 } // Vercel overwrites it
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent
  if (ua === "Cloudflare-Workers") return { header: "cf-connecting-ip", mode: "single", hops: 1 } // Cloudflare sets it
  return null // no proxy we know of guarantees any header here
}

/** The client IP from a trusted source, or null when it cannot be determined safely. */
export function clientIpFrom(get: (name: string) => string | null, source: IpSource | null): string | null {
  if (!source) return null
  const raw = get(source.header)
  if (!raw) return null
  let candidate: string | undefined
  if (source.mode === "single") candidate = raw.trim()
  else {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean)
    candidate = parts[parts.length - source.hops]
  }
  return candidate && isIP(candidate) ? candidate : null
}
