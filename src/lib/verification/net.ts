import "server-only"
import http from "node:http"
import https from "node:https"
import dns from "node:dns"
import { BlockList, isIP } from "node:net"
import type { LookupFunction } from "node:net"

// Outbound HTTP for backlink verification with SSRF protection:
// - only http/https on default ports, no credentials in the URL
// - every resolved address is checked at connect time (defeats DNS rebinding)
// - redirects are followed manually and each hop is re-validated
// - bounded time and response size

const blocked = new BlockList()
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4")
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6")

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, "ipv4")
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return !blocked.check(mapped[1], "ipv4")
    if (/^::ffff:/i.test(address)) return false
    return !blocked.check(address, "ipv6")
  }
  return false
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
  if (isIP(host) && !isPublicAddress(host)) throw new BlockedUrlError("Private or reserved addresses are not allowed")
  return url
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>
const defaultResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true })

function guardedLookup(resolve: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addresses) => {
        if (!addresses.length) throw new BlockedUrlError(`Could not resolve ${hostname}`)
        const bad = addresses.find((a) => !isPublicAddress(a.address))
        if (bad) throw new BlockedUrlError(`${hostname} resolves to a private or reserved address`)
        if ((options as { all?: boolean }).all) {
          ;(callback as (err: Error | null, addrs: { address: string; family: number }[]) => void)(null, addresses)
        } else {
          callback(null, addresses[0].address, addresses[0].family)
        }
      })
      .catch((err: Error) => callback(err as NodeJS.ErrnoException, "", 0))
  }
}

export interface FetchResult {
  status: number
  finalUrl: string
  contentType: string
  body: string
  truncated: boolean
  elapsedMs: number
  redirects: number
}

export interface SafeFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  userAgent?: string
  accept?: string
  resolver?: Resolver
}

function requestOnce(url: URL, opts: Required<Omit<SafeFetchOptions, "resolver">> & { resolver: Resolver }) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean }>(
    (resolvePromise, reject) => {
      const client = url.protocol === "https:" ? https : http
      const req = client.request(
        url,
        {
          method: "GET",
          lookup: guardedLookup(opts.resolver),
          headers: {
            "User-Agent": opts.userAgent,
            Accept: opts.accept,
            "Accept-Language": "en",
          },
          timeout: opts.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = []
          let size = 0
          let truncated = false
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
          const finish = () =>
            resolvePromise({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
            })
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
    },
  )
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const opts = {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 2_000_000,
    maxRedirects: options.maxRedirects ?? 5,
    userAgent: options.userAgent ?? "LinkOpsVerifier/1.0 (+backlink verification)",
    accept: options.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    resolver: options.resolver ?? defaultResolver,
  }
  const started = Date.now()
  let url = assertFetchableUrl(rawUrl)
  for (let redirects = 0; ; redirects++) {
    const res = await requestOnce(url, opts)
    const location = res.headers.location
    if (res.status >= 300 && res.status < 400 && location) {
      if (redirects >= opts.maxRedirects) throw new Error(`Too many redirects (>${opts.maxRedirects})`)
      url = assertFetchableUrl(new URL(location, url).toString())
      continue
    }
    return {
      status: res.status,
      finalUrl: url.toString(),
      contentType: String(res.headers["content-type"] ?? ""),
      body: res.body,
      truncated: res.truncated,
      elapsedMs: Date.now() - started,
      redirects,
    }
  }
}
