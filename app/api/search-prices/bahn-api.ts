import { globalRateLimiter } from './rate-limiter'
import {
  generateCacheKey,
  getCachedResult,
  setCachedResult,
  getDayPriceHistory,
  getConnectionPriceHistory,
  type PriceHistoryEntry
} from './cache'
import { metricsCollector } from '@/app/api/metrics/collector'
import { logDebug, logError, logWarn } from '@/lib/shared/logger'
import { formatDateKey, generateConnectionId, passesTimeFilter } from './utils';
import { fetchBahn } from './bahn-http'
import { buildRoutingSignature, fetchFlexpreisForDay, type FlexpreisSampleSource } from './flexpreis'
import { searchStations } from '@/app/api/station-search/search-stations'

const LOG_SCOPE = "bestpreissuche.bahn"

function formatTimeWindow(abfahrtAb?: string, abfahrtBis?: string, ankunftAb?: string, ankunftBis?: string): string {
  if (!abfahrtAb && !abfahrtBis && !ankunftAb && !ankunftBis) return "beliebig"
  return `Abfahrt ${abfahrtAb || "beliebig"}-${abfahrtBis || "beliebig"}, Ankunft ${ankunftAb || "beliebig"}-${ankunftBis || "beliebig"}`
}

function formatMaxTransfers(value: unknown): string {
  if (value === undefined || value === null || value === "" || value === "alle") {
    return "alle"
  }
  return String(value)
}

function routeContext(config: any, travelDate: string) {
  return {
    travelDate,
    startStationId: config.startStationNormalizedId,
    destinationStationId: config.zielStationNormalizedId,
    timeWindow: formatTimeWindow(config.abfahrtAb, config.abfahrtBis, config.ankunftAb, config.ankunftBis),
    maxTransfers: formatMaxTransfers(config.maximaleUmstiege),
  }
}




// Station search function
export async function searchBahnhof(search: string): Promise<{ id: string; normalizedId: string; name: string } | null> {
  if (!search) return null

  try {
    const { results } = await searchStations(search)
    if (results.length === 0) return null

    const normalizedSearch = search.toLowerCase().trim()
    const station =
      results.find(item => item.name?.toLowerCase().trim() === normalizedSearch) ||
      results[0]
    const originalId = station.id

    // Normalisiere die Station-ID: Entferne den Timestamp-Parameter @p=
    const normalizedId = originalId.replace(/@p=\d+@/g, '@')

    logDebug(LOG_SCOPE, "✅ Station lookup resolved", {
      query: search,
      stationName: station.name,
      stationId: normalizedId,
    })

    const result = { 
      id: originalId,           // Für API-Aufrufe
      normalizedId: normalizedId, // Für Cache-Keys
      name: station.name 
    }

    return result
  } catch (error) {
    logError(LOG_SCOPE, "Station lookup failed", error, { query: search })
    return null
  }
}

interface IntervalAbschnitt {
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  abfahrtsOrtExtId?: string
  ankunftsOrtExtId?: string
  verkehrsmittel?: {
    produktGattung?: string
    kategorie?: string
    name?: string
    mittelText?: string
  }
}

interface IntervalDetails {
  preis: number
  abschnitte: IntervalAbschnitt[]
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl: number
  isCheapestPerInterval?: boolean
  priceHistory?: PriceHistoryEntry[]
}

interface TrainResult {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  // Tagestarif im Flexpreis-Modus. Der Flexpreis ist ein Streckentarif und
  // damit für alle Verbindungen eines Tages gleich, deshalb steht er auf
  // Tagesebene und nicht je Verbindung.
  flexPreis?: number
  allIntervals?: IntervalDetails[]
  priceHistory?: PriceHistoryEntry[]
}

interface TrainResults {
  [date: string]: TrainResult
}

