import "server-only"
import type { LookupFunction } from "node:net"

// Outbound HTTP for backlink verification with SSRF protection:
// - only http/https on default ports, no credentials in the URL, no internal hostnames
// - IP-literal hosts in reserved ranges are rejected before any request
// - redirects are followed manually and each hop is re-validated
// - bounded time and response size
// Runtime-specific transport:
// - Node.js: node:http(s) with a lookup hook that checks every resolved address at connect
//   time (defeats DNS rebinding).
// - Cloudflare Workers: fetch(); the "global_fetch_strictly_public" compatibility flag (see
//   wrangler.jsonc) makes the platform refuse private/internal destinations.

// ---------------------------------------------------------------------------
// IP classification (pure TypeScript so it runs in every runtime)
// ---------------------------------------------------------------------------
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

function parseIpv6(ip: string): bigint | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "")
  if (!s.includes(":")) return null
  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
  const v4 = s.match(/:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    if (!IPV4_RE.test(v4[1])) return null
    const n = ipv4ToInt(v4[1])
    s = `${s.slice(0, -v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - tail.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.reduce((acc, g) => (acc << BigInt(16)) + BigInt(parseInt(g, 16)), BigInt(0))
}

export function ipVersion(address: string): 0 | 4 | 6 {
  if (IPV4_RE.test(address)) return 4
  return parseIpv6(address) === null ? 0 : 6
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]
const V6_BLOCKED: [string, number][] = [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]

function inV4(n: number, net: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  return (n & mask) >>> 0 === (ipv4ToInt(net) & mask) >>> 0
}
function inV6(n: bigint, net: string, prefix: number) {
  const shift = BigInt(128 - prefix)
  return n >> shift === parseIpv6(net)! >> shift
}

export function isPublicAddress(address: string): boolean {
  if (IPV4_RE.test(address)) {
    const n = ipv4ToInt(address)
    return !V4_BLOCKED.some(([net, p]) => inV4(n, net, p))
  }
  const v6 = parseIpv6(address)
  if (v6 === null) return false
  // IPv4-mapped (::ffff:0:0/96): judge by the embedded IPv4 address.
  if (v6 >> BigInt(32) === BigInt(0xffff)) {
    const n = Number(v6 & BigInt(0xffffffff))
    return !V4_BLOCKED.some(([net, p]) => inV4(n, net, p))
  }
  return !V6_BLOCKED.some(([net, p]) => inV6(v6, net, p))
}

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedUrlError"
  }
}

export function assertFetchableUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedUrlError("Invalid URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("Only http(s) URLs can be checked")
  if (url.username || url.password) throw new BlockedUrlError("URLs with credentials are not allowed")
  if (url.port && url.port !== "80" && url.port !== "443") throw new BlockedUrlError("Non-standard ports are not allowed")
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))
    throw new BlockedUrlError("Internal hostnames are not allowed")
  if (ipVersion(host) && !isPublicAddress(host)) throw new BlockedUrlError("Private or reserved addresses are not allowed")
  return url
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
export interface FetchResult {
  status: number
  finalUrl: string
  contentType: string
  body: string
  truncated: boolean
  elapsedMs: number
  redirects: number
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>

export interface SafeFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  userAgent?: string
  accept?: string
  /** Node.js only: DNS resolver used by the connect-time guard (tests inject one). */
  resolver?: Resolver
}

type Opts = Required<Omit<SafeFetchOptions, "resolver">> & { resolver?: Resolver }
interface HopResult {
  status: number
  location: string | null
  contentType: string
  body: string
  truncated: boolean
}

const isWorkersRuntime = () =>
  typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers"

/** Cloudflare Workers: fetch with manual redirects and a streamed size cap. */
async function fetchHop(url: URL, opts: Opts): Promise<HopResult> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs),
    headers: { "User-Agent": opts.userAgent, Accept: opts.accept, "Accept-Language": "en" },
  })
  const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
  let body = ""
  let truncated = false
  if (!location && res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > opts.maxBytes) {
        body += decoder.decode(value.subarray(0, value.byteLength - (size - opts.maxBytes)))
        truncated = true
        await reader.cancel()
        break
      }
      body += decoder.decode(value, { stream: true })
    }
  } else {
    await res.body?.cancel()
  }
  return { status: res.status, location, contentType: res.headers.get("content-type") ?? "", body, truncated }
}

/** Node.js: node:http(s) with every resolved address checked at connect time. */
async function nodeHop(url: URL, opts: Opts): Promise<HopResult> {
  const [{ default: http }, { default: https }, { default: dns }] = await Promise.all([
    import("node:http"),
    import("node:https"),
    import("node:dns"),
  ])
  const resolve: Resolver = opts.resolver ?? ((hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true }))
  const lookup: LookupFunction = (hostname, options, callback) => {
    resolve(hostname)
      .then((addresses) => {
        if (!addresses.length) throw new BlockedUrlError(`Could not resolve ${hostname}`)
        if (addresses.some((a) => !isPublicAddress(a.address)))
          throw new BlockedUrlError(`${hostname} resolves to a private or reserved address`)
        if ((options as { all?: boolean }).all) {
          ;(callback as (err: Error | null, addrs: { address: string; family: number }[]) => void)(null, addresses)
        } else {
          callback(null, addresses[0].address, addresses[0].family)
        }
      })
      .catch((err: Error) => callback(err as NodeJS.ErrnoException, "", 0))
  }
  return new Promise<HopResult>((resolvePromise, reject) => {
    const client = url.protocol === "https:" ? https : http
    const req = client.request(
      url,
      {
        method: "GET",
        lookup,
        headers: { "User-Agent": opts.userAgent, Accept: opts.accept, "Accept-Language": "en" },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        let settled = false
        res.on("data", (chunk: Buffer) => {
          if (truncated) return
          size += chunk.length
          if (size > opts.maxBytes) {
            truncated = true
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)))
            res.destroy()
            return
          }
          chunks.push(chunk)
        })
        const finish = () => {
          if (settled) return
          settled = true
          const status = res.statusCode ?? 0
          resolvePromise({
            status,
            location: status >= 300 && status < 400 ? (res.headers.location ?? null) : null,
            contentType: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          })
        }
        res.on("end", finish)
        res.on("close", finish)
        res.on("error", (e) => (truncated ? finish() : reject(e)))
      },
    )
    const timer = setTimeout(() => req.destroy(new Error(`Timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs)
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${opts.timeoutMs}ms`)))
    req.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.on("close", () => clearTimeout(timer))
    req.end()
  })
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const opts: Opts = {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 2_000_000,
    maxRedirects: options.maxRedirects ?? 5,
    userAgent: options.userAgent ?? "LinkOpsVerifier/1.0 (+backlink verification)",
    accept: options.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    resolver: options.resolver,
  }
  const hop = isWorkersRuntime() ? fetchHop : nodeHop
  const started = Date.now()
  let url = assertFetchableUrl(rawUrl)
  for (let redirects = 0; ; redirects++) {
    const res = await hop(url, opts)
    if (res.location) {
      if (redirects >= opts.maxRedirects) throw new Error(`Too many redirects (>${opts.maxRedirects})`)
      url = assertFetchableUrl(new URL(res.location, url).toString())
      continue
    }
    return {
      status: res.status,
      finalUrl: url.toString(),
      contentType: res.contentType,
      body: res.body,
      truncated: res.truncated,
      elapsedMs: Date.now() - started,
      redirects,
    }
  }
}
