"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { PriceCalendar } from "./price-calendar"
import { DayDetailsPanel } from "./day-details-panel"
import {
  TravelCombinations,
  type LazyCombinationRequestState,
  type TravelCombination,
} from "./travel-combinations"
import { IncompleteSearchNotice } from "@/components/search/incomplete-search-notice"
import { logError, logInfo, logWarn } from "@/lib/shared/logger"
import { addDaysToDateKey, getEarliestSearchDateKey } from "@/lib/shared/berlin-date"
import { getEligibleDateKeys, getFeasibleReturnSearchDates } from "@/lib/search/return-search-feasibility"

const LOG_SCOPE = "bestpreissuche.client"
const BACKGROUND_SEARCH_NOTICE = "Suchen können nicht im Hintergrund ausgeführt werden, um zu viele Anfragen an die Bahn-API zu vermeiden."

interface SearchParams {
  start?: string
  ziel?: string
  reisezeitraumAb?: string
  reisezeitraumBis?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  klasse?: string
  schnelleVerbindungen?: string
  nurDeutschlandTicketVerbindungen?: string
  maximaleUmstiege?: string
  abfahrtAb?: string
  abfahrtBis?: string
  ankunftAb?: string
  ankunftBis?: string
  rueckfahrt?: string
  minNaechte?: string
  maxNaechte?: string
  returnAbfahrtAb?: string
  returnAbfahrtBis?: string
  returnAnkunftAb?: string
  returnAnkunftBis?: string
  wochentage?: string // Only weekdays
  returnWochentage?: string
  umstiegszeit?: string
}

interface TrainResultsProps {
  searchParams: SearchParams
}

interface PriceHistoryEntry {
  preis: number
  recorded_at: number
}

interface PriceData {
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
    umstiegsAnzahl?: number
    isCheapestPerInterval?: boolean
    priceHistory?: PriceHistoryEntry[]
  }>
}

interface MetaData {
  startStation: { name: string; id: string }
  zielStation: { name: string; id: string }
  sessionId?: string
  searchParams?: {
    klasse?: string
    maximaleUmstiege?: string
    schnelleVerbindungen?: string | boolean
    nurDeutschlandTicketVerbindungen?: string | boolean
    abfahrtAb?: string
    abfahrtBis?: string
    ankunftAb?: string
    ankunftBis?: string
    rueckfahrt?: string
    minNaechte?: string
    maxNaechte?: string
    returnAbfahrtAb?: string
    returnAbfahrtBis?: string
    returnAnkunftAb?: string
    returnAnkunftBis?: string
    wochentage?: number[]
    returnWochentage?: number[]
    umstiegszeit?: string
  }
}

interface PriceResults {
  [date: string]: PriceData
}

interface LazyDayRequestState {
  date: string
  status: "loading" | "complete" | "error"
  message?: string
}

interface TargetedSearchOverrides {
  reisezeitraumAb?: string
  reisezeitraumBis?: string
  outwardWeekdays?: number[]
  returnWeekdays?: number[]
}

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

function parseWeekdaysParam(value?: string, fallback = ALL_WEEKDAYS) {
  if (!value) return [...fallback]

  try {
    const decoded = decodeURIComponent(value)
    const parsed = decoded.startsWith("[")
      ? JSON.parse(decoded)
      : decoded.split(",").map(Number)

    if (Array.isArray(parsed)) {
      const weekdays = parsed.filter(
        (weekday): weekday is number =>
          typeof weekday === "number" &&
          Number.isInteger(weekday) &&
          weekday >= 0 &&
          weekday <= 6
      )
      if (weekdays.length > 0) return [...new Set(weekdays)]
    }
  } catch {}

  return [...fallback]
}