function getStopTime(stop: any, direction: "abfahrt" | "ankunft"): string {
  return (
    stop?.[direction]?.sollzeit ||
    stop?.[direction]?.zeit ||
    stop?.[direction]?.ez ||
    ""
  )
}

function getSectionDepartureTime(abschnitt: any): string {
  return (
    abschnitt.abfahrtsZeitpunkt ||
    getStopTime(abschnitt, "abfahrt") ||
    getStopTime(abschnitt.startHalt, "abfahrt") ||
    abschnitt.halte?.[0]?.abfahrt?.sollzeit ||
    ""
  )
}

function getSectionArrivalTime(abschnitt: any): string {
  return (
    abschnitt.ankunftsZeitpunkt ||
    getStopTime(abschnitt, "ankunft") ||
    getStopTime(abschnitt.zielHalt, "ankunft") ||
    abschnitt.halte?.[abschnitt.halte.length - 1]?.ankunft?.sollzeit ||
    ""
  )
}

function hasIntervalTimes(interval: { abfahrtsZeitpunkt?: string; ankunftsZeitpunkt?: string }): boolean {
  return Boolean(interval.abfahrtsZeitpunkt && interval.ankunftsZeitpunkt)
}

function hasUsableIntervalTimes(data: { allIntervals?: Array<{ abfahrtsZeitpunkt?: string; ankunftsZeitpunkt?: string }> } | undefined): boolean {
  return Boolean(data?.allIntervals?.some(hasIntervalTimes))
}

