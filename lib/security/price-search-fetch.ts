import { PRICE_SEARCH_ACTIONS, PriceSearchVerificationError, type PriceSearchAction, type PriceSearchPath } from "./turnstile-shared"

export type PriceSearchFetch = (path: PriceSearchPath, options: RequestInit, followUp?: boolean) => Promise<Response>

export function createPriceSearchFetch(getToken: ((action: PriceSearchAction, signal?: AbortSignal | null) => Promise<string>) | null): PriceSearchFetch {
  let grant: string | null = null
  return async (path, options, followUp = false) => {
    if (!getToken) return fetch(path, options)
    options.signal?.throwIfAborted()
    const headers = new Headers(options.headers)
    headers.delete("X-Turnstile-Token")
    headers.delete("X-Price-Search-Grant")
    let response: Response | undefined
    if (followUp && path !== "/api/urlaubsfinder" && grant) {
      headers.set("X-Price-Search-Grant", grant)
      response = await fetch(path, { ...options, credentials: "same-origin", headers })
      if (response.status === 403) {
        const body = await response.clone().json().catch(() => null)
        if (typeof body?.code === "string" && body.code.startsWith("SEARCH_GRANT_")) {
          grant = null
          response = undefined
        }
      }
    }
    if (!response) {
      if (!followUp) grant = null
      const token = await getToken(PRICE_SEARCH_ACTIONS[path], options.signal)
      options.signal?.throwIfAborted()
      headers.delete("X-Price-Search-Grant")
      headers.set("X-Turnstile-Token", token)
      response = await fetch(path, { ...options, credentials: "same-origin", headers })
    }
    if (response.ok) {
      const renewed = response.headers.get("x-price-search-grant")
      if (renewed) grant = renewed
    }
    if (!response.ok && [403, 503].includes(response.status)) {
      const body = await response.clone().json().catch(() => null)
      if (typeof body?.code === "string" && body.code.startsWith("TURNSTILE_")) {
        throw new PriceSearchVerificationError(typeof body.error === "string" ? body.error : "Die Sicherheitsprüfung ist fehlgeschlagen.")
      }
    }
    return response
  }
}
