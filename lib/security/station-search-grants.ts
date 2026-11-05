import { createHash, randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { isTurnstileEnabled } from "@/lib/shared/feature-flags"
import { checkTurnstileConfiguration } from "./turnstile"

const TTL_MS = 30 * 60_000
const REQUESTS = 100
const MAX_GRANTS = 2048
interface Grant { expiresAt: number; remaining: number; remainingClicks: number }
const state = globalThis as typeof globalThis & { __sparpreisStationGrants?: Map<string, Grant> }
const grants = state.__sparpreisStationGrants ??= new Map<string, Grant>()
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

function grantKey(request: NextRequest) {
  const value = request.headers.get("x-station-search-grant")
  return value && /^[a-f0-9]{64}$/.test(value) ? hash(value) : null
}

function rejection(code: string, status = 403) {
  return NextResponse.json({ results: [], code, error: status === 503
    ? "Die Sicherheitsprüfung für die Bahnhofssuche ist derzeit nicht verfügbar. Bitte versuche es später erneut."
    : "Für die Bahnhofssuche ist eine neue Sicherheitsprüfung erforderlich." },
  { status, headers: { "Cache-Control": "no-store" } })
}

/** Reserve synchronously before cache reads, database writes or upstream work. */
export function consumeStationSearchGrant(request: NextRequest, click = false) {
  if (!isTurnstileEnabled()) return null
  const configurationFailure = checkTurnstileConfiguration()
  if (configurationFailure) return configurationFailure
  const key = grantKey(request)
  const grant = key ? grants.get(key) : undefined
  if (!grant) return rejection("STATION_GRANT_REQUIRED")
  if (grant.expiresAt <= Date.now()) {
    grants.delete(key!)
    return rejection("STATION_GRANT_EXPIRED")
  }
  const budget = click ? "remainingClicks" : "remaining"
  if (grant[budget] < 1) return rejection("STATION_GRANT_EXHAUSTED")
  grant[budget] -= 1
  return null
}

/** Called only after a fresh successful Siteverify validation for station-search. */
export function issueStationSearchGrant(request: NextRequest) {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  if (!isTurnstileEnabled()) return response
  const now = Date.now()
  for (const [key, grant] of grants) if (grant.expiresAt <= now) grants.delete(key)
  const previous = grantKey(request)
  if (previous) grants.delete(previous)
  if (grants.size >= MAX_GRANTS) return rejection("TURNSTILE_UNAVAILABLE", 503)
  const id = randomBytes(32).toString("hex")
  grants.set(hash(id), { expiresAt: now + TTL_MS, remaining: REQUESTS, remainingClicks: REQUESTS })
  response.headers.set("X-Station-Search-Grant", id)
  return response
}
