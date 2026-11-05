import { Agent, fetch as undiciFetch } from "undici"

interface BahnHttpOptions {
  method?: "GET" | "POST"
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

interface BahnHttpResponse {
  status: number
  ok: boolean
  getHeader: (name: string) => string | null
  text: () => Promise<string>
  json: <T = unknown>() => Promise<T>
}

const TEMPORARY_NETWORK_ERROR_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
])

export function isTemporaryBahnNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError") return true

  const cause = (error as Error & { cause?: unknown }).cause
  if (!cause || typeof cause !== "object" || !("code" in cause)) return false

  const code = (cause as { code?: unknown }).code
  return typeof code === "string" && TEMPORARY_NETWORK_ERROR_CODES.has(code)
}

const bahnKeyExchangeGroups = "X25519:P-256:P-384"

const bahnAgent = new Agent({
  // Undici 8 enables HTTP/2 by default. Preserve the previous HTTP/1.1-only
  // behavior used by the scoped bahn.de TLS workaround.
  allowH2: false,
  connect: {
    // Some local Windows/Node setups select an unreachable Akamai IPv6 route
    // for bahn.de and never fall back to the working IPv4 addresses.
    family: 4,
    // The previous hybrid groups now receive OPS_BLOCKED. Use the classical
    // list verified against all four endpoints, including on OpenSSL 3.5+.
    // TLS versions, cipher suites and certificate verification stay unchanged.
    // Reproduction and limitations: docs/bahn-api-transport.md.
    ecdhCurve: bahnKeyExchangeGroups,
  },
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
})

export async function fetchBahn(url: string, options: BahnHttpOptions = {}): Promise<BahnHttpResponse> {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "www.bahn.de") {
    throw new Error("fetchBahn only supports https://www.bahn.de URLs")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45_000)

  try {
    // Keep fetch and its dispatcher on the same Undici major. Node's built-in
    // fetch can still use the legacy v1 handler API, while Undici 8 dispatchers
    // require the v2 API.
    const response = await undiciFetch(parsedUrl, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      // Keep the TLS compatibility settings scoped to this Bahn client.
      dispatcher: bahnAgent,
    })

    return {
      status: response.status,
      ok: response.ok,
      getHeader: (name: string) => response.headers.get(name),
      text: () => response.text(),
      json: <T = unknown>() => response.json() as Promise<T>,
    }
  } finally {
    clearTimeout(timeout)
  }
}
