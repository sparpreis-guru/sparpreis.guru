import { NextResponse, type NextRequest } from "next/server"
import { logWarn } from "@/lib/shared/logger"
import type { PriceSearchAction, TurnstileAction, TurnstileClientConfig } from "./turnstile-shared"
import { hasActiveSearchGrant, searchGrantRejection } from "./search-grants"
import { isTurnstileEnabled } from "@/lib/shared/feature-flags"

function configuration() {
  return {
    enabled: isTurnstileEnabled(),
    siteKey: process.env.TURNSTILE_SITE_KEY?.trim() || "",
    secretKey: process.env.TURNSTILE_SECRET_KEY?.trim() || "",
    hostnames: (process.env.TURNSTILE_HOSTNAMES || "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean),
  }
}

export function getTurnstileClientConfig(): TurnstileClientConfig {
  const { enabled, siteKey } = configuration()
  const value = process.env.TURNSTILE_APPEARANCE
  const appearance = value === "always" || value === "execute" ? value : "interaction-only"
  return { enabled, siteKey: enabled ? siteKey : "", appearance }
}

function rejection(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } })
}

const unavailable = () => rejection(503, "TURNSTILE_UNAVAILABLE",
  "Die Sicherheitsprüfung ist derzeit nicht verfügbar. Bitte versuche es später erneut.")

export function checkTurnstileConfiguration() {
  const config = configuration()
  return config.enabled && (!config.siteKey || !config.secretKey || !config.hostnames.length) ? unavailable() : null
}

/** Always runs before station lookup, cache access or queue registration. No IP headers are trusted. */
export async function verifyPriceSearchRequest(request: NextRequest, action: PriceSearchAction, allowSearchGrant = false) {
  const config = configuration()
  if (config.enabled && !request.headers.has("x-turnstile-token") && allowSearchGrant && request.headers.has("x-price-search-grant")) {
    if (!config.siteKey || !config.secretKey || !config.hostnames.length) return unavailable()
    return hasActiveSearchGrant(request) ? null : searchGrantRejection()
  }
  return verifyTurnstileRequest(request, action)
}

export async function verifyTurnstileRequest(request: NextRequest, action: TurnstileAction) {
  const config = configuration()
  if (!config.enabled) return null

  if (!config.siteKey || !config.secretKey || config.hostnames.length === 0) {
    logWarn("search.turnstile", "Turnstile enabled with incomplete configuration")
    return unavailable()
  }

  const token = request.headers.get("x-turnstile-token")
  if (!token || token.length > 2048 || token.trim() !== token) {
    return rejection(403, "TURNSTILE_REQUIRED", "Bitte schließe die Sicherheitsprüfung vor der Suche ab.")
  }

  try {
    request.signal.throwIfAborted()
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: config.secretKey, response: token }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
      cache: "no-store",
      redirect: "error",
    })
    if (!response.ok) return unavailable()
    const result: unknown = await response.json()
    if (!result || typeof result !== "object") return unavailable()
    const validation = result as { success?: unknown; hostname?: unknown; action?: unknown; "error-codes"?: unknown }
    if (typeof validation.success !== "boolean") return unavailable()
    if (validation.success !== true) {
      const errors = Array.isArray(validation["error-codes"]) ? validation["error-codes"].filter(code => typeof code === "string") : []
      logWarn("search.turnstile", "Turnstile validation rejected", { action, codes: errors.join(",") })
      if (errors.some(code => ["internal-error", "missing-input-secret", "invalid-input-secret", "bad-request"].includes(code))) return unavailable()
      return rejection(403, "TURNSTILE_REJECTED", "Die Sicherheitsprüfung ist fehlgeschlagen oder abgelaufen. Bitte starte die Suche erneut.")
    }
    if (typeof validation.hostname !== "string" || !config.hostnames.includes(validation.hostname.toLowerCase())) {
      logWarn("search.turnstile", "Turnstile hostname mismatch", {
        expectedHostnames: config.hostnames,
        receivedHostname: typeof validation.hostname === "string" ? validation.hostname : "missing",
      })
      return rejection(403, "TURNSTILE_HOSTNAME_MISMATCH", "Die Sicherheitsprüfung ist für diese Website nicht freigegeben. Bitte informiere den Betreiber.")
    }
    if (validation.action !== action) {
      logWarn("search.turnstile", "Turnstile action mismatch", {
        expectedAction: action,
        receivedAction: typeof validation.action === "string" ? validation.action : "missing",
      })
      return rejection(403, "TURNSTILE_ACTION_MISMATCH", "Die Sicherheitsprüfung konnte dieser Suche nicht zugeordnet werden. Bitte starte die Suche erneut.")
    }
    request.signal.throwIfAborted()
    return null
  } catch {
    logWarn("search.turnstile", "Turnstile validation unavailable", { action })
    return unavailable()
  }
}
