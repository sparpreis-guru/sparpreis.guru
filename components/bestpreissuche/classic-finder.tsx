"use client"

import type { FormEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createBookingLink } from "@/lib/train-search/day-details-utils"
import { getSearchFailures } from "@/lib/search/search-errors"

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
  maximaleUmstiege?: string
  abfahrtAb?: string
  ankunftBis?: string
  umstiegszeit?: string
}

interface StationSuggestion {
  extId: string
  id: string
  name: string
}

interface PriceHistoryEntry {
  preis: number
  recorded_at: number
}

interface JourneyInterval {
  preis: number
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl?: number
  isCheapestPerInterval?: boolean
  priceHistory?: PriceHistoryEntry[]
}

interface PriceData {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  allIntervals?: JourneyInterval[]
}

interface MetaData {
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
}

interface PriceResults {
  [date: string]: PriceData | MetaData | undefined
  _meta?: MetaData
}

interface ClassicFinderProps {
  searchParams: SearchParams
}

const weekdays = [
  { short: "Mo", long: "Montag" },
  { short: "Di", long: "Dienstag" },
  { short: "Mi", long: "Mittwoch" },
  { short: "Do", long: "Donnerstag" },
  { short: "Fr", long: "Freitag" },
  { short: "Sa", long: "Samstag" },
  { short: "So", long: "Sonntag" },
]

const months = ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]

function isStationId(value?: string) {
  return Boolean(value && /^\d+$/.test(value))
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getTomorrowISO() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return formatDateKey(date)
}