export function TrainResults({ searchParams }: TrainResultsProps) {
  const [priceResults, setPriceResults] = useState<PriceResults>({})
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedData, setSelectedData] = useState<PriceData | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [returnPriceResults, setReturnPriceResults] = useState<PriceResults>({})
  const [travelCombinations, setTravelCombinations] = useState<TravelCombination[]>([])
  const activeSessionIdRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const searchRunIdRef = useRef(0)
  const startedSearchKeyRef = useRef<string | null>(null)
  const unmountCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showAbortModal, setShowAbortModal] = useState(false)
  const [abortModalMessage, setAbortModalMessage] = useState("")
  const [searchWasCancelled, setSearchWasCancelled] = useState(false)
  const [initialSearchComplete, setInitialSearchComplete] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [lazyCombinationRequest, setLazyCombinationRequest] = useState<LazyCombinationRequestState | null>(null)
  const [lazyDayRequest, setLazyDayRequest] = useState<LazyDayRequestState | null>(null)
  const [isFullMatrixLoading, setIsFullMatrixLoading] = useState(false)
  const [fullMatrixLoadError, setFullMatrixLoadError] = useState<string | null>(null)
  const lazyRequestRef = useRef<{ key: string; sessionId: string; controller: AbortController } | null>(null)

  const hasReturnSearch = searchParams.rueckfahrt === "1"

  const outwardWeekdays = parseWeekdaysParam(searchParams.wochentage)
  const returnWeekdays = parseWeekdaysParam(searchParams.returnWochentage, outwardWeekdays)
  const availableOutwardDates = getEligibleDateKeys(
    searchParams.reisezeitraumAb || "",
    searchParams.reisezeitraumBis || "",
    outwardWeekdays
  ).slice(0, 30)
  const availableReturnDates = hasReturnSearch
    ? getEligibleDateKeys(
        searchParams.reisezeitraumAb || "",
        searchParams.reisezeitraumBis || "",
        returnWeekdays
      ).slice(0, 30)
    : []
  const parsedMinNights = Number.parseInt(searchParams.minNaechte || "1", 10)
  const parsedMaxNights = searchParams.maxNaechte
    ? Number.parseInt(searchParams.maxNaechte, 10)
    : undefined
  const normalizedMinNights = Number.isFinite(parsedMinNights) && parsedMinNights > 0 ? parsedMinNights : 1
  const normalizedMaxNights =
    typeof parsedMaxNights === "number" && Number.isFinite(parsedMaxNights) && parsedMaxNights > 0
      ? parsedMaxNights
      : undefined
  const initialReturnSearchDates = hasReturnSearch
    ? getFeasibleReturnSearchDates({
        outwardDates: availableOutwardDates,
        returnDates: availableReturnDates,
        minNights: normalizedMinNights,
        maxNights: normalizedMaxNights,
      })
    : { outwardDates: availableOutwardDates, returnDates: [] }
  const expectedOutwardDays = initialReturnSearchDates.outwardDates.length
  const expectedReturnDays = initialReturnSearchDates.returnDates.length
  const expectedDays = expectedOutwardDays + expectedReturnDays

  // Track der bereits eingetroffenen dayResults
  const processedDaysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("bestpreissuche:search-state", {
      detail: { isSearching: loading || isStreaming },
    }))
  }, [isStreaming, loading])

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent("bestpreissuche:search-state", {
      detail: { isSearching: false },
    }))
  }, [])

  // Generate sessionId when search starts
  const generateSessionId = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID()
    }
    // Fallback für ältere Browser
    return 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  const validPriceResults = Object.entries(priceResults).filter(([key]) => key !== "_meta") as [string, PriceData][]
  const _meta = (priceResults as any)._meta as MetaData | undefined
  const startStation = _meta?.startStation
  const zielStation = _meta?.zielStation

  const supersedeActiveRequests = useCallback((reason: string) => {
    const activeSessionId = activeSessionIdRef.current
    const activeController = abortControllerRef.current
    const activeLazyRequest = lazyRequestRef.current

    searchRunIdRef.current += 1
    activeSessionIdRef.current = null
    abortControllerRef.current = null
    lazyRequestRef.current = null
    activeController?.abort()
    activeLazyRequest?.controller.abort()

    for (const requestSessionId of [activeSessionId, activeLazyRequest?.sessionId]) {
      if (!requestSessionId) continue
      void fetch("/api/search-prices/cancel-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: requestSessionId, reason }),
      }).catch(() => undefined)
    }
  }, [])

  // Beendet Stream und Progress-Polling sofort; die Backend-Benachrichtigung läuft separat.
  const cancelSearchWithReason = useCallback((reason: 'user_request' | 'page_hidden') => {
    const activeSessionId = activeSessionIdRef.current
    const activeController = abortControllerRef.current
    const activeLazyRequest = lazyRequestRef.current
    if (!activeSessionId && !activeController && !activeLazyRequest) return

    logInfo(LOG_SCOPE, "Bestpreissuche cancellation requested", { sessionId: activeSessionId, reason })

    searchRunIdRef.current += 1
    activeSessionIdRef.current = null
    abortControllerRef.current = null
    lazyRequestRef.current = null
    activeController?.abort()
    activeLazyRequest?.controller.abort()

    setLoading(false)
    setIsStreaming(false)
    setSessionId(null)
    setSearchWasCancelled(true)
    setInitialSearchComplete(false)
    setLazyCombinationRequest(null)
    setLazyDayRequest(null)
    setIsFullMatrixLoading(false)

    setAbortModalMessage(
      reason === 'page_hidden'
        ? `Die Suche wurde automatisch abgebrochen, weil der Tab gewechselt oder die Seite verlassen wurde. ${BACKGROUND_SEARCH_NOTICE}`
        : "Die Suche wurde abgebrochen."
    )
    setShowAbortModal(true)

    if (activeSessionId) {
      void fetch(`/api/search-prices/cancel-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId, reason }),
        keepalive: true,
      }).then(() => {
        logInfo(LOG_SCOPE, "Backend notified about search cancellation", { sessionId: activeSessionId, reason })
      }).catch((error) => {
        logWarn(LOG_SCOPE, "Could not notify backend about search cancellation", {
          sessionId: activeSessionId,
          reason,
          error: error instanceof Error ? error.message : error,
        })
      })
    }
    if (activeLazyRequest) {
      void fetch(`/api/search-prices/cancel-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeLazyRequest.sessionId, reason }),
        keepalive: true,
      }).catch(() => undefined)
    }
  }, [])

  const cancelSearch = useCallback(() => {
    cancelSearchWithReason('user_request')
  }, [cancelSearchWithReason])

  const restartSearch = useCallback(() => {
    supersedeActiveRequests("restart_search")

    startedSearchKeyRef.current = null
    setShowAbortModal(false)
    setLoading(false)
    setIsStreaming(false)
    setSessionId(null)
    setInitialSearchComplete(false)
    setLazyCombinationRequest(null)
    setLazyDayRequest(null)
    setIsFullMatrixLoading(false)
    setSearchAttempt((attempt) => attempt + 1)
  }, [supersedeActiveRequests])

  const prepareSearchReplacement = useCallback(() => {
    supersedeActiveRequests("superseded_search")
    setShowAbortModal(false)
    setLoading(false)
    setIsStreaming(false)
    setSessionId(null)
    setInitialSearchComplete(false)
    setLazyCombinationRequest(null)
    setLazyDayRequest(null)
    setIsFullMatrixLoading(false)
  }, [supersedeActiveRequests])

  useEffect(() => {
    window.addEventListener("bestpreissuche:restart", restartSearch)
    window.addEventListener("bestpreissuche:replace", prepareSearchReplacement)
    return () => {
      window.removeEventListener("bestpreissuche:restart", restartSearch)
      window.removeEventListener("bestpreissuche:replace", prepareSearchReplacement)
    }
  }, [prepareSearchReplacement, restartSearch])

  // Cleanup bei Component Unmount oder Navigation
  useEffect(() => {
    if (unmountCleanupTimerRef.current) {
      clearTimeout(unmountCleanupTimerRef.current)
      unmountCleanupTimerRef.current = null
    }

    const notifyPageUnload = (reason: 'page_unload' | 'component_unmount') => {
      const activeSessionIds = [activeSessionIdRef.current, lazyRequestRef.current?.sessionId]
        .filter((sessionId): sessionId is string => Boolean(sessionId))
      for (const activeSessionId of activeSessionIds) {
        const payload = new Blob(
          [JSON.stringify({ sessionId: activeSessionId, reason })],
          { type: 'application/json' }
        )
        navigator.sendBeacon('/api/search-prices/cancel-search', payload)
      }
    }

    const handleBeforeUnload = () => {
      notifyPageUnload('page_unload')
      abortControllerRef.current?.abort()
      lazyRequestRef.current?.controller.abort()
    }

    const handleVisibilityChange = () => {
      if (document.hidden && (activeSessionIdRef.current || lazyRequestRef.current)) {
        cancelSearchWithReason('page_hidden')
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)

      // React startet Effects im Dev-Modus einmal testweise neu. Der verzögerte
      // Cleanup wird bei diesem direkten Reconnect oben wieder verworfen.
      unmountCleanupTimerRef.current = setTimeout(() => {
        searchRunIdRef.current += 1
        notifyPageUnload('component_unmount')
        abortControllerRef.current?.abort()
        lazyRequestRef.current?.controller.abort()
        activeSessionIdRef.current = null
        abortControllerRef.current = null
        lazyRequestRef.current = null
        unmountCleanupTimerRef.current = null
      }, 0)
    }
  }, [cancelSearchWithReason])

  // Create a unique key for the current search to prevent duplicate requests
  const currentSearchKey = JSON.stringify({
    start: searchParams.start,
    ziel: searchParams.ziel,
    reisezeitraumAb: searchParams.reisezeitraumAb,
    reisezeitraumBis: searchParams.reisezeitraumBis,
    ermaessigungArt: searchParams.ermaessigungArt,
    ermaessigungKlasse: searchParams.ermaessigungKlasse,
    alter: searchParams.alter,
    klasse: searchParams.klasse,
    schnelleVerbindungen: searchParams.schnelleVerbindungen,
    nurDeutschlandTicketVerbindungen: searchParams.nurDeutschlandTicketVerbindungen,
    maximaleUmstiege: searchParams.maximaleUmstiege,
    abfahrtAb: searchParams.abfahrtAb,
    abfahrtBis: searchParams.abfahrtBis,
    ankunftAb: searchParams.ankunftAb,
    ankunftBis: searchParams.ankunftBis,
    rueckfahrt: searchParams.rueckfahrt,
    minNaechte: searchParams.minNaechte,
    maxNaechte: searchParams.maxNaechte,
    returnAbfahrtAb: searchParams.returnAbfahrtAb,
    returnAbfahrtBis: searchParams.returnAbfahrtBis,
    returnAnkunftAb: searchParams.returnAnkunftAb,
    returnAnkunftBis: searchParams.returnAnkunftBis,
    wochentage: searchParams.wochentage, // Changed from 'tage'
    returnWochentage: searchParams.returnWochentage,
    umstiegszeit: searchParams.umstiegszeit,
  })

  const buildSearchRequestBody = (
    requestSessionId: string,
    requestedDates?: { outwardDates: string[]; returnDates: string[] },
    overrides?: TargetedSearchOverrides
  ) => ({
    sessionId: requestSessionId,
    start: searchParams.start,
    ziel: searchParams.ziel,
    reisezeitraumAb: overrides?.reisezeitraumAb || searchParams.reisezeitraumAb || addDaysToDateKey(getEarliestSearchDateKey(), 6),
    reisezeitraumBis: overrides?.reisezeitraumBis || searchParams.reisezeitraumBis || addDaysToDateKey(
      searchParams.reisezeitraumAb || addDaysToDateKey(getEarliestSearchDateKey(), 6),
      6
    ),
    wochentage: overrides?.outwardWeekdays || outwardWeekdays,
    returnWochentage: overrides?.returnWeekdays || returnWeekdays,
    alter: searchParams.alter || "ERWACHSENER",
    ermaessigungArt: searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
    ermaessigungKlasse: searchParams.ermaessigungKlasse || "KLASSENLOS",
    klasse: searchParams.klasse || "KLASSE_2",
    schnelleVerbindungen: searchParams.schnelleVerbindungen === "1",
    nurDeutschlandTicketVerbindungen: searchParams.nurDeutschlandTicketVerbindungen === "1",
    ...(searchParams.maximaleUmstiege !== undefined && searchParams.maximaleUmstiege !== "" && {
      maximaleUmstiege: Number.parseInt(searchParams.maximaleUmstiege),
    }),
    abfahrtAb: searchParams.abfahrtAb,
    abfahrtBis: searchParams.abfahrtBis,
    ankunftAb: searchParams.ankunftAb,
    ankunftBis: searchParams.ankunftBis,
    rueckfahrt: searchParams.rueckfahrt,
    minNaechte: searchParams.minNaechte,
    maxNaechte: searchParams.maxNaechte,
    returnAbfahrtAb: searchParams.returnAbfahrtAb,
    returnAbfahrtBis: searchParams.returnAbfahrtBis,
    returnAnkunftAb: searchParams.returnAnkunftAb,
    returnAnkunftBis: searchParams.returnAnkunftBis,
    umstiegszeit: searchParams.umstiegszeit,
    ...(requestedDates && {
      requestedOutwardDates: requestedDates.outwardDates,
      requestedReturnDates: requestedDates.returnDates,
    }),
  })

  useEffect(() => {
    // Only search if we have required params and this is a new search
    if (!searchParams.start || !searchParams.ziel || currentSearchKey === "") {
      return
    }
    if (startedSearchKeyRef.current === currentSearchKey) {
      return
    }
    startedSearchKeyRef.current = currentSearchKey

    const searchPrices = async () => {
      supersedeActiveRequests("superseded_search")
      const searchRunId = searchRunIdRef.current
      setLazyCombinationRequest(null)
      setLazyDayRequest(null)
      setIsFullMatrixLoading(false)
      setFullMatrixLoadError(null)
      setLoading(true)
      setPriceResults({})
      setReturnPriceResults({})
      setTravelCombinations([])
      setSelectedDay(null)
      setSelectedData(null)
      setIsStreaming(true)
      setShowAbortModal(false)
      setSearchWasCancelled(false)
      setInitialSearchComplete(false)
      processedDaysRef.current = new Set()
      
      // Generiere sessionId sofort im Frontend
      const newSessionId = generateSessionId()
      activeSessionIdRef.current = newSessionId
      setSessionId(newSessionId)

      // Erstelle AbortController für diese Anfrage
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const response = await fetch("/api/search-prices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify(buildSearchRequestBody(newSessionId)),
        })

        if (searchRunIdRef.current !== searchRunId) return

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
          throw new Error(errorData.error || `HTTP ${response.status}: Bestpreissuche fehlgeschlagen`)
        }

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        
        if (reader) {
          // Streaming response verarbeiten
          let buffer = ""
          
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (searchRunIdRef.current !== searchRunId) return
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ""
              
              for (const line of lines) {
                if (searchRunIdRef.current !== searchRunId) return
                if (line.trim()) {
                  try {
                    const data = JSON.parse(line)
                    
                    if (data.type === 'meta') {
                      setPriceResults(prev => ({
                        ...prev,
                        _meta: data.meta,
                      }))
                    } else if (data.type === 'dayResult') {
                      // Einzelnes Tagesergebnis hinzufügen
                      setPriceResults(prev => ({
                        ...prev,
                        [data.date]: data.result,
                        _meta: data.meta || prev._meta
                      }))
                      if (Array.isArray(data.travelCombinations)) {
                        setTravelCombinations(data.travelCombinations)
                      }
                      processedDaysRef.current.add(`outward:${data.date}`)
                    } else if (data.type === 'returnDayResult') {
                      setReturnPriceResults(prev => ({
                        ...prev,
                        [data.date]: data.result,
                      }))
                      if (Array.isArray(data.travelCombinations)) {
                        setTravelCombinations(data.travelCombinations)
                      }
                      processedDaysRef.current.add(`return:${data.date}`)
                    } else if (data.type === 'complete') {
                      // Vollständige Ergebnisse bei Abschluss
                      setPriceResults((current) => ({
                        ...current,
                        ...data.results,
                        _meta: data.results?._meta || current._meta,
                      }))
                      setReturnPriceResults((current) => ({ ...current, ...(data.returnResults || {}) }))
                      setTravelCombinations(data.travelCombinations || [])
                      setLoading(false)
                      setIsStreaming(false)
                      setInitialSearchComplete(true)
                      activeSessionIdRef.current = null
                      abortControllerRef.current = null
                      setSessionId(null)
                      return
                    }
                  } catch {
                    logWarn(LOG_SCOPE, "Could not parse Bestpreissuche streaming response line", {
                      sessionId: newSessionId,
                      line,
                    })
                  }
                }
              }
            }
            // Set status to completed after streaming ends
            setLoading(false)
            setIsStreaming(false)
          } finally {
            reader.releaseLock()
          }
          
          // Fallback: Versuche finalen Buffer als JSON zu parsen
          if (buffer.trim()) {
            if (searchRunIdRef.current !== searchRunId) return
            try {
              const finalData = JSON.parse(buffer)
              const finalResults = finalData.results || finalData
              setPriceResults((current) => ({
                ...current,
                ...finalResults,
                _meta: finalResults?._meta || current._meta,
              }))
              setReturnPriceResults((current) => ({ ...current, ...(finalData.returnResults || {}) }))
              setTravelCombinations(finalData.travelCombinations || [])
            } catch (e) {
              logWarn(LOG_SCOPE, "Could not parse Bestpreissuche final streaming buffer", {
                sessionId: newSessionId,
                buffer,
                error: e instanceof Error ? e.message : e,
              })
            }
          }
        } else {
          // Fallback für non-streaming response
          const data = await response.json()
          if (searchRunIdRef.current !== searchRunId) return
          const responseResults = data.results || data
          setPriceResults((current) => ({
            ...current,
            ...responseResults,
            _meta: responseResults?._meta || current._meta,
          }))
          setReturnPriceResults((current) => ({ ...current, ...(data.returnResults || {}) }))
          setTravelCombinations(data.travelCombinations || [])
        }

        if (searchRunIdRef.current !== searchRunId) return
        setInitialSearchComplete(true)
        
        if (activeSessionIdRef.current === newSessionId) {
          activeSessionIdRef.current = null
          abortControllerRef.current = null
          setSessionId(null)
        }
      } catch (err) {
        if (searchRunIdRef.current !== searchRunId) return
         // Check if error was due to abort
        if (err instanceof Error && err.name === 'AbortError') {
          logInfo(LOG_SCOPE, "Bestpreissuche request aborted by user", { sessionId: newSessionId })
        } else {
          logError(LOG_SCOPE, "Bestpreissuche client request failed", err, { sessionId: newSessionId })
        }
      } finally {
        if (searchRunIdRef.current === searchRunId && activeSessionIdRef.current === newSessionId) {
          activeSessionIdRef.current = null
          abortControllerRef.current = null
          setLoading(false)
          setIsStreaming(false)
          setSessionId(null)
        }
      }
    }

    searchPrices()
  }, [
    currentSearchKey,
    searchAttempt,
    searchParams.start,
    searchParams.ziel,
    searchParams.reisezeitraumAb,
    searchParams.reisezeitraumBis,
    searchParams.alter,
    searchParams.klasse,
    searchParams.schnelleVerbindungen,
    searchParams.nurDeutschlandTicketVerbindungen,
    searchParams.maximaleUmstiege,
    searchParams.ermaessigungArt,
    searchParams.ermaessigungKlasse,
    searchParams.abfahrtAb,
    searchParams.abfahrtBis,
    searchParams.ankunftAb,
    searchParams.ankunftBis,
    searchParams.rueckfahrt,
    searchParams.minNaechte,
    searchParams.maxNaechte,
    searchParams.returnAbfahrtAb,
    searchParams.returnAbfahrtBis,
    searchParams.returnAnkunftAb,
    searchParams.returnAnkunftBis,
    searchParams.wochentage, // Changed from 'tage'
    searchParams.returnWochentage,
    searchParams.umstiegszeit,
    supersedeActiveRequests,
  ])

  const fetchRequestedDates = async (
    requestKey: string,
    requestedDates: { outwardDates: string[]; returnDates: string[] },
    overrides?: TargetedSearchOverrides
  ) => {
    const previousRequest = lazyRequestRef.current
    if (previousRequest) {
      previousRequest.controller.abort()
      void fetch("/api/search-prices/cancel-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: previousRequest.sessionId, reason: "superseded_targeted_request" }),
      }).catch(() => undefined)
    }

    const requestSessionId = generateSessionId()
    const controller = new AbortController()
    lazyRequestRef.current = { key: requestKey, sessionId: requestSessionId, controller }
    const receivedOutwardResults: PriceResults = {}
    const ensureCurrentRequest = () => {
      if (lazyRequestRef.current?.controller !== controller) {
        throw new DOMException("Request superseded", "AbortError")
      }
    }

    try {
      const response = await fetch("/api/search-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildSearchRequestBody(requestSessionId, requestedDates, overrides)),
      })
      ensureCurrentRequest()
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unbekannter Fehler" }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("Die Preisantwort konnte nicht gelesen werden.")

      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        ensureCurrentRequest()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          ensureCurrentRequest()
          if (!line.trim()) continue
          const data = JSON.parse(line)
          if (data.type === "dayResult") {
            receivedOutwardResults[data.date] = data.result
            setPriceResults((current) => ({
              ...current,
              [data.date]: data.result,
              _meta: current._meta || data.meta,
            }))
          } else if (data.type === "returnDayResult") {
            setReturnPriceResults((current) => ({ ...current, [data.date]: data.result }))
          } else if (data.type === "error") {
            throw new Error(data.error || "Die Preisabfrage ist fehlgeschlagen.")
          } else if (data.type === "complete" && data.results) {
            for (const [date, result] of Object.entries(data.results)) {
              if (date !== "_meta") receivedOutwardResults[date] = result as PriceData
            }
            setPriceResults((current) => ({
              ...current,
              ...data.results,
              _meta: data.results._meta || current._meta,
            }))
          }
        }
      }

      ensureCurrentRequest()
      return receivedOutwardResults
    } finally {
      if (lazyRequestRef.current?.key === requestKey) {
        lazyRequestRef.current = null
      }
    }
  }

  const requestLazyCombination = async (outwardDate: string, returnDate: string) => {
    const requestKey = `${outwardDate}|${returnDate}`
    if (lazyRequestRef.current?.key === requestKey) return

    const isOutwardLoaded = Object.prototype.hasOwnProperty.call(priceResults, outwardDate)
    const isReturnLoaded = Object.prototype.hasOwnProperty.call(returnPriceResults, returnDate)
    const outwardIsAlreadyQueued = isStreaming && initialReturnSearchDates.outwardDates.includes(outwardDate)
    const returnIsAlreadyQueued = isStreaming && initialReturnSearchDates.returnDates.includes(returnDate)
    const requestedDates = {
      outwardDates: !isOutwardLoaded && !outwardIsAlreadyQueued ? [outwardDate] : [],
      returnDates: !isReturnLoaded && !returnIsAlreadyQueued ? [returnDate] : [],
    }

    setLazyCombinationRequest({ outwardDate, returnDate, status: "loading" })
    if (requestedDates.outwardDates.length === 0 && requestedDates.returnDates.length === 0) return

    try {
      await fetchRequestedDates(requestKey, requestedDates)
      setLazyCombinationRequest({ outwardDate, returnDate, status: "complete" })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      const message = error instanceof Error ? error.message : "Die Preisabfrage ist fehlgeschlagen."
      setLazyCombinationRequest({ outwardDate, returnDate, status: "error", message })
      logError(LOG_SCOPE, "Lazy combination request failed", error, { outwardDate, returnDate })
    }
  }

  const requestLazyDay = async (date: string) => {
    const requestKey = `day:${date}`
    if (!initialSearchComplete) return
    if (lazyRequestRef.current?.key === requestKey) return
    if (Object.prototype.hasOwnProperty.call(priceResults, date)) return
    if (isStreaming && availableOutwardDates.includes(date)) return

    setLazyDayRequest({ date, status: "loading" })
    try {
      const requestedWeekday = new Date(`${date}T12:00:00`).getDay()
      const receivedResults = await fetchRequestedDates(
        requestKey,
        {
          outwardDates: [date],
          returnDates: [],
        },
        {
          reisezeitraumAb: date,
          reisezeitraumBis: date,
          outwardWeekdays: [requestedWeekday],
          returnWeekdays: [requestedWeekday],
        }
      )
      const result = receivedResults[date]
      setLazyDayRequest({ date, status: "complete" })

      if (result?.preis > 0) {
        handleSelectDay(date, result, false)
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      const message = error instanceof Error ? error.message : "Die Preisabfrage ist fehlgeschlagen."
      setLazyDayRequest({ date, status: "error", message })
      logError(LOG_SCOPE, "Lazy day request failed", error, { date })
    }
  }

  const requestFullMatrix = async (outwardDates: string[], returnDates: string[]) => {
    const requestedDates = {
      outwardDates: outwardDates.filter((date) => !Object.prototype.hasOwnProperty.call(priceResults, date)),
      returnDates: returnDates.filter((date) => !Object.prototype.hasOwnProperty.call(returnPriceResults, date)),
    }

    setLazyCombinationRequest(null)
    setFullMatrixLoadError(null)
    if (requestedDates.outwardDates.length === 0 && requestedDates.returnDates.length === 0) return

    setIsFullMatrixLoading(true)
    try {
      await fetchRequestedDates(`full-matrix:${outwardDates.join(",")}|${returnDates.join(",")}`, requestedDates)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      const message = error instanceof Error ? error.message : "Die vollständige Matrix konnte nicht geladen werden."
      setFullMatrixLoadError(message)
      logError(LOG_SCOPE, "Full matrix request failed", error)
    } finally {
      setIsFullMatrixLoading(false)
    }
  }

  const clearLazyCombinationRequest = () => {
    const activeRequest = lazyRequestRef.current
    if (activeRequest) {
      activeRequest.controller.abort()
      lazyRequestRef.current = null
      void fetch("/api/search-prices/cancel-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeRequest.sessionId, reason: "selection_changed" }),
      }).catch(() => undefined)
    }
    setLazyCombinationRequest(null)
  }

  useEffect(() => {
    if (lazyCombinationRequest?.status !== "loading" || lazyRequestRef.current) return

    const outwardLoaded = Object.prototype.hasOwnProperty.call(priceResults, lazyCombinationRequest.outwardDate)
    const returnLoaded = Object.prototype.hasOwnProperty.call(returnPriceResults, lazyCombinationRequest.returnDate)
    if (outwardLoaded && returnLoaded) {
      setLazyCombinationRequest((current) => current ? { ...current, status: "complete" } : current)
    }
  }, [lazyCombinationRequest, priceResults, returnPriceResults])

  // Tag-Navigation innerhalb der eingebetteten Verbindungsliste
  const dayKeys = validPriceResults.map(([date]) => date).sort()
  const handleNavigateDay = (direction: number) => {
    if (!selectedDay) return
    const idx = dayKeys.indexOf(selectedDay)
    const newIdx = idx + direction
    if (newIdx >= 0 && newIdx < dayKeys.length) {
      const newDay = dayKeys[newIdx]
      setSelectedDay(newDay)
      setSelectedData(priceResults[newDay])
    }
  }

  const handleSelectDay = (date: string, data: PriceData, shouldScroll = true) => {
    setSelectedDay(date)
    setSelectedData(data)
    if (!shouldScroll) return

    requestAnimationFrame(() => {
      document.getElementById("day-connections")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    })
  }

  useEffect(() => {
    if (hasReturnSearch || selectedDay) return

    const firstAvailableDay = validPriceResults
      .filter(([, data]) => data.preis > 0)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))[0]

    if (firstAvailableDay) {
      setSelectedDay(firstAvailableDay[0])
      setSelectedData(firstAvailableDay[1])
    }
  }, [hasReturnSearch, selectedDay, priceResults])

  useEffect(() => {
    if (!selectedDay || !priceResults[selectedDay]) return
    setSelectedData(priceResults[selectedDay])
  }, [selectedDay, priceResults])

  const prices = validPriceResults
    .map(([, r]) => r.preis)
    .filter((p) => p > 0)

  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const avgPrice = Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length)

  // Show nothing if no search params
  if (!searchParams.start || !searchParams.ziel) {
    return null
  }

  // Always show calendar when search is active or has results
  if (!hasReturnSearch && !loading && !isStreaming && !showAbortModal && !searchWasCancelled && (!validPriceResults || validPriceResults.length === 0)) {
    return (
        <div className="text-center py-8">
          <p className="text-red-600 font-medium">Keine Bestpreise gefunden</p>
          <p className="text-gray-600 text-sm mt-2">
            Bitte überprüfe die Bahnhofsnamen und versuche es erneut.
          </p>
        </div>
    )
  }

  // Only show "no prices" message if search is completely done and no valid prices found
  if (!hasReturnSearch && !loading && !isStreaming && !showAbortModal && !searchWasCancelled && prices.length === 0) {
    return (
        <div className="text-center py-8">
          <p className="text-orange-600 font-medium">Keine Preise gefunden</p>
          <p className="text-gray-600 text-sm mt-2">Für den gewählten Zeitraum sind keine Bestpreise verfügbar. Bitte prüfe insbesondere gesetzte Filter auf Widersprüche.</p>
        </div>
    )
  }

  return (
      <div className="space-y-6">
        {searchWasCancelled && !hasReturnSearch && validPriceResults.length === 0 && <IncompleteSearchNotice />}

        {hasReturnSearch ? (
          <div>
            <TravelCombinations
              combinations={travelCombinations}
              outwardResults={priceResults}
              returnResults={returnPriceResults}
              expectedOutwardDays={expectedOutwardDays}
              expectedReturnDays={expectedReturnDays}
              startStation={startStation}
              zielStation={zielStation}
              searchParams={searchParams}
              isStreaming={isStreaming}
              sessionId={sessionId}
              onCancelSearch={cancelSearch}
              onRestartSearch={restartSearch}
              searchWasCancelled={searchWasCancelled}
              lazyCombinationRequest={lazyCombinationRequest}
              onRequestCombination={requestLazyCombination}
              onResolveLazyCombination={clearLazyCombinationRequest}
              isFullMatrixLoading={isFullMatrixLoading}
              fullMatrixLoadError={fullMatrixLoadError}
              onRequestFullMatrix={requestFullMatrix}
              onResetFullMatrix={() => setFullMatrixLoadError(null)}
            />
          </div>
        ) : (
          <>
            {/* Calendar View */}
            <div>
              <PriceCalendar
                  results={priceResults}
                  onDayClick={handleSelectDay}
                  startStation={startStation}
                  zielStation={zielStation}
                  searchParams={searchParams}
                  isStreaming={isStreaming}
                  sessionId={sessionId}
                  onCancelSearch={cancelSearch}
                  onRestartSearch={restartSearch}
                  searchWasCancelled={searchWasCancelled}
                  selectedDay={selectedDay || undefined}
                  expectedDays={expectedDays}
                  lazyDayRequest={lazyDayRequest}
                  onRequestDay={requestLazyDay}
                  canRequestAdditionalDays={initialSearchComplete}
              />
            </div>

            <DayDetailsPanel
                date={selectedDay}
                data={selectedData}
                startStation={startStation}
                zielStation={zielStation}
                searchParams={searchParams}
                onNavigateDay={handleNavigateDay}
                dayKeys={dayKeys}
                isLoading={Boolean(isStreaming && !selectedData)}
            />
          </>
        )}

        {showAbortModal && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 text-center shadow-lg">
              <div className="mb-2 text-lg font-semibold text-gray-900">Suche abgebrochen</div>
              <div className="mb-4 text-sm text-gray-600">{abortModalMessage}</div>
              <button
                type="button"
                onClick={() => setShowAbortModal(false)}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                OK
              </button>
            </div>
          </div>
        )}
      </div>
  )
}
