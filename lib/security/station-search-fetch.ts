import { PriceSearchVerificationError } from "./turnstile-shared"

export type StationSearchFetch = (query: string, options?: { signal?: AbortSignal }) => Promise<Response>
export type StationSelection = (query: string, station: { extId: string; name: string }) => Promise<void>

/** Grant exists only in this page instance's memory; consumers share verification, not tokens. */
export function createStationSearchClient(getToken: ((signal: AbortSignal) => Promise<string>) | null) {
  let grant: string | null = null
  let verification: Promise<void> | null = null
  let generation = 0
  const lifetime = new AbortController()
  const ensureGrant = () => {
    if (!verification) {
      verification = (async () => {
        const token = await getToken!(lifetime.signal)
        lifetime.signal.throwIfAborted()
        const response = await fetch("/api/station-search/verify", { method: "POST", credentials: "same-origin",
          headers: { "X-Turnstile-Token": token, ...(grant ? { "X-Station-Search-Grant": grant } : {}) }, signal: lifetime.signal, cache: "no-store" })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new PriceSearchVerificationError(body?.error || "Die Sicherheitsprüfung für die Bahnhofssuche ist fehlgeschlagen. Bitte versuche es erneut.")
        }
        const issued = response.headers.get("x-station-search-grant")
        if (!issued || !/^[a-f0-9]{64}$/.test(issued)) throw new PriceSearchVerificationError("Die Bahnhofssuche konnte nicht freigegeben werden. Bitte versuche es erneut.")
        grant = issued
        generation += 1
      })().finally(() => { verification = null })
    }
    return verification
  }

  const search: StationSearchFetch = async (query, options = {}) => {
    lifetime.signal.throwIfAborted()
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal
    signal.throwIfAborted()
    const path = `/api/station-search?q=${encodeURIComponent(query)}`
    const attempt = generation
    const request = () => fetch(path, { signal, credentials: "same-origin", cache: "no-store",
      headers: getToken && grant ? { "X-Station-Search-Grant": grant } : {} })
    let response = await request()
    if (getToken && response.status === 403) {
      const body = await response.clone().json().catch(() => null)
      if (typeof body?.code === "string" && body.code.startsWith("STATION_GRANT_")) {
        signal.throwIfAborted()
        if (attempt === generation) await ensureGrant()
        signal.throwIfAborted()
        response = await request()
      }
    }
    return response
  }
  // Selection telemetry never triggers a challenge or borrows the autocomplete budget.
  const recordSelection: StationSelection = async (query, station) => {
    if (lifetime.signal.aborted || query.trim().length < 2 || (getToken && !grant)) return
    await fetch("/api/station-search", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(getToken && grant ? { "X-Station-Search-Grant": grant } : {}) },
      body: JSON.stringify({ q: query.trim(), station }), keepalive: true })
  }
  return { search, recordSelection, dispose: () => { grant = null; lifetime.abort() } }
}
