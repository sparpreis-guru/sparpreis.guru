import { type NextRequest, NextResponse } from "next/server"
import { globalRateLimiter } from './rate-limiter'
import { searchBahnhof, getBestPrice } from './bahn-api'
import { updateProgress, updateAverageResponseTimes, getAverageResponseTimes, passesTimeFilter } from './utils'
import { generateCacheKey, getCachedResult, getCacheSize, getStationSearchCacheSize, type PriceHistoryEntry } from './cache'
import { recommendBestPrice } from '@/lib/train-search/recommendation-engine'
import { metricsCollector } from '@/app/api/metrics/collector'
import { logDebug, logError, logInfo } from '@/lib/shared/logger'
import { getEarliestSearchDateKey } from '@/lib/shared/berlin-date'
import { getFeasibleReturnSearchDates } from '@/lib/search/return-search-feasibility'

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOG_SCOPE = "bestpreissuche.request"
const MAX_DAYS_PER_DIRECTION = 30
const MAX_TRAVEL_COMBINATIONS = 20

function formatTimeWindow(abfahrtAb?: string, abfahrtBis?: string, ankunftAb?: string, ankunftBis?: string): string {
  if (!abfahrtAb && !abfahrtBis && !ankunftAb && !ankunftBis) return "beliebig"
  return `Abfahrt ${abfahrtAb || "beliebig"}-${abfahrtBis || "beliebig"}, Ankunft ${ankunftAb || "beliebig"}-${ankunftBis || "beliebig"}`
}

interface TrainResult {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  recordedAt?: number
  priceHistory?: PriceHistoryEntry[]
  allIntervals?: Array<{
    preis: number
    abfahrtsZeitpunkt: string
    ankunftsZeitpunkt: string
    abfahrtsOrt: string
    ankunftsOrt: string
    info: string
    umstiegsAnzahl: number
    isCheapestPerInterval?: boolean
    priceHistory?: PriceHistoryEntry[]
    abschnitte?: Array<{
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
    }>
  }>
}

interface TrainResults {
  [date: string]: TrainResult
}

interface JourneyLeg {
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  verkehrsmittel?: {
    produktGattung?: string
    kategorie?: string
    name?: string
    mittelText?: string
  }
}

interface TravelCombination {
  outwardDate: string
  returnDate: string
  nights: number
  outwardPrice: number
  returnPrice: number
  totalPrice: number
  outwardDeparture: string
  outwardArrival: string
  returnDeparture: string
  returnArrival: string
  outwardTransfers?: number
  returnTransfers?: number
  outwardLegs?: JourneyLeg[]
  returnLegs?: JourneyLeg[]
}

