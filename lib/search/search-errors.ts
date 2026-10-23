export interface SearchFailure {
  kind: "blocked" | "rate_limit" | "timeout" | "network" | "response" | "request"
  message: string
}

/** Translate upstream diagnostics without exposing response bodies or internal details. */
export function describeSearchFailure(info: string): SearchFailure {
  const status = info.match(/\bHTTP\s+(\d{3})\b/i)?.[1]
  if (/OPS_BLOCKED/i.test(info) || status === "403" || status === "452") {
    const details = [status && `HTTP ${status}`, /OPS_BLOCKED/i.test(info) && "OPS_BLOCKED"].filter(Boolean).join(", ")
    return { kind: "blocked", message: `Die Bahn hat die Preisabfrage blockiert${details ? ` (${details})` : ""}. Bitte versuche es später erneut.` }
  }
  if (status === "429" || /rate limited|too many requests/i.test(info)) {
    return { kind: "rate_limit", message: "Die Bahn lässt derzeit keine weiteren Preisabfragen zu (HTTP 429). Bitte warte etwas und starte die Suche erneut." }
  }
  if (/timeout|timed out|aborted|AbortError|ETIMEDOUT/i.test(info)) {
    return { kind: "timeout", message: "Die Bahn hat nicht rechtzeitig geantwortet. Bitte versuche es erneut." }
  }
  if (/fetch failed|failed to fetch|network|ECONN|ENET|ENOTFOUND|EAI_AGAIN/i.test(info)) {
    return { kind: "network", message: "Die Verbindung zur Preisabfrage ist fehlgeschlagen. Bitte versuche es erneut." }
  }
  if (/JSON Parse Error/i.test(info)) {
    return { kind: "response", message: "Die Antwort der Bahn konnte nicht verarbeitet werden. Bitte versuche es erneut." }
  }
  return { kind: "request", message: `Die Preisabfrage ist technisch fehlgeschlagen${status ? ` (HTTP ${status})` : ""}. Bitte versuche es später erneut.` }
}

export function getDaySearchFailure(day?: { info?: string; preis?: number }): SearchFailure | null {
  if (!day || (day.preis ?? 0) > 0 || !day.info) return null
  if (!/^(API Error:|JSON Parse Error|Rate limited, retrying)/i.test(day.info)) return null
  return describeSearchFailure(day.info)
}

export function getSearchFailures(days: Iterable<{ info?: string; preis?: number }>): SearchFailure[] {
  const failures = new Map<string, SearchFailure>()
  for (const day of days) {
    const failure = getDaySearchFailure(day)
    if (failure) failures.set(failure.message, failure)
  }
  return [...failures.values()]
}
