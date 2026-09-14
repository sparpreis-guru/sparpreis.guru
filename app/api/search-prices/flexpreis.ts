import { globalRateLimiter } from './rate-limiter'
import { fetchBahn } from './bahn-http'
import { metricsCollector } from '@/app/api/metrics/collector'
import { logDebug, logError, logWarn } from '@/lib/shared/logger'

const LOG_SCOPE = "bestpreissuche.flexpreis"
const RECON_URL = "https://www.bahn.de/web/api/angebote/recon"

// Der Tagesbestpreis-Endpunkt liefert ausschließlich den günstigsten Preis
// (abPreis) ohne Tarifkennzeichnung. Flexpreise stehen nur in der vollen
// Angebotsliste, die recon zu einem ctxRecon-Handle zurueckgibt.
const FLEX_OFFER_NAME = "Flexpreis"

// Der Flexpreis ist ein Streckentarif und innerhalb eines Reisetags für alle
// Züge derselben Führung identisch. Es genügt daher, pro unterschiedlicher
// Streckenführung eine Verbindung abzufragen statt aller Verbindungen.
//
// Jede Stichprobe kostet eine zusätzliche Anfrage pro Reisetag und geht damit
// direkt zulasten des 30/min-Budgets. Zwei Führungen decken den Normalfall ab
// (Direktverbindung plus abweichende Umsteigeroute); mehr bringt selten einen
// günstigeren Tarif und verlangsamt eine Monatssuche spürbar.
const MAX_SAMPLES = 2

export interface FlexpreisSampleSource {
  ctxRecon: string
  routingSignature: string
}

interface FlexpreisRequestConfig {
  klasse: string
  alter: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  sessionId?: string
}

/**
 * Kennzeichnet die Streckenführung einer Verbindung. Zwei Verbindungen mit
 * gleicher Signatur teilen denselben Tarif, müssen also nicht beide abgefragt
 * werden.
 */
export function buildRoutingSignature(
  abschnitte: Array<{
    abfahrtsOrtExtId?: string
    ankunftsOrtExtId?: string
    verkehrsmittel?: { kategorie?: string }
  }>
): string {
  if (!Array.isArray(abschnitte) || abschnitte.length === 0) return "unbekannt"
  return abschnitte
    .map(abschnitt => {
      const kategorie = abschnitt.verkehrsmittel?.kategorie || "?"
      return `${kategorie}@${abschnitt.abfahrtsOrtExtId || "?"}>${abschnitt.ankunftsOrtExtId || "?"}`
    })
    .join("|")
}

function hasStreichpreis(angebot: any): boolean {
  const fahrtAngebote = angebot?.hinfahrt?.fahrtAngebote
  if (!Array.isArray(fahrtAngebote)) return false
  return fahrtAngebote.some((fahrtAngebot: any) => {
    const streichpreis = fahrtAngebot?.streichpreis
    return Boolean(streichpreis && typeof streichpreis === "object" && "betrag" in streichpreis)
  })
}

/**
 * Wählt den gültigen Flexpreis aus einer recon-Angebotsliste.
 *
 * Ohne BahnCard liefert die Bahn zusätzlich zum echten Flexpreis rabattierte
 * Varianten, die an ein Probe-BahnCard-Angebot gekoppelt sind; diese tragen
 * einen `streichpreis` mit dem eigentlichen Preis. Mit BahnCard ist es genau
 * umgekehrt: dann ist der Eintrag mit `streichpreis` der korrekte, und ein
 * Eintrag ohne `streichpreis` existiert in der gebuchten Klasse gar nicht.
 *
 * Deshalb: erst nach Klasse filtern, dann Eintraege ohne `streichpreis`
 * bevorzugen und nur ersatzweise auf die mit `streichpreis` zurueckfallen.
 */
export function selectFlexpreis(reiseAngebote: unknown, klasse: string): number | null {
  if (!Array.isArray(reiseAngebote)) return null

  const candidates = reiseAngebote.filter((angebot: any) =>
    angebot?.name === FLEX_OFFER_NAME &&
    angebot?.klasse === klasse &&
    angebot?.preis &&
    typeof angebot.preis === "object" &&
    typeof angebot.preis.betrag === "number"
  )
  if (candidates.length === 0) return null

  const withoutStreichpreis = candidates.filter(angebot => !hasStreichpreis(angebot))
  const pool = withoutStreichpreis.length > 0 ? withoutStreichpreis : candidates

  return pool.reduce<number>(
    (cheapest, angebot: any) => Math.min(cheapest, angebot.preis.betrag),
    Number.POSITIVE_INFINITY
  )
}