function parseDateAtNoon(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function getNights(outwardDate: string, returnDate: string) {
  const diffMs = parseDateAtNoon(returnDate).getTime() - parseDateAtNoon(outwardDate).getTime()
  return Math.round(diffMs / 86_400_000)
}

interface SearchRequestOrderEntry {
  direction: "outward" | "return"
  index: number
}

function buildPrioritizedRequestOrder(
  outwardDates: string[],
  returnDates: string[],
  minNights: number,
  maxNights?: number
): SearchRequestOrderEntry[] {
  const requestOrder: SearchRequestOrderEntry[] = []
  const queuedReturnIndexes = new Set<number>()

  outwardDates.forEach((outwardDate, outwardIndex) => {
    requestOrder.push({ direction: "outward", index: outwardIndex })

    const earliestReturnIndex = returnDates.findIndex((returnDate) => {
      const nights = getNights(outwardDate, returnDate)
      return nights >= minNights && (maxNights === undefined || nights <= maxNights)
    })

    if (earliestReturnIndex >= 0 && !queuedReturnIndexes.has(earliestReturnIndex)) {
      queuedReturnIndexes.add(earliestReturnIndex)
      requestOrder.push({ direction: "return", index: earliestReturnIndex })
    }
  })

  returnDates.forEach((_, returnIndex) => {
    if (!queuedReturnIndexes.has(returnIndex)) {
      requestOrder.push({ direction: "return", index: returnIndex })
    }
  })

  return requestOrder
}

function hasJourneyTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function getDisplayInterval(data: TrainResult) {
  const intervals = Array.isArray(data.allIntervals) ? data.allIntervals : []
  if (intervals.length === 0) return undefined

  const matchingPriceInterval = intervals.find(
    (interval) =>
      interval.preis === data.preis &&
      hasJourneyTimestamp(interval.abfahrtsZeitpunkt) &&
      hasJourneyTimestamp(interval.ankunftsZeitpunkt)
  )

  return (
    matchingPriceInterval ||
    intervals.find(
      (interval) =>
        hasJourneyTimestamp(interval.abfahrtsZeitpunkt) &&
        hasJourneyTimestamp(interval.ankunftsZeitpunkt)
    )
  )
}

function getJourneyTimes(data: TrainResult) {
  const displayInterval = getDisplayInterval(data)
  const legs = Array.isArray(displayInterval?.abschnitte)
    ? displayInterval.abschnitte.map((leg) => ({
        abfahrtsZeitpunkt: leg.abfahrtsZeitpunkt,
        ankunftsZeitpunkt: leg.ankunftsZeitpunkt,
        abfahrtsOrt: leg.abfahrtsOrt,
        ankunftsOrt: leg.ankunftsOrt,
        verkehrsmittel: leg.verkehrsmittel,
      }))
    : []

  return {
    departure:
      data.abfahrtsZeitpunkt ||
      displayInterval?.abfahrtsZeitpunkt ||
      legs[0]?.abfahrtsZeitpunkt ||
      "",
    arrival:
      data.ankunftsZeitpunkt ||
      displayInterval?.ankunftsZeitpunkt ||
      legs[legs.length - 1]?.ankunftsZeitpunkt ||
      "",
    transfers: displayInterval?.umstiegsAnzahl || 0,
    legs,
  }
}

function buildTravelCombinations(
  outwardResults: TrainResults,
  returnResults: TrainResults,
  minNights: number,
  maxNights?: number
): TravelCombination[] {
  const combinations: TravelCombination[] = []

  for (const [outwardDate, outwardData] of Object.entries(outwardResults)) {
    if (!outwardData || outwardData.preis <= 0) continue

    for (const [returnDate, returnData] of Object.entries(returnResults)) {
      if (!returnData || returnData.preis <= 0) continue

      const nights = getNights(outwardDate, returnDate)
      if (nights < minNights) continue
      if (typeof maxNights === "number" && nights > maxNights) continue

      const outwardJourney = getJourneyTimes(outwardData)
      const returnJourney = getJourneyTimes(returnData)

      combinations.push({
        outwardDate,
        returnDate,
        nights,
        outwardPrice: outwardData.preis,
        returnPrice: returnData.preis,
        totalPrice: Math.round((outwardData.preis + returnData.preis) * 100) / 100,
        outwardDeparture: outwardJourney.departure,
        outwardArrival: outwardJourney.arrival,
        returnDeparture: returnJourney.departure,
        returnArrival: returnJourney.arrival,
        outwardTransfers: outwardJourney.transfers,
        returnTransfers: returnJourney.transfers,
        outwardLegs: outwardJourney.legs.length > 0 ? outwardJourney.legs : undefined,
        returnLegs: returnJourney.legs.length > 0 ? returnJourney.legs : undefined,
      })
    }
  }

  return combinations
    .sort((a, b) => {
      if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice
      if (a.nights !== b.nights) return a.nights - b.nights
      return a.outwardDate.localeCompare(b.outwardDate)
    })
    .slice(0, MAX_TRAVEL_COMBINATIONS)
}

export async function POST(request: NextRequest) {
  // Track search start time for metrics
  const searchStartTime = Date.now()
  
  try {
    const body = await request.json()
    const {
      sessionId: providedSessionId,
      start,
      ziel,
      reisezeitraumAb,
      reisezeitraumBis,
      wochentage, // Changed from 'tage' to 'wochentage'
      returnWochentage,
      alter,
      ermaessigungArt,
      ermaessigungKlasse,
      klasse,
      schnelleVerbindungen,
      nurDeutschlandTicketVerbindungen,
      maximaleUmstiege,
      abfahrtAb,
      abfahrtBis,
      ankunftAb,
      ankunftBis,
      rueckfahrt,
      minNaechte,
      maxNaechte,
      returnAbfahrtAb,
      returnAbfahrtBis,
      returnAnkunftAb,
      returnAnkunftBis,
      umstiegszeit,
      requestedOutwardDates,
      requestedReturnDates,
    } = body

    const earliestSearchDate = getEarliestSearchDateKey()
    if (typeof reisezeitraumAb !== "string" || reisezeitraumAb < earliestSearchDate) {
      return NextResponse.json(
        {
          error: `Der früheste Reisetag ist ${earliestSearchDate} (Europe/Berlin).`,
          earliestSearchDate,
        },
        { status: 400 }
      )
    }

    // Calculate dates first
    const availableOutwardDates = calculateDatesFromWeekdays(
      reisezeitraumAb,
      reisezeitraumBis,
      wochentage || [1, 2, 3, 4, 5, 6, 0]
    )
    const returnSearchEnabled = rueckfahrt === "1" || rueckfahrt === true
    const availableReturnDates = returnSearchEnabled
      ? calculateDatesFromWeekdays(
          reisezeitraumAb,
          reisezeitraumBis,
          returnWochentage || wochentage || [1, 2, 3, 4, 5, 6, 0]
        )
      : []
    const parsedMinNights = Number.parseInt(String(minNaechte || "1"), 10)
    const parsedMaxNights = maxNaechte ? Number.parseInt(String(maxNaechte), 10) : undefined
    const normalizedMinNights = Number.isFinite(parsedMinNights) && parsedMinNights > 0 ? parsedMinNights : 1
    const normalizedMaxNights =
      typeof parsedMaxNights === "number" && Number.isFinite(parsedMaxNights) && parsedMaxNights > 0
        ? parsedMaxNights
        : undefined
    const hasExplicitDateRequest = Array.isArray(requestedOutwardDates) || Array.isArray(requestedReturnDates)
    const selectRequestedDates = (requestedDates: unknown, availableDates: string[]) =>
      Array.isArray(requestedDates)
        ? [...new Set(requestedDates)].filter(
            (date): date is string => typeof date === "string" && availableDates.includes(date)
          ).slice(0, MAX_DAYS_PER_DIRECTION)
        : []

    let calculatedDates: string[]
    let calculatedReturnDates: string[]
    if (hasExplicitDateRequest) {
      calculatedDates = selectRequestedDates(requestedOutwardDates, availableOutwardDates)
      calculatedReturnDates = returnSearchEnabled
        ? selectRequestedDates(requestedReturnDates, availableReturnDates)
        : []
    } else if (returnSearchEnabled) {
      const feasibleDates = getFeasibleReturnSearchDates({
        outwardDates: availableOutwardDates,
        returnDates: availableReturnDates,
        minNights: normalizedMinNights,
        maxNights: normalizedMaxNights,
      })
      calculatedDates = feasibleDates.outwardDates.slice(0, MAX_DAYS_PER_DIRECTION)
      calculatedReturnDates = feasibleDates.returnDates.slice(0, MAX_DAYS_PER_DIRECTION)
    } else {
      calculatedDates = availableOutwardDates.slice(0, MAX_DAYS_PER_DIRECTION)
      calculatedReturnDates = []
    }

    if (calculatedDates.length === 0 && calculatedReturnDates.length === 0) {
      return NextResponse.json({ error: "Keine gültigen Reisetage für diese Anfrage." }, { status: 400 })
    }

    // Count the search immediately; cache split is known after station resolution.
    metricsCollector.recordUserSearch(
      Math.min(calculatedDates.length, MAX_DAYS_PER_DIRECTION) +
        Math.min(calculatedReturnDates.length, MAX_DAYS_PER_DIRECTION)
    )
    metricsCollector.recordStreamingConnection()

    logDebug(LOG_SCOPE, "📥 Bestpreissuche request received", {
      requestedStart: start,
      requestedDestination: ziel,
      fromDate: reisezeitraumAb,
      toDate: reisezeitraumBis,
      plannedDays: calculatedDates.length,
      plannedReturnDays: calculatedReturnDates.length,
      weekdays: wochentage,
      returnWeekdays: returnSearchEnabled ? (returnWochentage || wochentage) : undefined,
      timeWindow: formatTimeWindow(abfahrtAb, abfahrtBis, ankunftAb, ankunftBis),
      returnTimeWindow: returnSearchEnabled
        ? formatTimeWindow(returnAbfahrtAb, returnAbfahrtBis, returnAnkunftAb, returnAnkunftBis)
        : undefined,
      maxTransfers: maximaleUmstiege ?? "alle",
      travelClass: klasse,
    })
    // Search for stations
    const startStation = await searchBahnhof(start)
    const zielStation = await searchBahnhof(ziel)
        if (!startStation || !zielStation) {
      return NextResponse.json(
        {
          error: `Station not found. Start: ${startStation ? "✓" : "✗"}, Ziel: ${zielStation ? "✓" : "✗"}`,
        },
        { status: 404 },
      )
    }
    if (!start || !ziel) {
      return NextResponse.json({ error: "Start and destination required" }, { status: 400 })
    }

    // Verwende die übergebene sessionId oder generiere eine neue
    const sessionId = providedSessionId || crypto.randomUUID()
    logInfo(LOG_SCOPE, "🚂 Bestpreissuche gestartet", {
      sessionId,
      route: `${startStation.name} -> ${zielStation.name}`,
      fromDate: reisezeitraumAb,
      toDate: reisezeitraumBis,
      plannedDays: calculatedDates.length,
      plannedReturnDays: calculatedReturnDates.length,
      timeWindow: formatTimeWindow(abfahrtAb, abfahrtBis, ankunftAb, ankunftBis),
      returnTimeWindow: returnSearchEnabled
        ? formatTimeWindow(returnAbfahrtAb, returnAbfahrtBis, returnAnkunftAb, returnAnkunftBis)
        : undefined,
      maxTransfers: maximaleUmstiege ?? "alle",
      travelClass: klasse || "KLASSE_2",
      transferTimeMinutes: umstiegszeit && umstiegszeit !== "normal" ? umstiegszeit : undefined,
    })

    // Streaming Response Setup
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let isStreamClosed = false
        let cancelLoggedForSession = false
        let completeSent = false

        // Diese Variablen müssen im gesamten Scope sichtbar sein!
        let datesToProcess: string[] = []
        let returnDatesToProcess: string[] = []
        let maxDays = 0
        let metaData: any = undefined
        const results: TrainResults = {}
        const returnResults: TrainResults = {}
        const getCurrentTravelCombinations = () =>
          returnSearchEnabled
            ? buildTravelCombinations(results, returnResults, normalizedMinNights, normalizedMaxNights)
            : []

        // Helper function to safely enqueue data
        const safeEnqueue = (data: Uint8Array) => {
          if (!isStreamClosed) {
            try {
              controller.enqueue(data)
              return true
            } catch (error) {
              if (!cancelLoggedForSession) {
                logDebug(LOG_SCOPE, "Client disconnected; stopping Bestpreissuche stream", { sessionId })
                cancelLoggedForSession = true
              }
              isStreamClosed = true
              return false
            }
          }
          return false
        }
        
        // Helper function to safely close stream
        const safeClose = () => {
          if (!isStreamClosed) {
            try {
              controller.close()
              isStreamClosed = true
            } catch (error) {
              logDebug(LOG_SCOPE, "Bestpreissuche stream was already closed", { sessionId })
              isStreamClosed = true
            }
          }
        }
        
        // Helper to send final complete (idempotent)
        const sendFinalComplete = async () => {
          if (completeSent) return
          completeSent = true

          // Record search completion metrics
          const searchDuration = Date.now() - searchStartTime
          metricsCollector.recordSearchDuration(searchDuration)
          metricsCollector.recordUserSearchCompletion()

          // Hilfsfunktion: Zähle nur echte Tagesergebnisse
          function countProcessedDays(resultsObj: TrainResults) {
            return Object.entries(resultsObj).filter(
              ([key, val]) => key !== '_meta' && val && (val.preis > 0 || (val.preis === 0 && val.info && val.info !== 'Search cancelled'))
            ).length
          }

          const processedDays = countProcessedDays(results) + countProcessedDays(returnResults)
          const resultEntries = Object.entries(results).filter(([key]) => key !== "_meta")
          const successfulDays = resultEntries.filter(([, val]) => val?.preis > 0).length
          const cheapestPrice = Math.min(
            ...resultEntries
              .map(([, val]) => val?.preis ?? 0)
              .filter((price) => price > 0)
          )
          const cheapestDate = resultEntries.find(([, val]) => val?.preis === cheapestPrice)?.[0]
          const finalQueueStatus = globalRateLimiter.getQueueStatus()
          const finalAvgTimes = getAverageResponseTimes()
          const allDatesToProcess = [...datesToProcess, ...returnDatesToProcess]
          await updateProgress(
            sessionId,
            processedDays,
            maxDays,
            allDatesToProcess[maxDays - 1] || "",
            true,
            0,
            0,
            finalAvgTimes.uncached,
            finalAvgTimes.cached,
            finalQueueStatus.queueSize,
            finalQueueStatus.activeRequests
          )

          const resultsWithStations = {
            ...results,
            _meta: metaData,
          }
          const travelCombinations = getCurrentTravelCombinations()

          const completeResult = {
            type: 'complete',
            results: resultsWithStations,
            returnResults,
            travelCombinations,
            processedDays,
            plannedDays: maxDays
          }

          logInfo(LOG_SCOPE, "✅ Bestpreissuche abgeschlossen", {
            sessionId,
            route: `${startStation.name} -> ${zielStation.name}`,
            processedDays,
            plannedDays: maxDays,
            successfulDays,
            returnSuccessfulDays: Object.values(returnResults).filter((val) => val?.preis > 0).length,
            travelCombinations: travelCombinations.length,
            cheapestPrice: Number.isFinite(cheapestPrice) ? cheapestPrice : undefined,
            cheapestDate,
            durationMs: searchDuration,
          })

          if (safeEnqueue(encoder.encode(JSON.stringify(completeResult) + '\n'))) {
            safeClose()
          }
        }

        try {
          // Calculate dates from weekdays and date range
          datesToProcess = calculatedDates
          returnDatesToProcess = calculatedReturnDates
          maxDays = datesToProcess.length + returnDatesToProcess.length
          logDebug(LOG_SCOPE, "📅 Bestpreissuche date processing started", {
            sessionId,
            plannedDays: datesToProcess.length,
            plannedReturnDays: returnDatesToProcess.length,
            firstTravelDate: datesToProcess[0],
            lastTravelDate: datesToProcess[datesToProcess.length - 1],
            connectionCacheEntries: getCacheSize(),
          })

          // Update cache metrics
          const cacheSize = getCacheSize()
          // Assuming you have a way to get station cache size, otherwise use 0
          metricsCollector.updateCacheMetrics(getStationSearchCacheSize(), cacheSize)

          // Erstelle Liste aller Tage mit Cache-Status
          const dayStatusList: { date: string; isCached: boolean; cacheKey: string; direction: "outward" | "return" }[] = []
          for (const dateStr of datesToProcess) {
            const cacheKey = generateCacheKey({
              startStationId: startStation.normalizedId,
              zielStationId: zielStation.normalizedId,
              date: dateStr,
              alter: alter || "ERWACHSENER",
              ermaessigungArt: ermaessigungArt || "KEINE_ERMAESSIGUNG",
              ermaessigungKlasse: ermaessigungKlasse || "KLASSENLOS",
              klasse: klasse || "KLASSE_2",
              schnelleVerbindungen: Boolean(schnelleVerbindungen === true || schnelleVerbindungen === "true"),
              umstiegszeit: (umstiegszeit && umstiegszeit !== "normal" && umstiegszeit !== "undefined") ? umstiegszeit : undefined,
            })
            const cacheState = getCachedResult(cacheKey)
            const isCached = !!cacheState.data && !cacheState.needsRefresh
            dayStatusList.push({ date: dateStr, isCached, cacheKey, direction: "outward" })
          }
          for (const dateStr of returnDatesToProcess) {
            const cacheKey = generateCacheKey({
              startStationId: zielStation.normalizedId,
              zielStationId: startStation.normalizedId,
              date: dateStr,
              alter: alter || "ERWACHSENER",
              ermaessigungArt: ermaessigungArt || "KEINE_ERMAESSIGUNG",
              ermaessigungKlasse: ermaessigungKlasse || "KLASSENLOS",
              klasse: klasse || "KLASSE_2",
              schnelleVerbindungen: Boolean(schnelleVerbindungen === true || schnelleVerbindungen === "true"),
              umstiegszeit: (umstiegszeit && umstiegszeit !== "normal" && umstiegszeit !== "undefined") ? umstiegszeit : undefined,
            })
            const cacheState = getCachedResult(cacheKey)
            const isCached = !!cacheState.data && !cacheState.needsRefresh
            dayStatusList.push({ date: dateStr, isCached, cacheKey, direction: "return" })
          }

          // Gesamtanzahl der gecached und ungecachten Tage für die gesamte Suche
          let totalUncachedDays = dayStatusList.filter((d) => !d.isCached).length
          let totalCachedDays = dayStatusList.filter((d) => d.isCached).length

          // Update metrics with actual cached/uncached counts
          metricsCollector.incrementCounter('days_cached_total', totalCachedDays)
          metricsCollector.incrementCounter('days_uncached_total', totalUncachedDays)

          // Get average response times
          const avgTimes = getAverageResponseTimes()

          // Meta-Daten für Frontend
          metaData = {
            startStation: startStation,
            zielStation: zielStation,
            searchParams: {
              klasse,
              maximaleUmstiege,
              schnelleVerbindungen,
              nurDeutschlandTicketVerbindungen,
              abfahrtAb,
              abfahrtBis,
              ankunftAb,
              ankunftBis,
              wochentage,
              rueckfahrt: returnSearchEnabled ? "1" : undefined,
              minNaechte,
              maxNaechte,
              returnAbfahrtAb,
              returnAbfahrtBis,
              returnAnkunftAb,
              returnAnkunftBis,
              returnWochentage: returnSearchEnabled ? (returnWochentage || wochentage) : undefined,
              umstiegszeit,
            },
            sessionId,
          }

          if (!safeEnqueue(encoder.encode(JSON.stringify({ type: "meta", meta: metaData }) + "\n"))) {
            return
          }

          // Initialer Progress-Update - zeigt sofort die Queue-Size an
          const queueStatus = globalRateLimiter.getQueueStatus()
          await updateProgress(
            sessionId,
            0, // Start bei Tag 0
            maxDays,
            datesToProcess[0] || "",
            false,
            totalUncachedDays,
            totalCachedDays,
            avgTimes.uncached,
            avgTimes.cached,
            queueStatus.queueSize,
            queueStatus.activeRequests
          )

          // Requests zunächst als Tasks anlegen, damit Hin- und Rückfahrten
          // anschließend abwechselnd in derselben Session-Queue landen.
          const outwardRequestTasks = datesToProcess.map((currentDateStr, dayCount) => async () => {
            // Prüfe Session-Abbruch VOR jedem Request
            if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
              if (!cancelLoggedForSession) {
                logDebug(LOG_SCOPE, "Bestpreissuche session cancelled; stopping remaining dates", { sessionId })
                cancelLoggedForSession = true
              }
              return { currentDateStr, dayResponse: { result: null }, dayCount, direction: "outward" as const }
            }

            const isCached = dayStatusList[dayCount].isCached
            const currentDate = new Date(currentDateStr)
            const t0 = Date.now()

            // Konvertiere maximaleUmstiege explizit
            let processedMaxUmstiege: number | string | undefined = undefined
            if (maximaleUmstiege === "0" || maximaleUmstiege === 0) {
              processedMaxUmstiege = 0
            } else if (maximaleUmstiege !== undefined && maximaleUmstiege !== "alle" && maximaleUmstiege !== "" && maximaleUmstiege !== null) {
              processedMaxUmstiege = Number.parseInt(String(maximaleUmstiege))
            }
            // Falls maximaleUmstiege === undefined, null, "alle" oder "", bleibt processedMaxUmstiege = undefined (= alle Verbindungen)

            const dayResponse = await getBestPrice({
              abfahrtsHalt: startStation.id,
              ankunftsHalt: zielStation.id,
              startStationNormalizedId: startStation.normalizedId,
              zielStationNormalizedId: zielStation.normalizedId,
              anfrageDatum: currentDate,
              sessionId,
              alter,
              ermaessigungArt,
              ermaessigungKlasse,
              klasse,
              maximaleUmstiege: processedMaxUmstiege,
              schnelleVerbindungen: schnelleVerbindungen === true || schnelleVerbindungen === "1",
              nurDeutschlandTicketVerbindungen:
                nurDeutschlandTicketVerbindungen === true || nurDeutschlandTicketVerbindungen === "1",
              abfahrtAb,
              abfahrtBis,
              ankunftAb,
              ankunftBis,
              umstiegszeit,
            })

            // Füge recordedAt hinzu (mit Cast, da getBestPrice-Typ es nicht kennt)
            if (dayResponse.result && dayResponse.recordedAt) {
              for (const dateKey of Object.keys(dayResponse.result)) {
                const priceData = (dayResponse.result as any)[dateKey]
                if (priceData) {
                  (priceData as any).recordedAt = dayResponse.recordedAt
                }
              }
            }

            // Prüfe Session-Abbruch NACH dem Request aber VOR der Verarbeitung
            if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
              // Nur einmal loggen, nicht für jeden Tag
              return { currentDateStr, dayResponse: { result: null }, dayCount, direction: "outward" as const }
            }

            // Zeitfilter für Abfahrt/Ankunft anwenden (vereinheitlicht)
            if ((abfahrtAb || abfahrtBis || ankunftAb || ankunftBis) && dayResponse.result) {
              for (const dateKey of Object.keys(dayResponse.result)) {
                const priceData = dayResponse.result[dateKey]
                if (priceData && priceData.allIntervals && Array.isArray(priceData.allIntervals)) {
                  
                  const filteredIntervals = priceData.allIntervals.filter(interval => 
                    passesTimeFilter(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt, {
                      abfahrtAb,
                      abfahrtBis,
                      ankunftAb,
                      ankunftBis,
                    })
                  )

                  // WICHTIG: Aktualisiere allIntervals VOR der Bestpreis-Berechnung
                  priceData.allIntervals = filteredIntervals
                  
                  logDebug(LOG_SCOPE, "Applied additional time filter to day result", {
                    sessionId,
                    travelDate: dateKey,
                    afterTimeFilter: priceData.allIntervals.length,
                    timeWindow: formatTimeWindow(abfahrtAb, abfahrtBis, ankunftAb, ankunftBis),
                  })
                  
                  if (filteredIntervals.length === 0) {
                    priceData.preis = 0
                    priceData.abfahrtsZeitpunkt = ""
                    priceData.ankunftsZeitpunkt = ""
                    priceData.info = "Keine Verbindungen im gewählten Zeitfenster"
                  } else {
                    // Verwende intelligenten Algorithmus für Bestpreis-Auswahl
                    const recommendedTrip = recommendBestPrice(filteredIntervals)
                    
                    if (recommendedTrip) {
                      priceData.preis = recommendedTrip.preis
                      priceData.abfahrtsZeitpunkt = recommendedTrip.abfahrtsZeitpunkt
                      priceData.ankunftsZeitpunkt = recommendedTrip.ankunftsZeitpunkt
                      priceData.info = recommendedTrip.info
                    } else {
                      const minPrice = Math.min(...filteredIntervals.map(i => i.preis))
                      const bestPriceIntervals = filteredIntervals.filter(i => i.preis === minPrice)
                      bestPriceIntervals.sort((a, b) => {
                        const aDuration = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime()
                        const bDuration = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                        if (aDuration !== bDuration) return aDuration - bDuration
                        return new Date(a.abfahrtsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                      })
                      const bestInterval = bestPriceIntervals[0]
                      
                      priceData.preis = minPrice
                      priceData.abfahrtsZeitpunkt = bestInterval?.abfahrtsZeitpunkt || priceData.abfahrtsZeitpunkt
                      priceData.ankunftsZeitpunkt = bestInterval?.ankunftsZeitpunkt || priceData.ankunftsZeitpunkt
                      priceData.info = bestInterval?.info || priceData.info
                    }
                  }
                }
              }
            }

            const duration = Date.now() - t0
            updateAverageResponseTimes(duration, isCached)

            // Markiere günstigste Verbindung pro Zeitfenster NACH allen Filtern
            if (dayResponse.result) {
              for (const dateKey of Object.keys(dayResponse.result)) {
                const priceData = dayResponse.result[dateKey]
                if (priceData && priceData.allIntervals && Array.isArray(priceData.allIntervals)) {
                  
                  // Falls noch kein spezifischer Bestpreis gesetzt wurde
                  if (!abfahrtAb && !abfahrtBis && !ankunftAb && !ankunftBis && priceData.allIntervals.length > 1) {
                    const recommendedTrip = recommendBestPrice(priceData.allIntervals)
                    if (recommendedTrip) {
                      priceData.preis = recommendedTrip.preis
                      priceData.abfahrtsZeitpunkt = recommendedTrip.abfahrtsZeitpunkt
                      priceData.ankunftsZeitpunkt = recommendedTrip.ankunftsZeitpunkt
                      priceData.info = recommendedTrip.info
                    }
                  }

                  // Zeitfenster-Definition (immer verwenden, auch mit Zeitfiltern!)
                  const timeSlots = [
                    { start: 0, end: 7 },
                    { start: 7, end: 10 },
                    { start: 10, end: 13 },
                    { start: 13, end: 16 },
                    { start: 16, end: 19 },
                    { start: 19, end: 24 },
                  ]

                  // Setze alle auf false
                  for (const interval of priceData.allIntervals) {
                    interval.isCheapestPerInterval = false
                  }

                  // Gruppiere nach Zeitfenstern
                  const slotMap = new Map<number, any[]>()
                  for (const interval of priceData.allIntervals) {
                    const depDate = new Date(interval.abfahrtsZeitpunkt)
                    const depHour = depDate.getHours() + (depDate.getMinutes() / 60)
                    const slotIndex = timeSlots.findIndex(slot => depHour >= slot.start && depHour < slot.end)
                    if (slotIndex >= 0) {
                      if (!slotMap.has(slotIndex)) {
                        slotMap.set(slotIndex, [])
                      }
                      slotMap.get(slotIndex)!.push(interval)
                    }
                  }

                  // Markiere günstigste pro Slot
                  slotMap.forEach((intervals, slotIndex) => {
                    if (intervals.length > 0) {
                      const bestInSlot = recommendBestPrice(intervals)
                      if (bestInSlot) {
                        for (const interval of intervals) {
                          const isMatch = (
                            interval.abfahrtsZeitpunkt === bestInSlot.abfahrtsZeitpunkt &&
                            interval.ankunftsZeitpunkt === bestInSlot.ankunftsZeitpunkt &&
                            interval.preis === bestInSlot.preis
                          )
                          if (isMatch) {
                            interval.isCheapestPerInterval = true
                          }
                        }
                      } else {
                        const sortedIntervals = intervals.slice().sort((a, b) => {
                          if (a.preis !== b.preis) return a.preis - b.preis
                          const aDuration = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime()
                          const bDuration = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                          if (aDuration !== bDuration) return aDuration - bDuration
                          return new Date(a.abfahrtsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
                        })
                        sortedIntervals[0].isCheapestPerInterval = true
                      }
                    }
                  })
                  
                  // Final count
                  const markedCount = priceData.allIntervals.filter(i => i.isCheapestPerInterval === true).length
                  logDebug(LOG_SCOPE, "🏁 Bestpreissuche day result prepared", {
                    sessionId,
                    travelDate: dateKey,
                    totalIntervals: priceData.allIntervals.length,
                    cheapestSlotMarkers: markedCount,
                    bestPrice: priceData.preis,
                  })
                }
              }
            }

            return { currentDateStr, dayResponse, dayCount, direction: "outward" as const, isCached }
          })

          const returnRequestTasks = returnDatesToProcess.map((currentDateStr, returnDayCount) => async () => {
            if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
              if (!cancelLoggedForSession) {
                logDebug(LOG_SCOPE, "Bestpreissuche session cancelled; stopping remaining return dates", { sessionId })
                cancelLoggedForSession = true
              }
              return { currentDateStr, dayResponse: { result: null }, dayCount: datesToProcess.length + returnDayCount, direction: "return" as const }
            }

            const statusIndex = datesToProcess.length + returnDayCount
            const isCached = dayStatusList[statusIndex]?.isCached ?? false
            const currentDate = new Date(currentDateStr)
            const t0 = Date.now()

            let processedMaxUmstiege: number | string | undefined = undefined
            if (maximaleUmstiege === "0" || maximaleUmstiege === 0) {
              processedMaxUmstiege = 0
            } else if (maximaleUmstiege !== undefined && maximaleUmstiege !== "alle" && maximaleUmstiege !== "" && maximaleUmstiege !== null) {
              processedMaxUmstiege = Number.parseInt(String(maximaleUmstiege))
            }

            const dayResponse = await getBestPrice({
              abfahrtsHalt: zielStation.id,
              ankunftsHalt: startStation.id,
              startStationNormalizedId: zielStation.normalizedId,
              zielStationNormalizedId: startStation.normalizedId,
              anfrageDatum: currentDate,
              sessionId,
              alter,
              ermaessigungArt,
              ermaessigungKlasse,
              klasse,
              maximaleUmstiege: processedMaxUmstiege,
              schnelleVerbindungen: schnelleVerbindungen === true || schnelleVerbindungen === "1",
              nurDeutschlandTicketVerbindungen:
                nurDeutschlandTicketVerbindungen === true || nurDeutschlandTicketVerbindungen === "1",
              abfahrtAb: returnAbfahrtAb,
              abfahrtBis: returnAbfahrtBis,
              ankunftAb: returnAnkunftAb,
              ankunftBis: returnAnkunftBis,
              umstiegszeit,
            })

            if (dayResponse.result && dayResponse.recordedAt) {
              for (const dateKey of Object.keys(dayResponse.result)) {
                const priceData = (dayResponse.result as any)[dateKey]
                if (priceData) {
                  (priceData as any).recordedAt = dayResponse.recordedAt
                }
              }
            }

            if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
              return { currentDateStr, dayResponse: { result: null }, dayCount: statusIndex, direction: "return" as const }
            }

            const duration = Date.now() - t0
            updateAverageResponseTimes(duration, isCached)

            return { currentDateStr, dayResponse, dayCount: statusIndex, direction: "return" as const, isCached }
          })

          // Verarbeite Ergebnisse sobald sie ankommen
          let completedRequests = 0
          let completedUncachedRequests = 0
          let completedCachedRequests = 0
          const processResult = async (resultPromise: Promise<any>) => {
            try {
              const { currentDateStr, dayResponse, dayCount, direction, isCached } = await resultPromise
              completedRequests++
              if (isCached) {
                completedCachedRequests++
              } else {
                completedUncachedRequests++
              }

              // Prüfe Session-Abbruch BEVOR Ergebnis verarbeitet wird
              if (globalRateLimiter.isSessionCancelledSync(sessionId)) {
                return false
              }

              if (dayResponse.result) {
                if (direction === "return") {
                  Object.assign(returnResults, dayResponse.result)

                  if (!globalRateLimiter.isSessionCancelledSync(sessionId)) {
                    const returnDayResult = {
                      type: 'returnDayResult',
                      date: currentDateStr,
                      result: Object.values(dayResponse.result)[0],
                      meta: metaData,
                      travelCombinations: getCurrentTravelCombinations()
                    }

                    if (!safeEnqueue(encoder.encode(JSON.stringify(returnDayResult) + '\n'))) {
                      return false
                    }
                  }
                } else {
                  Object.assign(results, dayResponse.result)

                  // Stream einzelnes Tagesergebnis nur wenn Session noch aktiv
                  if (!globalRateLimiter.isSessionCancelledSync(sessionId)) {
                    const dayResult = {
                      type: 'dayResult',
                      date: currentDateStr,
                      result: Object.values(dayResponse.result)[0],
                      meta: metaData,
                      travelCombinations: getCurrentTravelCombinations()
                    }

                    if (!safeEnqueue(encoder.encode(JSON.stringify(dayResult) + '\n'))) {
                      // User disconnected - stop processing but don't log multiple times
                      return false
                    }
                  }
                }
              }

              // Progress-Update nach jedem abgeschlossenen Request (nur wenn Session noch aktiv)
              if (!globalRateLimiter.isSessionCancelledSync(sessionId)) {
                const updatedQueueStatus = globalRateLimiter.getQueueStatus()
                const updatedAvgTimes = getAverageResponseTimes()
                await updateProgress(
                  sessionId,
                  completedRequests,
                  maxDays,
                  currentDateStr,
                  false,
                  Math.max(0, totalUncachedDays - completedUncachedRequests),
                  Math.max(0, totalCachedDays - completedCachedRequests),
                  updatedAvgTimes.uncached,
                  updatedAvgTimes.cached,
                  updatedQueueStatus.queueSize,
                  updatedQueueStatus.activeRequests
                )
              }

              // Wenn letzter Tag verarbeitet wurde, sofort Abschluss senden
              if (!completeSent && completedRequests >= maxDays && !globalRateLimiter.isSessionCancelledSync(sessionId)) {
                await sendFinalComplete()
              }

              return true
            } catch (error) {
              completedRequests++
              
              // Behandle cancelled sessions nicht als Fehler
              if (error instanceof Error && error.message.includes('was cancelled')) {
                if (!cancelLoggedForSession) {
                  logDebug(LOG_SCOPE, "Bestpreissuche processing cancelled", { sessionId })
                  cancelLoggedForSession = true
                }
                return true
              }
              
              logError(LOG_SCOPE, "Error while processing Bestpreissuche day request", error, { sessionId })
              return true
            }
          }

          const prioritizedRequestOrder = buildPrioritizedRequestOrder(
            datesToProcess,
            returnDatesToProcess,
            normalizedMinNights,
            normalizedMaxNights
          )
          const prioritizedRequestPromises = prioritizedRequestOrder.map(({ direction, index }) =>
            direction === "outward"
              ? outwardRequestTasks[index]()
              : returnRequestTasks[index]()
          )

          // Warte auf alle Requests, aber verarbeite sie sobald sie fertig sind.
          await Promise.all(prioritizedRequestPromises.map(processResult))

          // Falls aus irgendeinem Grund noch nicht gesendet, jetzt senden
          if (!completeSent && !globalRateLimiter.isSessionCancelledSync(sessionId)) {
            await sendFinalComplete()
          }

        } catch (error) {
          metricsCollector.recordUserSearchError()
          logError(LOG_SCOPE, "Bestpreissuche streaming failed", error, { sessionId })
          const errorResult = {
            type: 'error',
            error: "Internal server error",
            details: error instanceof Error ? error.message : "Unknown error"
          }
          safeEnqueue(encoder.encode(JSON.stringify(errorResult) + '\n'))
          safeClose()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    metricsCollector.recordUserSearchError()
    logError(LOG_SCOPE, "Bestpreissuche API request failed", error)
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// Helper function to calculate dates from weekdays
function calculateDatesFromWeekdays(
  startDate: string,
  endDate: string,
  weekdays: number[]
): string[] {
  const dates: string[] = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (weekdays.includes(d.getDay())) {
      const year = d.getFullYear()
      const month = (d.getMonth() + 1).toString().padStart(2, "0")
      const day = d.getDate().toString().padStart(2, "0")
      dates.push(`${year}-${month}-${day}`)
    }
  }
  
  return dates
}