function addDays(dateKey: string, days: number) {
  const date = parseDate(dateKey)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

function parseDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function countDays(from: string, to: string) {
  const start = parseDate(from)
  const end = parseDate(to)
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
}

function weeksFromRange(from: string, to: string) {
  return Math.max(1, Math.min(12, Math.ceil(countDays(from, to) / 7)))
}

function dateRange(from: string, to: string) {
  const result: string[] = []
  const start = parseDate(from)
  const end = parseDate(to)

  for (let day = new Date(start); day <= end && result.length < 30; day.setDate(day.getDate() + 1)) {
    result.push(formatDateKey(day))
  }

  return result
}

function calendarWeeks(from: string, to: string) {
  const start = parseDate(from)
  const end = parseDate(to)
  const firstDay = new Date(start)
  const startOffset = (firstDay.getDay() + 6) % 7
  firstDay.setDate(firstDay.getDate() - startOffset)

  const lastDay = new Date(end)
  const endOffset = (lastDay.getDay() + 6) % 7
  lastDay.setDate(lastDay.getDate() + (6 - endOffset))

  const weeks: Date[][] = []
  let currentWeek: Date[] = []

  for (let day = new Date(firstDay); day <= lastDay; day.setDate(day.getDate() + 1)) {
    currentWeek.push(new Date(day))
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }

  return weeks
}

function formatTime(value?: string) {
  if (!value) return "-"
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

function normalizeTimeDraft(value: string) {
  const cleaned = value.replace(/[^\d:]/g, "")
  const firstColon = cleaned.indexOf(":")
  if (firstColon === -1) return cleaned.slice(0, 4)

  const hours = cleaned.slice(0, firstColon).replace(/\D/g, "").slice(0, 2)
  const minutes = cleaned.slice(firstColon + 1).replace(/\D/g, "").slice(0, 2)
  return `${hours}:${minutes}`
}

function finalizeTimeDraft(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""

  let rawHours = ""
  let rawMinutes = ""

  if (trimmed.includes(":")) {
    const [hours = "", minutes = ""] = trimmed.split(":")
    rawHours = hours.replace(/\D/g, "")
    rawMinutes = minutes.replace(/\D/g, "")
  } else {
    const digits = trimmed.replace(/\D/g, "")
    if (digits.length <= 2) {
      rawHours = digits
      rawMinutes = "0"
    } else if (digits.length === 3) {
      rawHours = digits.slice(0, 1)
      rawMinutes = digits.slice(1)
    } else {
      rawHours = digits.slice(0, 2)
      rawMinutes = digits.slice(2, 4)
    }
  }

  if (!rawHours) return ""

  const hours = Math.min(23, Math.max(0, Number.parseInt(rawHours, 10) || 0))
  const minutes = Math.min(59, Math.max(0, Number.parseInt(rawMinutes || "0", 10) || 0))
  return `${`${hours}`.padStart(2, "0")}:${`${minutes}`.padStart(2, "0")}`
}

function formatLongDate(dateKey: string) {
  return parseDate(dateKey).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function formatDuration(from?: string, to?: string) {
  if (!from || !to) return "-"
  const minutes = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = `${minutes % 60}`.padStart(2, "0")
  return `${hours}:${rest}h`
}

function priceParts(price: number) {
  const cents = Math.round(price * 100)
  return {
    euros: `${Math.floor(cents / 100)}`,
    cents: `${cents % 100}`.padStart(2, "0"),
    rounded: `${Math.round(price)}€`,
  }
}

function ageLabel(value: string) {
  if (value === "KIND") return "6-14"
  if (value === "JUGENDLICHER") return "15-26"
  if (value === "SENIOR") return "65+"
  return "27-64"
}

function discountLabel(art: string) {
  if (art === "BAHNCARD25") return "BC25"
  if (art === "BAHNCARD50") return "BC50"
  return "keine BC"
}

export function ClassicFinder({ searchParams }: ClassicFinderProps) {
  const [origin, setOrigin] = useState(isStationId(searchParams.start) ? "" : searchParams.start || "")
  const [originId, setOriginId] = useState(isStationId(searchParams.start) ? searchParams.start || "" : "")
  const [destination, setDestination] = useState(isStationId(searchParams.ziel) ? "" : searchParams.ziel || "")
  const [destinationId, setDestinationId] = useState(isStationId(searchParams.ziel) ? searchParams.ziel || "" : "")
  const [originSuggestions, setOriginSuggestions] = useState<StationSuggestion[]>([])
  const [destinationSuggestions, setDestinationSuggestions] = useState<StationSuggestion[]>([])
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false)
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false)
  const [originError, setOriginError] = useState("")
  const [destinationError, setDestinationError] = useState("")
  const [reisezeitraumAb, setReisezeitraumAb] = useState(searchParams.reisezeitraumAb || getTomorrowISO())
  const [weeks, setWeeks] = useState(() =>
    weeksFromRange(searchParams.reisezeitraumAb || getTomorrowISO(), searchParams.reisezeitraumBis || addDays(searchParams.reisezeitraumAb || getTomorrowISO(), 6))
  )
  const [age, setAge] = useState(searchParams.alter || "ERWACHSENER")
  const [travelClass, setTravelClass] = useState(searchParams.klasse || "KLASSE_2")
  const [discount, setDiscount] = useState(searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG")
  const [departureAfter, setDepartureAfter] = useState(searchParams.abfahrtAb || "")
  const [arrivalBefore, setArrivalBefore] = useState(searchParams.ankunftBis || "")
  const [maxChanges, setMaxChanges] = useState(searchParams.maximaleUmstiege || "")
  const [priceResults, setPriceResults] = useState<PriceResults>({})
  const [loading, setLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState("")
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const originDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const destinationDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const searchActiveRef = useRef(false)
  const cancellationSentRef = useRef(false)

  const reisezeitraumBis = useMemo(() => addDays(reisezeitraumAb, Math.min(30, weeks * 7) - 1), [reisezeitraumAb, weeks])
  const expectedDates = useMemo(() => dateRange(reisezeitraumAb, reisezeitraumBis), [reisezeitraumAb, reisezeitraumBis])
  const expectedDateSet = useMemo(() => new Set(expectedDates), [expectedDates])
  const weeksToRender = useMemo(() => calendarWeeks(reisezeitraumAb, reisezeitraumBis), [reisezeitraumAb, reisezeitraumBis])
  const entries = useMemo(() => Object.entries(priceResults).filter(([key]) => key !== "_meta") as [string, PriceData][], [priceResults])
  const meta = priceResults._meta
  const selectedData = selectedDate ? (priceResults[selectedDate] as PriceData | undefined) : null
  const positivePrices = entries.map(([, value]) => value.preis).filter((price) => price > 0)
  const searchFailures = getSearchFailures(entries.map(([, value]) => value))
  const minPrice = positivePrices.length > 0 ? Math.min(...positivePrices) : 0
  const completedDays = entries.length
  const hasSearch = Boolean(searchParams.start && searchParams.ziel)

  const notifyActiveSearchCancellation = useCallback((reason: string) => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !searchActiveRef.current || cancellationSentRef.current) return

    cancellationSentRef.current = true
    const payload = JSON.stringify({ sessionId, reason })

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const body = new Blob([payload], { type: "application/json" })
      navigator.sendBeacon("/api/search-prices/cancel-search", body)
      return
    }

    void fetch("/api/search-prices/cancel-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  }, [])

  const fetchStationSuggestions = useCallback(async (query: string, target: "origin" | "destination") => {
    if (query.trim().length < 2) {
      if (target === "origin") {
        setOriginSuggestions([])
        setShowOriginSuggestions(false)
      } else {
        setDestinationSuggestions([])
        setShowDestinationSuggestions(false)
      }
      return
    }

    try {
      const response = await fetch(`/api/station-search?q=${encodeURIComponent(query.trim())}`)
      if (!response.ok) throw new Error("Bahnhofssuche fehlgeschlagen.")
      const data = (await response.json()) as { results?: StationSuggestion[] }
      if (target === "origin") {
        setOriginSuggestions(data.results || [])
        setShowOriginSuggestions(true)
        setOriginError("")
      } else {
        setDestinationSuggestions(data.results || [])
        setShowDestinationSuggestions(true)
        setDestinationError("")
      }
    } catch (stationError) {
      const message = stationError instanceof Error ? stationError.message : "Bahnhofssuche fehlgeschlagen."
      if (target === "origin") {
        setOriginError(message)
      } else {
        setDestinationError(message)
      }
    }
  }, [])

  const resolveStationId = useCallback(async (stationId: string, target: "origin" | "destination") => {
    try {
      const response = await fetch(`/api/station-search?q=${encodeURIComponent(stationId)}`)
      const data = (await response.json()) as { results?: StationSuggestion[] }
      const station = data.results?.find((result) => result.extId === stationId) || data.results?.[0]
      if (!station) return
      if (target === "origin") {
        setOrigin(station.name)
      } else {
        setDestination(station.name)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (originId && !origin.trim()) {
      resolveStationId(originId, "origin")
    }
    if (destinationId && !destination.trim()) {
      resolveStationId(destinationId, "destination")
    }
  }, [destination, destinationId, origin, originId, resolveStationId])

  useEffect(() => {
    return () => {
      if (originDebounce.current) clearTimeout(originDebounce.current)
      if (destinationDebounce.current) clearTimeout(destinationDebounce.current)
      notifyActiveSearchCancellation("component_unmount")
      abortRef.current?.abort()
    }
  }, [notifyActiveSearchCancellation])

  useEffect(() => {
    const handleBeforeUnload = () => notifyActiveSearchCancellation("page_unload")
    const handlePageHide = () => notifyActiveSearchCancellation("pagehide")

    window.addEventListener("beforeunload", handleBeforeUnload)
    window.addEventListener("pagehide", handlePageHide)

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener("pagehide", handlePageHide)
    }
  }, [notifyActiveSearchCancellation])

  const currentSearchKey = JSON.stringify({
    start: searchParams.start,
    ziel: searchParams.ziel,
    reisezeitraumAb: searchParams.reisezeitraumAb,
    reisezeitraumBis: searchParams.reisezeitraumBis,
    alter: searchParams.alter,
    ermaessigungArt: searchParams.ermaessigungArt,
    klasse: searchParams.klasse,
    schnelleVerbindungen: searchParams.schnelleVerbindungen,
    maximaleUmstiege: searchParams.maximaleUmstiege,
    abfahrtAb: searchParams.abfahrtAb,
    ankunftBis: searchParams.ankunftBis,
  })

  useEffect(() => {
    if (!searchParams.start || !searchParams.ziel) return

    const controller = new AbortController()
    abortRef.current = controller

    async function searchPrices() {
      setLoading(true)
      setIsStreaming(true)
      setError("")
      setSelectedDate(null)
      setPriceResults({})

      const sessionId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      sessionIdRef.current = sessionId
      searchActiveRef.current = true
      cancellationSentRef.current = false

      try {
        const response = await fetch("/api/search-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            sessionId,
            start: searchParams.start,
            ziel: searchParams.ziel,
            reisezeitraumAb: searchParams.reisezeitraumAb || getTomorrowISO(),
            reisezeitraumBis: searchParams.reisezeitraumBis || addDays(searchParams.reisezeitraumAb || getTomorrowISO(), 6),
            wochentage: [1, 2, 3, 4, 5, 6, 0],
            alter: searchParams.alter || "ERWACHSENER",
            ermaessigungArt: searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
            ermaessigungKlasse: searchParams.ermaessigungKlasse || "KLASSENLOS",
            klasse: searchParams.klasse || "KLASSE_2",
            schnelleVerbindungen: searchParams.schnelleVerbindungen !== "0",
            maximaleUmstiege:
              searchParams.maximaleUmstiege && searchParams.maximaleUmstiege !== "alle"
                ? Number.parseInt(searchParams.maximaleUmstiege, 10)
                : undefined,
            abfahrtAb: searchParams.abfahrtAb,
            ankunftBis: searchParams.ankunftBis,
            umstiegszeit: searchParams.umstiegszeit,
          }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: "Bestpreissuche fehlgeschlagen." }))
          throw new Error(data.error || "Bestpreissuche fehlgeschlagen.")
        }

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (!reader) {
          const data = await response.json()
          setPriceResults(data.results || data)
          return
        }

        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.trim()) continue
            const data = JSON.parse(line)
            if (data.type === "dayResult") {
              setPriceResults((previous) => ({
                ...previous,
                [data.date]: data.result,
                _meta: data.meta || previous._meta,
              }))
            } else if (data.type === "complete") {
              setPriceResults(data.results || {})
              setIsStreaming(false)
              searchActiveRef.current = false
              sessionIdRef.current = null
            } else if (data.type === "error") {
              throw new Error(data.details || data.error || "Bestpreissuche fehlgeschlagen.")
            }
          }
        }
      } catch (searchError) {
        if (searchError instanceof Error && searchError.name === "AbortError") return
        setError(searchError instanceof Error ? searchError.message : "Bestpreissuche fehlgeschlagen.")
      } finally {
        setLoading(false)
        setIsStreaming(false)
        searchActiveRef.current = false
        sessionIdRef.current = null
      }
    }

    searchPrices()

    return () => {
      notifyActiveSearchCancellation("search_effect_cleanup")
      controller.abort()
    }
  }, [currentSearchKey, notifyActiveSearchCancellation, searchParams])

  const handleOriginChange = (value: string) => {
    setOrigin(value)
    setOriginId("")
    if (originDebounce.current) clearTimeout(originDebounce.current)
    originDebounce.current = setTimeout(() => fetchStationSuggestions(value, "origin"), 250)
  }

  const handleDestinationChange = (value: string) => {
    setDestination(value)
    setDestinationId("")
    if (destinationDebounce.current) clearTimeout(destinationDebounce.current)
    destinationDebounce.current = setTimeout(() => fetchStationSuggestions(value, "destination"), 250)
  }

  const selectStation = (station: StationSuggestion, target: "origin" | "destination") => {
    if (target === "origin") {
      setOrigin(station.name)
      setOriginId(station.extId)
      setShowOriginSuggestions(false)
    } else {
      setDestination(station.name)
      setDestinationId(station.extId)
      setShowDestinationSuggestions(false)
    }
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const params = new URLSearchParams()
    const normalizedDepartureAfter = finalizeTimeDraft(departureAfter)
    const normalizedArrivalBefore = finalizeTimeDraft(arrivalBefore)

    params.set("start", originId || origin)
    params.set("ziel", destinationId || destination)
    params.set("reisezeitraumAb", reisezeitraumAb)
    params.set("reisezeitraumBis", reisezeitraumBis)
    params.set("alter", age)
    params.set("klasse", travelClass)
    params.set("ermaessigungArt", discount)
    params.set("ermaessigungKlasse", discount === "KEINE_ERMAESSIGUNG" ? "KLASSENLOS" : travelClass)
    params.set("schnelleVerbindungen", "1")
    if (normalizedDepartureAfter) params.set("abfahrtAb", normalizedDepartureAfter)
    if (normalizedArrivalBefore) params.set("ankunftBis", normalizedArrivalBefore)
    if (maxChanges.trim()) params.set("maximaleUmstiege", maxChanges.trim())
    window.location.assign(`/klassik?${params.toString()}`)
  }

  const routeLabel =
    meta?.startStation?.name && meta?.zielStation?.name
      ? `${meta.startStation.name} -> ${meta.zielStation.name}`
      : origin && destination
        ? `${origin} -> ${destination}`
        : ""

  return (
    <div className="classicGuru">
      <form id="page" onSubmit={submitSearch}>
        <div id="header">
          <a href="/klassik" title="Preiskalender">
            <h1>Preiskalender</h1>
          </a>
        </div>

        {error && (
          <div id="error" className="subtitle">
            <span>{error}</span>
          </div>
        )}

        <div id="form">
          <div id="origin" className="station">
            <span>Ab</span>
            <input
              id="originInput"
              name="origin"
              type="text"
              value={origin}
              placeholder="Berlin Hbf"
              autoComplete="off"
              onChange={(event) => handleOriginChange(event.target.value)}
              onFocus={() => originSuggestions.length > 0 && setShowOriginSuggestions(true)}
              required
            />
            {showOriginSuggestions && originSuggestions.length > 0 && (
              <div className="classicSuggestions">
                {originSuggestions.map((station) => (
                  <button key={station.extId} type="button" onClick={() => selectStation(station, "origin")}>
                    {station.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div id="destination" className="station">
            <span>An</span>
            <input
              id="destinationInput"
              name="destination"
              type="text"
              value={destination}
              placeholder="München Hbf"
              autoComplete="off"
              onChange={(event) => handleDestinationChange(event.target.value)}
              onFocus={() => destinationSuggestions.length > 0 && setShowDestinationSuggestions(true)}
              required
            />
            {showDestinationSuggestions && destinationSuggestions.length > 0 && (
              <div className="classicSuggestions">
                {destinationSuggestions.map((station) => (
                  <button key={station.extId} type="button" onClick={() => selectStation(station, "destination")}>
                    {station.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div id="go">
            <input id="submit" name="submit" type="submit" value="Suchen" />
          </div>
        </div>

        {(originError || destinationError) && (
          <div id="error" className="subtitle">
            <span>{originError || destinationError}</span>
          </div>
        )}

        <div id="options">
          <span className="optRow">
            Reise ab{" "}
            <input
              type="date"
              value={reisezeitraumAb}
              min={getTomorrowISO()}
              onChange={(event) => setReisezeitraumAb(event.target.value)}
            />
            {" "}für{" "}
            <select value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>{" "}
            Wochen.
          </span>{" "}
          <span className="optRow">
            Ich bin{" "}
            <select id="age" value={age} onChange={(event) => setAge(event.target.value)}>
              <option value="KIND">6-14</option>
              <option value="JUGENDLICHER">15-26</option>
              <option value="ERWACHSENER">27-64</option>
              <option value="SENIOR">65+</option>
            </select>{" "}
            Jahre alt.
          </span>{" "}
          <span className="optRow">
            <select id="class" value={travelClass} onChange={(event) => setTravelClass(event.target.value)}>
              <option value="KLASSE_2">2.</option>
              <option value="KLASSE_1">1.</option>
            </select>{" "}
            Klasse,{" "}
            <select id="bc" value={discount} onChange={(event) => setDiscount(event.target.value)}>
              <option value="KEINE_ERMAESSIGUNG">keine BC</option>
              <option value="BAHNCARD25">BC25</option>
              <option value="BAHNCARD50">BC50</option>
            </select>
            .
          </span>{" "}
          <span className="optRow" id="departureAfter">
            Abfahrt nach{" "}
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="--:--"
              value={departureAfter}
              onChange={(event) => setDepartureAfter(normalizeTimeDraft(event.target.value))}
              onBlur={() => setDepartureAfter(finalizeTimeDraft(departureAfter))}
            />
            .
          </span>{" "}
          <span className="optRow" id="arrivalBefore">
            Ankunft vor{" "}
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="--:--"
              value={arrivalBefore}
              onChange={(event) => setArrivalBefore(normalizeTimeDraft(event.target.value))}
              onBlur={() => setArrivalBefore(finalizeTimeDraft(arrivalBefore))}
            />
            .
          </span>{" "}
          <span className="optRow" id="maxChanges">
            Maximal{" "}
            <input
              inputMode="numeric"
              value={maxChanges}
              placeholder="∞"
              onChange={(event) => setMaxChanges(event.target.value.replace(/[^\d]/g, ""))}
            />{" "}
            Umstiege.
          </span>
        </div>

        {hasSearch && (
          <>
            <div id="route" className="subtitle">
              <span>{routeLabel}</span>
            </div>
            <div id="classicStatus" className="subtitle">
              {isStreaming || loading ? (
                <span>
                  Suche läuft: {completedDays} von {expectedDates.length} Tagen.
                </span>
              ) : (
                <span>
                  {ageLabel(searchParams.alter || "ERWACHSENER")} Jahre, {searchParams.klasse === "KLASSE_1" ? "1." : "2."} Klasse,{" "}
                  {discountLabel(searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG")}.{" "}
                  <a id="change" href="/klassik">
                    Anfrage ändern...
                  </a>
                </span>
              )}
            </div>

            <table id="calendar">
              <thead>
                <tr>
                  {weekdays.map((weekday) => (
                    <th key={weekday.short}>
                      <span className="dayLong">{weekday.long}</span>
                      <span className="dayShort">{weekday.short}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeksToRender.map((week, weekIndex) => (
                  <tr key={week.map(formatDateKey).join("-")} className={weekIndex % 2 === 0 ? "even" : undefined}>
                    {week.map((day) => {
                      const dateKey = formatDateKey(day)
                      const result = priceResults[dateKey] as PriceData | undefined
                      const isExpected = expectedDateSet.has(dateKey)
                      const hasPrice = Boolean(isExpected && result && result.preis > 0)
                      const isCheapest = Boolean(hasPrice && result && result.preis === minPrice)
                      const dateLabel = day.getDate()
                      const isNewMonth = dateLabel === 1
                      const cellContent = (
                        <>
                          <span className="date">
                            {dateLabel}
                            {isNewMonth && <span className="month"> {months[day.getMonth()]}</span>}
                          </span>
                          <span className="priceGroup">
                            <span className="price">
                              {hasPrice ? (
                                <>
                                  <span className="priceLong">
                                    {priceParts(result!.preis).euros}
                                    <sup>{priceParts(result!.preis).cents}</sup>
                                  </span>
                                  <span className="priceShort">{priceParts(result!.preis).rounded}</span>
                                </>
                              ) : isExpected && isStreaming && !result ? (
                                "..."
                              ) : (
                                "-"
                              )}
                            </span>
                            {hasPrice && result && <span className="inlineDuration">{formatDuration(result.abfahrtsZeitpunkt, result.ankunftsZeitpunkt)}</span>}
                          </span>
                          <span className="duration">{hasPrice && result ? formatDuration(result.abfahrtsZeitpunkt, result.ankunftsZeitpunkt) : "\u200D"}</span>
                        </>
                      )

                      return (
                        <td
                          key={dateKey}
                          className={`${isCheapest ? "cheapest" : ""}${isNewMonth ? " new-month" : ""}${!isExpected ? " cell empty" : ""}`}
                        >
                          {hasPrice ? (
                            <button type="button" className="cell" onClick={() => setSelectedDate(dateKey)}>
                              {cellContent}
                            </button>
                          ) : (
                            <span className="cell empty">{cellContent}</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {selectedDate && selectedData && (
              <div id="classicDay">
                <div id="date" className="subtitle">
                  {formatLongDate(selectedDate)}
                </div>
                <table id="journeys">
                  <thead>
                    <tr>
                      <th>Abfahrt</th>
                      <th>Ankunft</th>
                      <th className="columnMiddle">Dauer</th>
                      <th className="changesColumn">Umstiege</th>
                      <th>Preis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedData.allIntervals?.length ? selectedData.allIntervals : [selectedData]).map((journey, index) => {
                      const departurePlace = "abfahrtsOrt" in journey ? journey.abfahrtsOrt : meta?.startStation?.name || ""
                      const arrivalPlace = "ankunftsOrt" in journey ? journey.ankunftsOrt : meta?.zielStation?.name || ""
                      const changes = "umstiegsAnzahl" in journey ? journey.umstiegsAnzahl : undefined
                      const bookingLink =
                        meta?.startStation && meta?.zielStation
                          ? createBookingLink(
                              journey.abfahrtsZeitpunkt,
                              meta.startStation.name,
                              meta.zielStation.name,
                              meta.startStation.id,
                              meta.zielStation.id,
                              searchParams.klasse || "KLASSE_2",
                              searchParams.maximaleUmstiege || "",
                              searchParams.alter || "ERWACHSENER",
                              searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
                              searchParams.ermaessigungKlasse || "KLASSENLOS",
                              searchParams.umstiegszeit
                            )
                          : ""

                      return (
                        <tr key={`${journey.abfahrtsZeitpunkt}-${journey.ankunftsZeitpunkt}-${index}`} className={index % 2 === 0 ? "even" : undefined}>
                          <td>
                            {formatTime(journey.abfahrtsZeitpunkt)}
                            <br />
                            <span className="placeLong">{departurePlace}</span>
                          </td>
                          <td>
                            {formatTime(journey.ankunftsZeitpunkt)}
                            <br />
                            <span className="placeLong">{arrivalPlace}</span>
                          </td>
                          <td className="columnMiddle">{formatDuration(journey.abfahrtsZeitpunkt, journey.ankunftsZeitpunkt)}</td>
                          <td className="changesColumn">{changes ?? "-"}</td>
                          <td className="price">
                            {bookingLink ? (
                              <a href={bookingLink} rel="noreferrer" target="_blank">
                                {journey.preis.toFixed(2).replace(".", ",")}€
                              </a>
                            ) : (
                              <span>{journey.preis.toFixed(2).replace(".", ",")}€</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && !isStreaming && searchFailures.length > 0 && (
              <div role="alert" className="subtitle">
                {positivePrices.length > 0 && <p>Die angezeigten Ergebnisse sind unvollständig.</p>}
                {searchFailures.map(failure => <p key={failure.message}>{failure.message}</p>)}
              </div>
            )}
            {!loading && !isStreaming && !error && searchFailures.length === 0 && entries.length > 0 && positivePrices.length === 0 && (
              <div id="error" className="subtitle">
                <span>Keine Preise gefunden.</span>
              </div>
            )}
          </>
        )}
      </form>

      <div id="footer">
        <span className="footerLine">
          Zur modernen Ansicht mit neuen Features: <a className="modernLink" href="/">sparpreis.guru</a>
        </span>
        <span className="footerLine">
          Der Klassikmodus sowie der gesamte sparpreis.guru ist inspiriert vom originalen{" "}
          <a href="https://github.com/juliuste/bahn.guru" rel="noreferrer" target="_blank">
            bahn.guru
          </a>{" "}
          von Julius Tens.
        </span>
      </div>

    </div>
  )
}
