import { createHash, randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { addDaysToDateKey } from "@/lib/shared/berlin-date"
import { isTurnstileEnabled } from "@/lib/shared/feature-flags"

const TTL_MS = 20 * 60_000
const BUDGET = 64
const MAX_GRANTS = 2048

interface SearchGrant {
  scope: string
  from: string
  to: string
  flexpreis: boolean
  remaining: number
  expiresAt: number
}

// Shared by both route bundles in one Node process. Restart/other replicas fail closed.
const processState = globalThis as typeof globalThis & { __sparpreisSearchGrants?: Map<string, SearchGrant> }
const grants = processState.__sparpreisSearchGrants ??= new Map<string, SearchGrant>()
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)

function dateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try { return addDaysToDateKey(value, 0) === value } catch { return false }
}

function scope(body: Record<string, unknown>) {
  const defaults: Record<string, unknown> = {
    start: "", ziel: "", klasse: "KLASSE_2", alter: "ERWACHSENER",
    ermaessigungArt: "KEINE_ERMAESSIGUNG", ermaessigungKlasse: "KLASSENLOS",
    schnelleVerbindungen: false, nurDeutschlandTicketVerbindungen: false,
    maximaleUmstiege: "alle", umstiegszeit: "normal", rueckfahrt: "",
    minNaechte: "", maxNaechte: "", abfahrtAb: "", abfahrtBis: "", ankunftAb: "", ankunftBis: "",
    returnAbfahrtAb: "", returnAbfahrtBis: "", returnAnkunftAb: "", returnAnkunftBis: "", tarif: "SPARPREIS",
  }
  // Dates/weekdays are constrained separately, allowing a clicked extra calendar day.
  const entries = Object.entries(defaults).map(([key, fallback]) => [key, body[key] ?? fallback])
  if (entries.some(([, value]) => !["string", "number", "boolean"].includes(typeof value))) return null
  return hash(JSON.stringify(entries.map(([key, value]) => [key, String(value)])))
}

function activeGrant(request: NextRequest, now = Date.now()) {
  const id = request.headers.get("x-price-search-grant")
  if (!validId(id)) return null
  const key = hash(id)
  const grant = grants.get(key)
  if (!grant) return null
  if (grant.expiresAt <= now) { grants.delete(key); return null }
  return grant
}

export function hasActiveSearchGrant(request: NextRequest) {
  return activeGrant(request) !== null
}

export function searchGrantRejection(code = "SEARCH_GRANT_REQUIRED", status = 403) {
  return NextResponse.json({ code, error: "Für diese Preisabfrage ist eine neue Sicherheitsprüfung erforderlich." },
    { status, headers: { "Cache-Control": "no-store" } })
}

/** Reject altered search windows before the route enumerates dates or performs any other work. */
export function checkSearchGrantScope(request: NextRequest, body: Record<string, unknown>, dailyFlexpreis = false) {
  if (!isTurnstileEnabled() || request.headers.has("x-turnstile-token")) return null
  const grant = activeGrant(request)
  if (!grant) return searchGrantRejection()
  if (!body || typeof body !== "object" || Array.isArray(body)) return searchGrantRejection("SEARCH_GRANT_SCOPE")
  const requestScope = scope(body)
  if (!requestScope || grant.scope !== requestScope) return searchGrantRejection("SEARCH_GRANT_SCOPE")
  const from = dailyFlexpreis ? body.date : body.reisezeitraumAb
  const to = dailyFlexpreis ? body.date : body.reisezeitraumBis
  if (!dateKey(from) || !dateKey(to) || from > to || from < grant.from || to > grant.to) return searchGrantRejection("SEARCH_GRANT_DATES")
  if (!dailyFlexpreis && !Array.isArray(body.requestedOutwardDates) && !Array.isArray(body.requestedReturnDates)) return searchGrantRejection("SEARCH_GRANT_SCOPE")
  if (dailyFlexpreis && !grant.flexpreis) return searchGrantRejection("SEARCH_GRANT_SCOPE")
  return null
}

/** Reserve the full work budget synchronously, before any await or upstream work. Never refund retries. */
export function consumeSearchGrant(request: NextRequest, body: Record<string, unknown>,
  dates: { outward: string[]; returns: string[] }, dailyFlexpreis = false) {
  if (!isTurnstileEnabled() || request.headers.has("x-turnstile-token")) return null
  const scopeFailure = checkSearchGrantScope(request, body, dailyFlexpreis)
  if (scopeFailure) return scopeFailure
  const grant = activeGrant(request)
  if (!grant) return searchGrantRejection()
  const requested = [...dates.outward, ...dates.returns]
  if (!requested.length || dates.outward.length > 30 || dates.returns.length > 30 ||
    requested.some(date => !dateKey(date) || date < grant.from || date > grant.to)) return searchGrantRejection("SEARCH_GRANT_DATES")
  const cost = dailyFlexpreis ? 7 : dates.outward.length * (grant.flexpreis ? 2 : 1) + dates.returns.length
  if (grant.remaining < cost) return searchGrantRejection("SEARCH_GRANT_EXHAUSTED")
  grant.remaining -= cost
  return null
}

/** Issue only after a fresh successful Siteverify check and ordinary search validation. */
export function attachSearchGrant<T extends Response>(response: T, request: NextRequest, body: Record<string, unknown>): T {
  if (!isTurnstileEnabled() || !request.headers.has("x-turnstile-token") || !response.ok) return response
  const from = body.reisezeitraumAb ?? body.date
  const to = body.reisezeitraumBis ?? body.date
  if (!dateKey(from) || !dateKey(to) || from > to || typeof body.start !== "string" || typeof body.ziel !== "string") return response
  const requestScope = scope(body)
  if (!requestScope) return response
  const now = Date.now()
  for (const [key, grant] of grants) if (grant.expiresAt <= now) grants.delete(key)
  if (grants.size >= MAX_GRANTS) return response
  const id = randomBytes(32).toString("hex")
  const roundTrip = body.rueckfahrt === "1" || body.rueckfahrt === true
  grants.set(hash(id), {
    scope: requestScope,
    from: roundTrip ? from : addDaysToDateKey(from, -14),
    to: roundTrip ? to : addDaysToDateKey(to, 14),
    flexpreis: body.tarif === "FLEXPREIS" && !roundTrip,
    remaining: BUDGET, expiresAt: now + TTL_MS,
  })
  response.headers.set("X-Price-Search-Grant", id)
  response.headers.set("Cache-Control", "no-store")
  return response
}