async function fetchOffersForConnection(
  ctxRecon: string,
  config: FlexpreisRequestConfig,
  requestId: string
): Promise<unknown[] | null> {
  const requestBody = {
    ctxRecon,
    klasse: config.klasse,
    reisende: [
      {
        typ: config.alter,
        ermaessigungen: [
          {
            art: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
            klasse: config.ermaessigungKlasse || "KLASSENLOS",
          },
        ],
        alter: [],
        anzahl: 1,
      },
    ],
    deutschlandTicketVorhanden: false,
    nurDeutschlandTicketVerbindungen: false,
    reservierungsKontingenteVorhanden: false,
  }

  const apiCallStartTime = Date.now()

  const apiCallResult = await globalRateLimiter.addToQueue(requestId, async () => {
    if (config.sessionId && globalRateLimiter.isSessionCancelledSync(config.sessionId)) {
      throw new Error(`Session ${config.sessionId} was cancelled`)
    }

    const response = await fetchBahn(RECON_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "Accept-Encoding": "gzip",
        Origin: "https://www.bahn.de",
        Referer: "https://www.bahn.de/buchung/fahrplan/suche",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
        Connection: "close",
      },
      body: JSON.stringify(requestBody),
    })

    const apiDuration = Date.now() - apiCallStartTime
    metricsCollector.recordBahnApiRequest(apiDuration, response.status)

    if (!response.ok) {
      let errorText = ""
      try {
        errorText = await response.text()
      } catch {
        // Fehlertext ist optional; der Status genügt für die Behandlung.
      }
      // Sentinel statt Exception, damit der Rate Limiter 429 selbst behandelt.
      return { __httpStatus: response.status, __errorText: errorText.slice(0, 100) }
    }

    return await response.text()
  }, config.sessionId, { priority: true })

  if (typeof apiCallResult !== "string") {
    const status = (apiCallResult as any)?.__httpStatus
    logWarn(LOG_SCOPE, "Flexpreis request failed", { requestId, status })
    return null
  }

  try {
    const data = JSON.parse(apiCallResult)
    const verbindung = Array.isArray(data?.verbindungen) ? data.verbindungen[0] : null
    return Array.isArray(verbindung?.reiseAngebote) ? verbindung.reiseAngebote : null
  } catch (parseError) {
    logError(LOG_SCOPE, "Could not parse Flexpreis response", parseError, { requestId })
    return null
  }
}

/**
 * Ermittelt den günstigsten Flexpreis eines Reisetags.
 *
 * Es wird je Streckenführung nur eine Verbindung abgefragt (gedeckelt durch
 * MAX_SAMPLES), weil der Flexpreis innerhalb einer Führung nicht vom
 * einzelnen Zug abhängt.
 */
export async function fetchFlexpreisForDay(
  sources: FlexpreisSampleSource[],
  config: FlexpreisRequestConfig,
  travelDate: string
): Promise<number | null> {
  const bySignature = new Map<string, string>()
  for (const source of sources) {
    if (!source.ctxRecon) continue
    if (!bySignature.has(source.routingSignature)) {
      bySignature.set(source.routingSignature, source.ctxRecon)
    }
  }

  const samples = Array.from(bySignature.entries()).slice(0, MAX_SAMPLES)
  if (samples.length === 0) {
    logDebug(LOG_SCOPE, "No ctxRecon handles available for Flexpreis lookup", { travelDate })
    return null
  }

  const prices: number[] = []
  for (const [signature, ctxRecon] of samples) {
    try {
      const offers = await fetchOffersForConnection(
        ctxRecon,
        config,
        `flex-${travelDate}-${prices.length}`
      )
      const price = selectFlexpreis(offers, config.klasse)
      if (price !== null) prices.push(price)
      else logDebug(LOG_SCOPE, "No Flexpreis offer in response", { travelDate, signature })
    } catch (error) {
      logWarn(LOG_SCOPE, "Flexpreis lookup failed for routing", {
        travelDate,
        signature,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (prices.length === 0) return null

  const cheapest = Math.min(...prices)
  logDebug(LOG_SCOPE, "Flexpreis resolved", {
    travelDate,
    routingsSampled: samples.length,
    routingsAvailable: bySignature.size,
    flexPreis: cheapest,
  })
  return cheapest
}