// Main API call function for best price search
export async function getBestPrice(config: any): Promise<{ result: TrainResults | null; wasApiCall: boolean; recordedAt: number }> {
  const dateObj = config.anfrageDatum as Date
  const sessionId = config.sessionId // Session ID von der Hauptanfrage
  // Format date like the working curl: "2025-07-26T08:00:00"
  const datum = formatDateKey(dateObj) + "T08:00:00"
  const tag = formatDateKey(dateObj)

  // Im Flexpreis-Modus wird zusätzlich zur Tagesbestpreis-Abfrage der
  // Streckentarif über recon ermittelt.
  const tarif = config.tarif === "FLEXPREIS" ? "FLEXPREIS" : "SPARPREIS"
  const isFlexpreis = tarif === "FLEXPREIS"

  // Cache-Key generieren (ohne maximaleUmstiege, da wir alle Verbindungen cachen)
  const cacheKey = generateCacheKey({
    startStationId: config.startStationNormalizedId, // Verwende normalisierte ID
    zielStationId: config.zielStationNormalizedId,   // Verwende normalisierte ID
    date: tag,
    alter: config.alter,
    ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
    ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
    klasse: config.klasse,
    schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
    umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
    tarif,
  })

  // Prüfe Cache
  const cachedResult = getCachedResult(cacheKey)
  let refreshMalformedCache = false
  if (cachedResult.data && !cachedResult.needsRefresh) {
    metricsCollector.recordCacheHit('connection')
    
    const cachedData = cachedResult.data[tag]
    if (cachedData && cachedData.allIntervals && hasUsableIntervalTimes(cachedData)) {
      // Zeitfilterung auf gecachte Daten anwenden - KORRIGIERT mit Datum-Check!
      const filteredIntervals = cachedData.allIntervals.filter((interval: any) => {
        return passesTimeFilter(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt, {
          abfahrtAb: config.abfahrtAb,
          abfahrtBis: config.abfahrtBis,
          ankunftAb: config.ankunftAb,
          ankunftBis: config.ankunftBis,
        })
      })
      
      // Umstiegs-Filterung auf gecachte Daten anwenden
      const umstiegsFilteredIntervals = filteredIntervals.filter((interval: any) => {
        // Wenn kein Filter gesetzt ist (undefined, null, "alle"), alle Verbindungen erlauben
        if (config.maximaleUmstiege === undefined || 
            config.maximaleUmstiege === null || 
            config.maximaleUmstiege === "") {
          return true // Alle Verbindungen
        }
        // Nur Direktverbindungen
        if (config.maximaleUmstiege === 0 || config.maximaleUmstiege === "0") {
          return interval.umstiegsAnzahl === 0
        }
        // Maximal X Umstiege
        return interval.umstiegsAnzahl <= Number(config.maximaleUmstiege)
      })
      
      logDebug(LOG_SCOPE, "📦 Connection cache hit; returning filtered cached offers", {
        ...routeContext(config, tag),
        cachedIntervals: cachedData.allIntervals.length,
        afterTimeFilter: filteredIntervals.length,
        afterTransferFilter: umstiegsFilteredIntervals.length,
      })
      
      if (umstiegsFilteredIntervals.length === 0) {
        return {
          result: { [tag]: { preis: 0, info: "Keine Verbindungen im gewählten Zeitraum/mit gewählten Umstiegs-Optionen!", abfahrtsZeitpunkt: "", ankunftsZeitpunkt: "", allIntervals: [] } },
          wasApiCall: false,
          recordedAt: cachedResult.recordedAt ?? Date.now()
        }
      }
      
      // Finde günstigste Verbindung
      const minPreis = Math.min(...umstiegsFilteredIntervals.map((iv: any) => iv.preis))
      const bestInterval = umstiegsFilteredIntervals.find((interval: any) => interval.preis === minPreis)
      
      // Erstelle Connection-IDs für gefilterte Verbindungen
      const filteredConnectionIds = umstiegsFilteredIntervals.map((interval: any) => 
        generateConnectionId(
          config.startStationNormalizedId,
          config.zielStationNormalizedId,
          interval.abfahrtsZeitpunkt,
          interval.ankunftsZeitpunkt,
          interval.umstiegsAnzahl
        )
      )
      
      // Lade Preishistorie nur für die gefilterten Connection-IDs
      const dayPriceHistory = getDayPriceHistory({
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse
      }, filteredConnectionIds)
      
      const intervalsWithHistory = umstiegsFilteredIntervals.map((interval: any) => ({
        ...interval,
        priceHistory: getConnectionPriceHistory({
          connectionId: generateConnectionId(
            config.startStationNormalizedId,
            config.zielStationNormalizedId,
            interval.abfahrtsZeitpunkt,
            interval.ankunftsZeitpunkt,
            interval.umstiegsAnzahl
          ),
          alter: config.alter,
          ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
          ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
          klasse: config.klasse
        })
      }))
      const filteredResult = {
        [tag]: {
          preis: minPreis,
          info: bestInterval?.info || "",
          abfahrtsZeitpunkt: bestInterval?.abfahrtsZeitpunkt || "",
          ankunftsZeitpunkt: bestInterval?.ankunftsZeitpunkt || "",
          // Der Tagestarif hängt nicht von den Zeit- und Umstiegsfiltern ab
          // und wird deshalb unverändert aus dem Cache übernommen.
          ...(cachedData.flexPreis !== undefined && { flexPreis: cachedData.flexPreis }),
          allIntervals: intervalsWithHistory.sort((a: any, b: any) => a.preis - b.preis) as IntervalDetails[],
          priceHistory: dayPriceHistory
        }
      }
      return { result: filteredResult, wasApiCall: false, recordedAt: cachedResult.recordedAt ?? Date.now() }
    }
    if (cachedData?.allIntervals && !hasUsableIntervalTimes(cachedData)) {
      refreshMalformedCache = true
      logDebug(LOG_SCOPE, "♻️ Connection cache entry has no journey times; refreshing from Bahn API", {
        ...routeContext(config, tag),
        cachedIntervals: cachedData.allIntervals.length,
      })
    } else if (cachedData) {
      // Fallback für alte Cache-Einträge ohne allIntervals
      // Für alte Cache-Einträge ohne Filter-Info
      const allConnectionIds = Array.isArray(cachedData.allIntervals)
        ? cachedData.allIntervals.map((iv: any) => 
            `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${iv.abfahrtsZeitpunkt}-${iv.ankunftsZeitpunkt}-${iv.umstiegsAnzahl ?? 0}`
          )
        : []
      
      const normalizedCachedData: TrainResult = {
        ...cachedData,
        priceHistory: getDayPriceHistory({
          startStationId: config.startStationNormalizedId,
          zielStationId: config.zielStationNormalizedId,
          date: tag,
          alter: config.alter,
          ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
          ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
          klasse: config.klasse
        }, allConnectionIds), // KEINE timeFilters
        allIntervals: Array.isArray(cachedData.allIntervals)
          ? cachedData.allIntervals.map((iv: any) => ({
              ...iv,
              priceHistory: getConnectionPriceHistory({
                connectionId: `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${iv.abfahrtsZeitpunkt}-${iv.ankunftsZeitpunkt}-${iv.umstiegsAnzahl ?? 0}`,
                alter: config.alter,
                ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
                ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
                klasse: config.klasse
              }),
              abschnitte: Array.isArray(iv.abschnitte)
                ? iv.abschnitte.map((a: any) => ({
                    abfahrtsZeitpunkt: a.abfahrtsZeitpunkt,
                    ankunftsZeitpunkt: a.ankunftsZeitpunkt,
                    abfahrtsOrt: a.abfahrtsOrt,
                    ankunftsOrt: a.ankunftsOrt,
                  }))
                : [],
            }))
          : [],
      }
      return { result: { [tag]: normalizedCachedData }, wasApiCall: false, recordedAt: cachedResult.recordedAt ?? Date.now() }
    }
  }

  // Wenn Cache veraltet oder nicht vorhanden, fahre mit API-Call fort
  if (refreshMalformedCache) {
    metricsCollector.recordCacheStale('connection')
  } else if (cachedResult.data && cachedResult.needsRefresh) {
    metricsCollector.recordCacheStale('connection')
    logDebug(LOG_SCOPE, "♻️ Connection cache entry stale; refreshing from Bahn API", routeContext(config, tag))
  } else {
    logDebug(LOG_SCOPE, "🌐 Connection cache miss; fetching from Bahn API", routeContext(config, tag))
    metricsCollector.recordCacheMiss('connection')
  }

  // Match the EXACT working curl request structure
  const requestBody: any = {
    abfahrtsHalt: config.abfahrtsHalt,
    anfrageZeitpunkt: datum,
    ankunftsHalt: config.ankunftsHalt,
    ankunftSuche: "ABFAHRT",
    klasse: config.klasse,
    produktgattungen: ["ICE", "EC_IC", "IR", "REGIONAL", "SBAHN", "BUS", "SCHIFF", "UBAHN", "TRAM", "ANRUFPFLICHTIG"],
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
    schnelleVerbindungen: config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true",
    sitzplatzOnly: false,
    bikeCarriage: false,
    reservierungsKontingenteVorhanden: false,
    nurDeutschlandTicketVerbindungen: false,
    deutschlandTicketVorhanden: false,
  }

  // Add minUmstiegszeit only if provided
  if (config.umstiegszeit && config.umstiegszeit !== "" && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined" && typeof config.umstiegszeit !== 'undefined') {
    requestBody.minUmstiegszeit = parseInt(config.umstiegszeit)
  }

  const requestId = `${tag}-${config.startStationNormalizedId}-${config.zielStationNormalizedId}`
  const apiCallStartTime = Date.now()

  try {
    // API-Call über globalen Rate Limiter
    const apiCallResult = await globalRateLimiter.addToQueue(requestId, async () => {
      // Prüfe Session-Abbruch direkt vor API-Call
      if (sessionId && globalRateLimiter.isSessionCancelledSync(sessionId)) {
        throw new Error(`Session ${sessionId} was cancelled`)
      }
      
      logDebug(LOG_SCOPE, "🌐 Bahn price API request started", {
        ...routeContext(config, tag),
        requestId,
      })
      // Match the working curl headers exactly
      const response = await fetchBahn("https://www.bahn.de/web/api/angebote/tagesbestpreis", {
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

      if (!response.ok) {
        let errorText = ""
        try {
          errorText = await response.text()
          if (response.status === 429) {
            logWarn(LOG_SCOPE, "Bahn price API rate limit response", {
              ...routeContext(config, tag),
              requestId,
              status: response.status,
            })
          } else {
            logError(LOG_SCOPE, "Bahn price API returned an error response", errorText.slice(0, 300), {
              ...routeContext(config, tag),
              requestId,
              status: response.status,
            })
          }
        } catch (e) {
          // keep logs quiet for 429
          if (response.status !== 429) {
            logWarn(LOG_SCOPE, "Could not read Bahn API error response body", {
              ...routeContext(config, tag),
              requestId,
              status: response.status,
            })
          }
        }
        // Record failed API request
        const apiDuration = Date.now() - apiCallStartTime
        metricsCollector.recordBahnApiRequest(apiDuration, response.status)
        
        // Return sentinel instead of throwing to keep logs clean; rate limiter interprets this
        return { __httpStatus: response.status, __errorText: errorText.slice(0, 100) }
      }

      // Record successful API request
      const apiDuration = Date.now() - apiCallStartTime
      metricsCollector.recordBahnApiRequest(apiDuration, response.status)

      return await response.text()
    }, sessionId)

    const responseText = apiCallResult

    // Handle sentinel results quietly (should be retried by rate limiter)
    if (typeof responseText !== 'string') {
      const status = (responseText as any)?.__httpStatus
      const errText = (responseText as any)?.__errorText || ''
      if (status === 429) {
        logWarn(LOG_SCOPE, "Bahn price API request was rate limited; rate limiter will retry", {
          ...routeContext(config, tag),
          status,
        })
        const result = { [tag]: { preis: 0, info: 'Rate limited, retrying', abfahrtsZeitpunkt: '', ankunftsZeitpunkt: '' } }
        return { result, wasApiCall: true, recordedAt: Date.now() }
      }
      const result = { [tag]: { preis: 0, info: `API Error: HTTP ${status}: ${errText}`, abfahrtsZeitpunkt: '', ankunftsZeitpunkt: '' } }
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    // Check if response contains error message
    if (responseText.includes("Preisauskunft nicht möglich")) {
      logDebug(LOG_SCOPE, "ℹ️ Bahn price API has no price information for travel date", routeContext(config, tag))
      const result = { [tag]: { preis: 0, info: "Kein Bestpreis verfügbar!", abfahrtsZeitpunkt: "", ankunftsZeitpunkt: "" } }
      setCachedResult(cacheKey, result, {
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse,
        schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
        umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
      })
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      logError(LOG_SCOPE, "Could not parse Bahn price API response", parseError, routeContext(config, tag))
      const errorResult = {
        [tag]: {
          preis: 0,
          info: "JSON Parse Error",
          abfahrtsZeitpunkt: "",
          ankunftsZeitpunkt: "",
        },
      }
      return { result: errorResult, wasApiCall: true, recordedAt: Date.now() }
    }

    if (!data || !data.intervalle) {
      logDebug(LOG_SCOPE, "ℹ️ Bahn price API response contained no intervals", routeContext(config, tag))
      const result = { [tag]: { preis: 0, info: "Keine Intervalle gefunden!", abfahrtsZeitpunkt: "", ankunftsZeitpunkt: "" } }
      setCachedResult(cacheKey, result, {
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse,
        schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
        umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
      })
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    logDebug(LOG_SCOPE, "📥 Bahn price API response parsed", {
      ...routeContext(config, tag),
      rawIntervals: data.intervalle.length,
    })

  // Sammle alle Intervalle
  const finalAllIntervals: IntervalDetails[] = []
  // ctxRecon-Handles für die Flexpreis-Abfrage. Sie werden bewusst nicht im
  // Cache abgelegt: es sind lange Strings je Verbindung, während der daraus
  // ermittelte Tagestarif eine einzelne Zahl ist.
  const flexpreisSources: FlexpreisSampleSource[] = []
  let skippedTeilpreisOffers = 0
    
    for (const iv of data.intervalle) {
      if (iv.preis && typeof iv.preis === "object" && "betrag" in iv.preis && Array.isArray(iv.verbindungen)) {
        for (const verbindung of iv.verbindungen) {
          // Teilpreise (z. B. bei gemischten Betreibern wie Flixtrain) verfälschen den Gesamtpreis
          // und werden deshalb standardmäßig ignoriert.
          if (verbindung.teilpreis === true || verbindung.teilpreis === "true") {
            skippedTeilpreisOffers += 1
            continue
          }

          // Skip connections without price information
          if (!verbindung.abPreis || typeof verbindung.abPreis !== "object" || !("betrag" in verbindung.abPreis)) {
            continue
          }
          
          const newPreis = verbindung.abPreis.betrag
          
          if (verbindung.verbindung && verbindung.verbindung.verbindungsAbschnitte && verbindung.verbindung.verbindungsAbschnitte.length > 0) {
            const abschnitte = verbindung.verbindung.verbindungsAbschnitte.map((abschnitt: any) => ({
              abfahrtsZeitpunkt: getSectionDepartureTime(abschnitt),
              ankunftsZeitpunkt: getSectionArrivalTime(abschnitt),
              abfahrtsOrt: abschnitt.abfahrtsOrt,
              ankunftsOrt: abschnitt.ankunftsOrt,
              abfahrtsOrtExtId: abschnitt.abfahrtsOrtExtId,
              ankunftsOrtExtId: abschnitt.ankunftsOrtExtId,
              verkehrsmittel: abschnitt.verkehrsmittel ? {
                produktGattung: abschnitt.verkehrsmittel.produktGattung,
                kategorie: abschnitt.verkehrsmittel.kategorie,
                name: abschnitt.verkehrsmittel.name,
                mittelText: abschnitt.verkehrsmittel.mittelText
              } : undefined
            }))
            const info = abschnitte.map((a: IntervalAbschnitt) => `${a.abfahrtsOrt} → ${a.ankunftsOrt}`).join(' | ')
            finalAllIntervals.push({
              preis: newPreis,
              abschnitte,
              abfahrtsZeitpunkt: abschnitte[0].abfahrtsZeitpunkt,
              ankunftsZeitpunkt: abschnitte[abschnitte.length-1].ankunftsZeitpunkt,
              abfahrtsOrt: abschnitte[0].abfahrtsOrt,
              ankunftsOrt: abschnitte[abschnitte.length-1].ankunftsOrt,
              info,
              umstiegsAnzahl: verbindung.verbindung.umstiegsAnzahl || 0,
              // Keine isCheapestPerInterval-Markierung hier - wird in route.ts gemacht
            })

            if (isFlexpreis && typeof verbindung.verbindung.ctxRecon === "string") {
              flexpreisSources.push({
                ctxRecon: verbindung.verbindung.ctxRecon,
                routingSignature: buildRoutingSignature(abschnitte),
              })
            }
          }
        }
      }
    }

    if (skippedTeilpreisOffers > 0) {
      logDebug(LOG_SCOPE, "🚫 Ignored partial-price offers without reliable total fare", {
        ...routeContext(config, tag),
        skippedOffers: skippedTeilpreisOffers,
      })
    }

    if (finalAllIntervals.length === 0) {
      const result = {
        [tag]: {
          preis: 0,
          info: skippedTeilpreisOffers > 0
            ? "Nur Teilpreise verfügbar (kein verwertbarer Gesamtpreis)"
            : "Keine verwertbaren Verbindungen gefunden!",
          abfahrtsZeitpunkt: "",
          ankunftsZeitpunkt: "",
          allIntervals: [],
        },
      }

      setCachedResult(cacheKey, result, {
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse,
        schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
        umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
      })

      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    // Flexpreis des Reisetags ermitteln. Schlaegt die Abfrage fehl, bleibt das
    // Feld leer und die Oberflaeche zeigt den Tag als ohne Flexpreis an,
    // statt fälschlich einen Sparpreis als Flexpreis auszuweisen.
    let flexPreis: number | null = null
    if (isFlexpreis) {
      flexPreis = await fetchFlexpreisForDay(
        flexpreisSources,
        {
          klasse: config.klasse,
          alter: config.alter,
          ermaessigungArt: config.ermaessigungArt,
          ermaessigungKlasse: config.ermaessigungKlasse,
          sessionId,
        },
        tag
      )
    }

    // Erstelle vollständigen Cache-Eintrag mit ALLEN Verbindungen (ohne Markierung)
    const fullResult = {
      [tag]: {
        preis: 0, // Wird später in route.ts gesetzt
        info: "",
        abfahrtsZeitpunkt: "",
        ankunftsZeitpunkt: "",
        ...(flexPreis !== null && { flexPreis }),
        allIntervals: finalAllIntervals.sort((a, b) => a.preis - b.preis), // Sort by price
      },
    }

    // Cache ALLE Daten (ohne Zeitfilter).
    // Im Flexpreis-Modus nur cachen, wenn der Tarif wirklich ermittelt wurde.
    // Sonst wuerde ein abgebrochener oder fehlgeschlagener Lauf den Tag eine
    // Stunde lang als "kein Preis" festschreiben, obwohl ein neuer Versuch
    // sofort Erfolg haette.
    if (!isFlexpreis || flexPreis !== null) {
      setCachedResult(cacheKey, fullResult, {
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse,
        schnelleVerbindungen: Boolean(config.schnelleVerbindungen === true || config.schnelleVerbindungen === "true"),
        umstiegszeit: (config.umstiegszeit && config.umstiegszeit !== "normal" && config.umstiegszeit !== "undefined") ? config.umstiegszeit : undefined,
      })
    }

    // Jetzt Zeitfilter für aktuelle Anfrage anwenden
    const timeFilteredIntervals = finalAllIntervals.filter(interval =>
      passesTimeFilter(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt, {
        abfahrtAb: config.abfahrtAb,
        abfahrtBis: config.abfahrtBis,
        ankunftAb: config.ankunftAb,
        ankunftBis: config.ankunftBis
      })
    )

    // Umstiegs-Filterung anwenden
    const umstiegsFilteredIntervals = timeFilteredIntervals.filter(interval => {
      if (config.maximaleUmstiege === undefined || 
          config.maximaleUmstiege === null || 
          config.maximaleUmstiege === "alle" || 
          config.maximaleUmstiege === "") {
        return true
      }
      if (config.maximaleUmstiege === 0 || config.maximaleUmstiege === "0") {
        return interval.umstiegsAnzahl === 0
      }
      return interval.umstiegsAnzahl <= Number(config.maximaleUmstiege)
    })

    logDebug(LOG_SCOPE, "🔍 Bahn API offers filtered for request", {
      ...routeContext(config, tag),
      rawOffers: finalAllIntervals.length,
      afterTimeFilter: timeFilteredIntervals.length,
      afterTransferFilter: umstiegsFilteredIntervals.length,
      skippedPartialPriceOffers: skippedTeilpreisOffers,
    })

    if (umstiegsFilteredIntervals.length === 0) {
      logDebug(LOG_SCOPE, "ℹ️ No offers remain after request filters", routeContext(config, tag))
      // Auch für leere Ergebnisse die Historie mit Zeitfiltern
      const emptyDayHistory = getDayPriceHistory({
        startStationId: config.startStationNormalizedId,
        zielStationId: config.zielStationNormalizedId,
        date: tag,
        alter: config.alter,
        ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
        ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
        klasse: config.klasse
      }, []) // Leere Liste
      
      const result = { 
        [tag]: { 
          preis: 0, 
          info: "Keine Verbindungen mit den gewählten Umstiegs-Optionen!", 
          abfahrtsZeitpunkt: "", 
          ankunftsZeitpunkt: "", 
          allIntervals: [],
          priceHistory: emptyDayHistory
        } 
      }
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }

    // Lade Preishistorie für diesen Tag - NUR für die gefilterten Verbindungen
    const filteredConnectionIds = umstiegsFilteredIntervals.map(interval => 
      `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.umstiegsAnzahl}`
    )
    
    const dayPriceHistory = getDayPriceHistory({
      startStationId: config.startStationNormalizedId,
      zielStationId: config.zielStationNormalizedId,
      date: tag,
      alter: config.alter,
      ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
      ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
      klasse: config.klasse
    }, filteredConnectionIds) // KEINE timeFilters mehr - IDs sind bereits gefiltert

    // Finde günstigste Verbindung für Bestpreis-Anzeige
    const bestPrice = Math.min(...umstiegsFilteredIntervals.map(iv => iv.preis))
    const bestInterval = umstiegsFilteredIntervals.find(interval => interval.preis === bestPrice)

    // Lade Preishistorie für jede Verbindung
    const sortedFilteredIntervalsWithHistory = umstiegsFilteredIntervals
      .map(interval => ({
        ...interval,
        priceHistory: getConnectionPriceHistory({
          connectionId: `${config.startStationNormalizedId}-${config.zielStationNormalizedId}-${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.umstiegsAnzahl}`,
          alter: config.alter,
          ermaessigungArt: config.ermaessigungArt || "KEINE_ERMAESSIGUNG",
          ermaessigungKlasse: config.ermaessigungKlasse || "KLASSENLOS",
          klasse: config.klasse
        })
      }))
      .sort((a, b) => a.preis - b.preis)

    const result = {
      [tag]: {
        preis: bestPrice,
        info: bestInterval?.info || "",
        abfahrtsZeitpunkt: bestInterval?.abfahrtsZeitpunkt || "",
        ankunftsZeitpunkt: bestInterval?.ankunftsZeitpunkt || "",
        ...(flexPreis !== null && { flexPreis }),
        allIntervals: sortedFilteredIntervalsWithHistory,
        priceHistory: dayPriceHistory
      },
    }

    return { result, wasApiCall: true, recordedAt: Date.now() }
    } catch (error) {
      // Spezielle Behandlung für cancelled sessions
      if (error instanceof Error && error.message.includes('was cancelled')) {
        // Kein zusätzliches Logging - wird bereits in route.ts gehandelt
        const result = {
          [tag]: {
            preis: 0,
            info: "Search cancelled",
            abfahrtsZeitpunkt: "",
            ankunftsZeitpunkt: "",
          },
        }
        return { result, wasApiCall: true, recordedAt: Date.now() }
      }
      // 429 nur informativ loggen, nicht als Fehler
      if (error instanceof Error && (error.message.includes('429') || error.message.includes('Too Many Requests'))) {
        logWarn(LOG_SCOPE, "Bahn price API request rate limited", {
          ...routeContext(config, tag),
          error: error.message,
        })
      } else {
        metricsCollector.recordBahnApiRequest(Date.now() - apiCallStartTime, 500)
        logError(LOG_SCOPE, "Bahn price API request failed", error, routeContext(config, tag))
      }
      const result = {
        [tag]: {
          preis: 0,
          info: `API Error: ${error instanceof Error ? error.message : "Unknown"}`,
          abfahrtsZeitpunkt: "",
          ankunftsZeitpunkt: "",
        },
      }
      return { result, wasApiCall: true, recordedAt: Date.now() }
    }
}
