"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Clock,
  Clock3,
  Database,
  Info,
  Loader2,
  MapPin,
  MapPinned,
  RailSymbol,
  Route,
  Search,
  TrainFront,
  TramFront,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  DirectConnectionsMap,
  type DirectConnectionResult,
  type DirectStation,
} from "@/components/direktverbindungen/direct-connections-map"
import { FAQPopup } from "@/components/layout/faq-popup"
import { Footer } from "@/components/layout/footer"
import { BrandLogo } from "@/components/layout/brand-logo"
import { MainNavigation } from "@/components/layout/main-navigation"
import { PageContainer } from "@/components/layout/page-container"
import { JourneySortControls, type JourneySortOption } from "@/components/search/journey-sort-controls"
import { logError } from "@/lib/shared/logger"

const LOG_SCOPE = "direktverbindungen.client"

type ProductFilter = "all" | "longDistance" | "regional"
type ResultSort = "duration" | "name" | "product" | "frequency"
type MaxDurationFilter = "all" | "120" | "240" | "480" | "720"
type MinTripsFilter = "all" | "1" | "3" | "5" | "10" | "20"
type SortDirection = "asc" | "desc"

const resultSortOptions: readonly JourneySortOption<ResultSort>[] = [
  { key: "duration", label: "Fahrzeit" },
  { key: "name", label: "Name" },
  { key: "product", label: "Verkehr" },
  { key: "frequency", label: "Fahrten" },
]

const productFilterUrlValues: Record<ProductFilter, string | null> = {
  all: null,
  longDistance: "fernverkehr",
  regional: "nahverkehr",
}

function getProductFilterFromParams(params: URLSearchParams): ProductFilter {
  const value = params.get("verkehr")
  if (value === "fernverkehr") return "longDistance"
  if (value === "nahverkehr") return "regional"
  return "all"
}

function getMaxDurationFromParams(params: URLSearchParams): MaxDurationFilter {
  const value = params.get("maxDauer")
  if (value === "120" || value === "240" || value === "480" || value === "720") return value
  return "all"
}

function getMinTripsFromParams(params: URLSearchParams): MinTripsFilter {
  const value = params.get("minFahrten")
  if (value === "1" || value === "3" || value === "5" || value === "10" || value === "20") return value
  return "all"
}

function replaceDirectConnectionsUrl(params: URLSearchParams) {
  const queryString = params.toString()
  window.history.replaceState({}, "", queryString ? `/direktverbindungen?${queryString}` : "/direktverbindungen")
}

interface DirectConnectionsData {
  schemaVersion: number
  source: string
  generatedAt: string
  version: string
  stations: DirectStation[]
  edges: Array<Array<{
    to: number
    time: number
    typicalTime?: number
    tripsPerDay?: number
    tripCount?: number
    firstDeparture?: string | null
    lastDeparture?: string | null
    lines?: string[]
    products: string[]
  }>>
}

interface DirectConnectionDetailDeparture {
  departure: string
  arrival: string
  duration: number
  line?: string | null
  product: "longDistance" | "regional"
}

interface DirectConnectionDetailDay {
  date: string
  departures: DirectConnectionDetailDeparture[]
}

interface DirectConnectionDetails {
  from: string
  to: string
  generatedAt: string
  version: string
  horizonStart: string | null
  horizonEnd: string | null
  days: DirectConnectionDetailDay[]
  summary: {
    dayCount: number
    departureCount: number
  }
}

type DetailLoadState =
  | { status: "loading" }
  | { status: "loaded"; data: DirectConnectionDetails }
  | { status: "error"; error: string }

interface DirektverbindungenClientProps {
  showFooter?: boolean
}

interface DirectConnectionsDbRefreshStatus {
  isRefreshing: boolean
  refreshRequired: boolean
  reason: "missing" | "stale" | null
}

const ctrl =
  "h-11 w-full min-w-0 max-w-full box-border px-3 text-base leading-tight rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function scoreStation(station: DirectStation, query: string): number {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length < 2) return -1

  const names = [station.name, ...(station.altNames ?? [])]
  let bestScore = -1

  for (const name of names) {
    const candidate = normalize(name)
    if (candidate === normalizedQuery) bestScore = Math.max(bestScore, 1000)
    else if (candidate.startsWith(normalizedQuery)) bestScore = Math.max(bestScore, 700 - candidate.length)
    else if (candidate.includes(normalizedQuery)) bestScore = Math.max(bestScore, 400 - candidate.indexOf(normalizedQuery))
    else {
      let queryIndex = 0
      let fuzzyScore = 0
      for (let i = 0; i < candidate.length && queryIndex < normalizedQuery.length; i++) {
        if (candidate[i] === normalizedQuery[queryIndex]) {
          fuzzyScore += i === 0 || candidate[i - 1] === " " ? 3 : 1
          queryIndex += 1
        }
      }
      if (queryIndex === normalizedQuery.length) bestScore = Math.max(bestScore, fuzzyScore)
    }
  }

  return bestScore
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

function formatTripsPerDay(value?: number): string {
  if (value === undefined || value === null) return "unbekannt"
  if (value < 1) return "<1 Fahrt/Tag"
  const rounded = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",")
  return `${rounded} Fahrten/Tag`
}

function formatGeneratedAt(value?: string): string {
  if (!value) return "unbekannt"
  try {
    return new Date(value).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  } catch {
    return "unbekannt"
  }
}

function productLabel(products: string[]): string {
  if (products.includes("longDistance") && products.includes("regional")) {
    return "Fern- und Nahverkehr"
  }
  if (products.includes("longDistance")) return "Fernverkehr"
  return "Nahverkehr"
}

function productClasses(products: string[]): string {
  if (products.includes("longDistance") && products.includes("regional")) {
    return "border-purple-200 bg-purple-50 text-purple-700"
  }
  if (products.includes("longDistance")) {
    return "border-red-200 bg-red-50 text-red-700"
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700"
}

function formatDateChip(value: string): string {
  try {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    })
  } catch {
    return value
  }
}

function productDotClasses(product: "longDistance" | "regional"): string {
  return product === "longDistance" ? "bg-red-500" : "bg-emerald-500"
}

export default function DirektverbindungenClient({ showFooter = false }: DirektverbindungenClientProps) {
  const [data, setData] = useState<DirectConnectionsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDatabaseUpdating, setIsDatabaseUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [selectedStation, setSelectedStation] = useState<DirectStation | null>(null)
  const [productFilter, setProductFilter] = useState<ProductFilter>("all")
  const [maxDuration, setMaxDuration] = useState<MaxDurationFilter>("all")
  const [minTripsPerDay, setMinTripsPerDay] = useState<MinTripsFilter>("all")
  const [resultSort, setResultSort] = useState<ResultSort>("duration")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [showDurationOverlay, setShowDurationOverlay] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedStationId, setHighlightedStationId] = useState<string | null>(null)
  const [resultQuery, setResultQuery] = useState("")
  const [expandedConnectionId, setExpandedConnectionId] = useState<string | null>(null)
  const [detailsByConnection, setDetailsByConnection] = useState<Record<string, DetailLoadState>>({})
  const [expandedDetailDays, setExpandedDetailDays] = useState<Record<string, boolean>>({})
  const [desktopResultsHeight, setDesktopResultsHeight] = useState<number | null>(null)
  const [showMobileBackToTop, setShowMobileBackToTop] = useState(false)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsSectionRef = useRef<HTMLElement>(null)
  const resultsGridRef = useRef<HTMLDivElement>(null)
  const shouldScrollToUrlResultsRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        setIsLoading(true)
        const paramsFromUrl = new URLSearchParams(window.location.search)
        setProductFilter(getProductFilterFromParams(paramsFromUrl))
        setMaxDuration(getMaxDurationFromParams(paramsFromUrl))
        setMinTripsPerDay(getMinTripsFromParams(paramsFromUrl))

        try {
          const statusResponse = await fetch("/api/direct-connections/status", { cache: "no-store" })
          if (statusResponse.ok) {
            const status = await statusResponse.json() as DirectConnectionsDbRefreshStatus
            if (!cancelled) setIsDatabaseUpdating(status.refreshRequired || status.isRefreshing)
          }
        } catch {
          // The data request below remains the source of truth if the optional status check fails.
        }

        const response = await fetch("/api/direct-connections", { cache: "no-store" })
        if (!response.ok) {
          throw new Error("Die Direktverbindungsdaten sind aktuell nicht verfügbar.")
        }
        const nextData = await response.json()
        if (cancelled) return
        setData(nextData)

        const stationFromUrl = paramsFromUrl.get("station")
        if (stationFromUrl) {
          const station = nextData.stations.find((item: DirectStation) => item.id === stationFromUrl)
          if (station) {
            shouldScrollToUrlResultsRef.current = true
            setSelectedStation(station)
            setQuery(station.name)
          }
        }
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : "Direktverbindungsdaten konnten nicht geladen werden.")
        logError(LOG_SCOPE, "Could not load direct connection data", loadError)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setIsDatabaseUpdating(false)
        }
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isLoading || !selectedStation || !shouldScrollToUrlResultsRef.current) return

    shouldScrollToUrlResultsRef.current = false
    window.requestAnimationFrame(() => {
      resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [isLoading, selectedStation])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    const updateBackToTopVisibility = () => {
      const resultsSection = resultsSectionRef.current
      if (!resultsSection) {
        setShowMobileBackToTop(false)
        return
      }

      const resultsTop = resultsSection.getBoundingClientRect().top + window.scrollY
      setShowMobileBackToTop(window.scrollY > resultsTop + window.innerHeight * 0.75)
    }

    updateBackToTopVisibility()
    window.addEventListener("scroll", updateBackToTopVisibility, { passive: true })
    window.addEventListener("resize", updateBackToTopVisibility)
    return () => {
      window.removeEventListener("scroll", updateBackToTopVisibility)
      window.removeEventListener("resize", updateBackToTopVisibility)
    }
  }, [])

  const suggestions = useMemo(() => {
    if (!data || query.trim().length < 2) return []

    return data.stations
      .map(station => ({ station, score: scoreStation(station, query) }))
      .filter(item => item.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const edgeDiff = (data.edges[data.stations.indexOf(b.station)]?.length ?? 0) - (data.edges[data.stations.indexOf(a.station)]?.length ?? 0)
        if (edgeDiff !== 0) return edgeDiff
        return a.station.name.localeCompare(b.station.name, "de")
      })
      .slice(0, 10)
      .map(item => item.station)
  }, [data, query])

  const selectedStationIndex = useMemo(() => {
    if (!data || !selectedStation) return -1
    return data.stations.findIndex(station => station.id === selectedStation.id)
  }, [data, selectedStation])

  const connections = useMemo<DirectConnectionResult[]>(() => {
    if (!data || selectedStationIndex < 0) return []

    const filteredConnections = (data.edges[selectedStationIndex] ?? [])
      .filter(edge => productFilter === "all" || edge.products.includes(productFilter))
      .filter(edge => maxDuration === "all" || edge.time <= Number(maxDuration))
      .filter(edge => minTripsPerDay === "all" || (edge.tripsPerDay ?? 0) >= Number(minTripsPerDay))
      .map(edge => ({
        station: data.stations[edge.to],
        time: edge.time,
        typicalTime: edge.typicalTime,
        tripsPerDay: edge.tripsPerDay,
        firstDeparture: edge.firstDeparture,
        lastDeparture: edge.lastDeparture,
        lines: edge.lines,
        products: edge.products,
      }))
      .filter(connection => !!connection.station)
      .filter(connection => {
        const trimmedQuery = normalize(resultQuery)
        if (!trimmedQuery) return true
        return normalize([
          connection.station.name,
          ...(connection.station.altNames ?? []),
          ...(connection.lines ?? []),
        ].join(" ")).includes(trimmedQuery)
      })

    const sortedConnections = filteredConnections.sort((a, b) => {
      if (resultSort === "name") {
        return a.station.name.localeCompare(b.station.name, "de") || a.time - b.time
      }
      if (resultSort === "product") {
        const productA = productLabel(a.products)
        const productB = productLabel(b.products)
        return productA.localeCompare(productB, "de") || a.time - b.time || a.station.name.localeCompare(b.station.name, "de")
      }
      if (resultSort === "frequency") {
        return (a.tripsPerDay ?? 0) - (b.tripsPerDay ?? 0) || a.time - b.time || a.station.name.localeCompare(b.station.name, "de")
      }
      return a.time - b.time || a.station.name.localeCompare(b.station.name, "de")
    })

    return sortDirection === "asc" ? sortedConnections : sortedConnections.reverse()
  }, [data, selectedStationIndex, productFilter, maxDuration, minTripsPerDay, resultQuery, resultSort, sortDirection])

  useLayoutEffect(() => {
    const grid = resultsGridRef.current
    if (!grid) {
      setDesktopResultsHeight(null)
      return
    }

    let animationFrame: number | null = null
    const measureThreeRows = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        if (!window.matchMedia("(min-width: 768px)").matches) {
          setDesktopResultsHeight(null)
          return
        }

        const gridBounds = grid.getBoundingClientRect()
        const items = Array.from(grid.children).map(child => {
          const bounds = (child as HTMLElement).getBoundingClientRect()
          return {
            top: bounds.top - gridBounds.top + grid.scrollTop,
            bottom: bounds.bottom - gridBounds.top + grid.scrollTop,
          }
        })
        const rowTops: number[] = []
        for (const item of items) {
          if (!rowTops.some(top => Math.abs(top - item.top) < 2)) rowTops.push(item.top)
        }
        rowTops.sort((left, right) => left - right)

        if (rowTops.length <= 3) {
          setDesktopResultsHeight(null)
          return
        }

        const thirdRowTop = rowTops[2]
        const thirdRowBottom = Math.max(
          ...items.filter(item => Math.abs(item.top - thirdRowTop) < 2).map(item => item.bottom)
        )
        const nextHeight = Math.ceil(thirdRowBottom)
        setDesktopResultsHeight(current => current === nextHeight ? current : nextHeight)
      })
    }

    measureThreeRows()
    const resizeObserver = new ResizeObserver(measureThreeRows)
    resizeObserver.observe(grid)
    Array.from(grid.children).forEach(child => resizeObserver.observe(child))
    window.addEventListener("resize", measureThreeRows)
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener("resize", measureThreeRows)
    }
  }, [connections, expandedConnectionId, detailsByConnection])

  const productCounts = useMemo(() => {
    if (!data || selectedStationIndex < 0) {
      return { all: 0, longDistance: 0, regional: 0 }
    }

    const edges = data.edges[selectedStationIndex] ?? []
    const durationFilteredEdges = edges
      .filter(edge => maxDuration === "all" || edge.time <= Number(maxDuration))
      .filter(edge => minTripsPerDay === "all" || (edge.tripsPerDay ?? 0) >= Number(minTripsPerDay))
    return {
      all: durationFilteredEdges.length,
      longDistance: durationFilteredEdges.filter(edge => edge.products.includes("longDistance")).length,
      regional: durationFilteredEdges.filter(edge => edge.products.includes("regional")).length,
    }
  }, [data, selectedStationIndex, maxDuration, minTripsPerDay])

  const durationCounts = useMemo(() => {
    if (!data || selectedStationIndex < 0) {
      return { all: 0, "120": 0, "240": 0, "480": 0, "720": 0 }
    }

    const edges = (data.edges[selectedStationIndex] ?? [])
      .filter(edge => productFilter === "all" || edge.products.includes(productFilter))
      .filter(edge => minTripsPerDay === "all" || (edge.tripsPerDay ?? 0) >= Number(minTripsPerDay))

    return {
      all: edges.length,
      "120": edges.filter(edge => edge.time <= 120).length,
      "240": edges.filter(edge => edge.time <= 240).length,
      "480": edges.filter(edge => edge.time <= 480).length,
      "720": edges.filter(edge => edge.time <= 720).length,
    }
  }, [data, selectedStationIndex, productFilter, minTripsPerDay])

  const tripFrequencyCounts = useMemo(() => {
    if (!data || selectedStationIndex < 0) {
      return { all: 0, "1": 0, "3": 0, "5": 0, "10": 0, "20": 0 }
    }

    const edges = (data.edges[selectedStationIndex] ?? [])
      .filter(edge => productFilter === "all" || edge.products.includes(productFilter))
      .filter(edge => maxDuration === "all" || edge.time <= Number(maxDuration))

    return {
      all: edges.length,
      "1": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 1).length,
      "3": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 3).length,
      "5": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 5).length,
      "10": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 10).length,
      "20": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 20).length,
    }
  }, [data, selectedStationIndex, productFilter, maxDuration])

  const selectStation = useCallback((station: DirectStation) => {
    setSelectedStation(station)
    setQuery(station.name)
    setShowSuggestions(false)
    setHighlightedStationId(null)
    setExpandedConnectionId(null)
    setExpandedDetailDays({})
    const params = new URLSearchParams(window.location.search)
    params.set("station", station.id)
    replaceDirectConnectionsUrl(params)
  }, [])

  const changeProductFilter = useCallback((value: ProductFilter) => {
    setProductFilter(value)
    const params = new URLSearchParams(window.location.search)
    const urlValue = productFilterUrlValues[value]
    if (urlValue) params.set("verkehr", urlValue)
    else params.delete("verkehr")
    replaceDirectConnectionsUrl(params)
  }, [])

  const changeMaxDuration = useCallback((value: MaxDurationFilter) => {
    setMaxDuration(value)
    const params = new URLSearchParams(window.location.search)
    if (value === "all") params.delete("maxDauer")
    else params.set("maxDauer", value)
    replaceDirectConnectionsUrl(params)
  }, [])

  const changeMinTripsPerDay = useCallback((value: MinTripsFilter) => {
    setMinTripsPerDay(value)
    const params = new URLSearchParams(window.location.search)
    if (value === "all") params.delete("minFahrten")
    else params.set("minFahrten", value)
    replaceDirectConnectionsUrl(params)
  }, [])

  const reset = useCallback(() => {
    setQuery("")
    setSelectedStation(null)
    setHighlightedStationId(null)
    setExpandedConnectionId(null)
    setExpandedDetailDays({})
    setShowSuggestions(false)
    const params = new URLSearchParams(window.location.search)
    params.delete("station")
    replaceDirectConnectionsUrl(params)
    inputRef.current?.focus()
  }, [])

  const handleSortClick = (sort: ResultSort) => {
    if (resultSort === sort) {
      setSortDirection(direction => direction === "asc" ? "desc" : "asc")
      return
    }

    setResultSort(sort)
    setSortDirection("asc")
  }

  const toggleConnectionDetails = useCallback(async (
    connection: DirectConnectionResult,
    options?: { forceOpen?: boolean }
  ) => {
    if (!selectedStation) return

    const targetId = connection.station.id
    setExpandedConnectionId(previous => options?.forceOpen ? targetId : previous === targetId ? null : targetId)
    setHighlightedStationId(targetId)

    if (detailsByConnection[targetId]?.status) {
      return
    }

    setDetailsByConnection(previous => ({
      ...previous,
      [targetId]: { status: "loading" },
    }))

    try {
      const response = await fetch(
        `/api/direct-connections/details?from=${encodeURIComponent(selectedStation.id)}&to=${encodeURIComponent(targetId)}`,
        { cache: "no-store" }
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Details konnten nicht geladen werden.")
      }

      setDetailsByConnection(previous => ({
        ...previous,
        [targetId]: { status: "loaded", data: payload },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Details konnten nicht geladen werden."
      setDetailsByConnection(previous => ({
        ...previous,
        [targetId]: { status: "error", error: message },
      }))
      logError(LOG_SCOPE, "Could not load direct connection details", error, {
        from: selectedStation.id,
        to: targetId,
      })
    }
  }, [detailsByConnection, selectedStation])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (suggestions[0]) {
      selectStation(suggestions[0])
    }
    if (selectedStation || suggestions[0]) {
      window.requestAnimationFrame(() => {
        resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }
  }

  const selectedStationConnectionCount = selectedStationIndex >= 0
    ? data?.edges[selectedStationIndex]?.length ?? 0
    : 0

  return (
    <div className="min-h-screen bg-white">
      <PageContainer>
        <header className="mb-6 px-3 sm:px-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <MainNavigation active="direktverbindungen" variant="mobile" />
              <h1 className="min-w-0">
                <BrandLogo />
              </h1>
            </div>
            <div className="sm:hidden">
              <FAQPopup context="direktverbindungen" />
            </div>
            <div className="hidden sm:block">
              <MainNavigation active="direktverbindungen" />
            </div>
          </div>
        </header>

        <section className="mb-8">
          <div className="w-full bg-white p-3 sm:rounded-xl sm:border sm:border-gray-200 sm:p-5 sm:shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900 sm:text-2xl">Direktverbindungen</h2>
                <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                  Ziele entdecken, die du ohne Umstieg erreichst.
                </p>
              </div>
              <div className="hidden sm:block">
                <FAQPopup context="direktverbindungen" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" aria-busy={isLoading}>
              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
                <div className="relative">
                  <Label htmlFor="direct-start" className="mb-2 block text-sm font-medium text-gray-700">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPinned className="h-4 w-4 text-blue-500" />
                      Startbahnhof
                    </span>
                  </Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      ref={inputRef}
                      id="direct-start"
                      type="text"
                      value={query}
                      placeholder="z. B. Berlin Hauptbahnhof"
                      autoComplete="off"
                      className={`${ctrl} px-10`}
                      disabled={isLoading}
                      onChange={event => {
                        setQuery(event.target.value)
                        setShowSuggestions(true)
                      }}
                      onFocus={() => query.length >= 2 && setShowSuggestions(true)}
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={showSuggestions && suggestions.length > 0}
                      aria-controls="direct-start-suggestions"
                    />
                    {query && (
                      <button
                        type="button"
                        aria-label="Startbahnhof zurücksetzen"
                        onClick={reset}
                        disabled={isLoading}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {showSuggestions && suggestions.length > 0 && (
                    <div
                      id="direct-start-suggestions"
                      ref={suggestionsRef}
                      className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg"
                      role="listbox"
                    >
                      {suggestions.map(station => (
                        <button
                          key={station.id}
                          type="button"
                          onClick={() => selectStation(station)}
                          className="w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-blue-50"
                          role="option"
                          aria-selected={selectedStation?.id === station.id}
                        >
                          <div className="font-medium text-gray-900">{station.name}</div>
                          {station.altNames && station.altNames.length > 0 && (
                            <div className="mt-0.5 truncate text-xs text-gray-500">
                              auch: {station.altNames.slice(0, 2).join(", ")}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <fieldset className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
                    <legend className="sr-only">Verkehrsmittel</legend>
                    <div className="mb-3 flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                        <TrainFront className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Verkehrsmittel</div>
                        <p className="mt-0.5 text-xs text-gray-500">Welche direkten Züge sollen zählen?</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 rounded-lg bg-gray-200/70 p-1" role="group" aria-label="Verkehrsmittel wählen">
                      {([
                        ["all", "Alle", productCounts.all, RailSymbol],
                        ["longDistance", "Fernverkehr", productCounts.longDistance, TrainFront],
                        ["regional", "Nahverkehr", productCounts.regional, TramFront],
                      ] as const).map(([value, label, count, ProductIcon]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => changeProductFilter(value)}
                          disabled={isLoading}
                          className={`min-w-0 rounded-md px-1.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:text-sm ${
                            productFilter === value
                              ? "bg-white text-blue-700 shadow-sm"
                              : "text-gray-600 hover:text-gray-900"
                          }`}
                          aria-pressed={productFilter === value}
                        >
                          <span className="flex items-center justify-center gap-1.5">
                            <ProductIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{label}</span>
                            {selectedStation && <span className="hidden text-xs opacity-70 sm:inline">({count})</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
                    <legend className="sr-only">Maximale Fahrtdauer</legend>
                    <div className="mb-3 flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                        <Clock3 className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Maximale Fahrtdauer</div>
                        <p className="mt-0.5 text-xs text-gray-500">Wie lange darf die direkte Fahrt dauern?</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-200/70 p-1 sm:grid-cols-5" role="group" aria-label="Maximale Fahrtdauer wählen">
                      {([
                        ["all", "Alle", durationCounts.all],
                        ["120", "bis 2 h", durationCounts["120"]],
                        ["240", "bis 4 h", durationCounts["240"]],
                        ["480", "bis 8 h", durationCounts["480"]],
                        ["720", "bis 12 h", durationCounts["720"]],
                      ] as const).map(([value, label, count]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => changeMaxDuration(value)}
                          disabled={isLoading}
                          className={`rounded-md px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${
                            maxDuration === value
                              ? "bg-white text-blue-700 shadow-sm"
                              : "text-gray-600 hover:text-gray-900"
                          }`}
                          aria-pressed={maxDuration === value}
                        >
                          <span className="block">{label}</span>
                          {selectedStation && <span className="block text-[10px] font-medium opacity-70">{count} Ziele</span>}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <fieldset className="mt-3 min-w-0 rounded-lg border border-gray-200 bg-white p-3">
                  <legend className="sr-only">Mindestangebot pro Tag</legend>
                  <div className="mb-3 flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                      <CalendarClock className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Verbindungen pro Tag</div>
                      <p className="mt-0.5 text-xs text-gray-500">Wie häufig soll das Ziel direkt erreichbar sein?</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-200/70 p-1 sm:grid-cols-6" role="group" aria-label="Mindestanzahl täglicher Verbindungen wählen">
                    {([
                      ["all", "Alle", tripFrequencyCounts.all],
                      ["1", "ab 1", tripFrequencyCounts["1"]],
                      ["3", "ab 3", tripFrequencyCounts["3"]],
                      ["5", "ab 5", tripFrequencyCounts["5"]],
                      ["10", "ab 10", tripFrequencyCounts["10"]],
                      ["20", "ab 20", tripFrequencyCounts["20"]],
                    ] as const).map(([value, label, count]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => changeMinTripsPerDay(value)}
                        disabled={isLoading}
                        className={`rounded-md px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${
                          minTripsPerDay === value
                            ? "bg-white text-blue-700 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        aria-pressed={minTripsPerDay === value}
                      >
                        <span className="block">{label}</span>
                        {selectedStation && <span className="block text-[10px] font-medium opacity-70">{count} Ziele</span>}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className="sticky bottom-2 z-30 rounded-xl border border-gray-200 bg-white/95 p-2 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                {isDatabaseUpdating && (
                  <span role="status" aria-live="polite" className="sr-only">
                    Die Direktverbindungsdaten werden aktualisiert. Die Suche ist gleich verfügbar.
                  </span>
                )}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-100 disabled:text-blue-800 disabled:opacity-100"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
                  {isDatabaseUpdating
                    ? "Datenbasis wird aktualisiert …"
                    : isLoading
                      ? "Daten werden geladen …"
                      : "Direktziele anzeigen"}
                </Button>
              </div>
            </form>
          </div>
        </section>

        {error && (
          <section className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <div className="font-semibold">Datenbasis fehlt</div>
                <p className="mt-1">
                  {error} Die App lädt die Daten automatisch aus dem zentralen, täglich aktualisierten Bestand und nutzt danach den lokalen Cache.
                </p>
              </div>
            </div>
          </section>
        )}

        <section ref={resultsSectionRef} className="mb-8 scroll-mt-4 space-y-4">
          <div className="border-y border-gray-200 bg-white p-2 sm:rounded-lg sm:border sm:p-4 sm:shadow-sm">
            <div className="mb-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-md font-semibold text-gray-800">Karte</h3>
                <p className="text-xs text-gray-500">
                  {selectedStation
                    ? `${connections.length} Direktziele werden angezeigt.`
                    : isLoading
                      ? "Daten werden geladen"
                      : "Wähle einen Bahnhof aus, um Direktziele auf der Karte zu sehen"}
                </p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:gap-2">
                <Badge className="border-red-200 bg-red-50 text-[10px] text-red-700 hover:bg-red-50 sm:text-xs">Fernverkehr</Badge>
                <Badge className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 hover:bg-emerald-50 sm:text-xs">Nahverkehr</Badge>
                <Badge className="border-purple-200 bg-purple-50 text-[10px] text-purple-700 hover:bg-purple-50 sm:text-xs">Beides</Badge>
                <div className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-1 shadow-sm sm:gap-2 sm:px-3 sm:py-1.5">
                  <Switch
                    id="duration-overlay-toggle"
                    checked={showDurationOverlay}
                    onCheckedChange={setShowDurationOverlay}
                    aria-label="Fahrtdauer-Zonen anzeigen"
                  />
                  <Label
                    htmlFor="duration-overlay-toggle"
                    className="cursor-pointer select-none text-xs font-semibold text-gray-700"
                  >
                    <span className="sm:hidden">Zonen</span>
                    <span className="hidden sm:inline">Fahrtdauer-Zonen</span>
                  </Label>
                </div>
              </div>
            </div>
            <DirectConnectionsMap
              selectedStation={selectedStation}
              connections={connections}
              highlightedStationId={highlightedStationId}
              showDurationOverlay={showDurationOverlay}
              onSelectConnection={connection => {
                setHighlightedStationId(connection.station.id)
                void toggleConnectionDetails(connection, { forceOpen: true })
                setTimeout(() => {
                  document.getElementById(`direct-result-${connection.station.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
                }, 50)
              }}
            />
          </div>

          <div className="border-y border-gray-200 bg-white p-2 sm:rounded-lg sm:border sm:p-4 sm:shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-md font-semibold text-gray-800">Direkt erreichbare Ziele</h3>
                <p className="text-xs text-gray-500">
                  {selectedStation
                    ? `${connections.length} von ${selectedStationConnectionCount} Zielen`
                    : "Noch kein Startbahnhof ausgewählt"}
                </p>
              </div>
              <Database className="h-5 w-5 flex-shrink-0 text-blue-600" />
            </div>

            {selectedStation && (
              <div className="mb-3 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div>
                  <Label htmlFor="direct-results-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Ergebnisliste durchsuchen
                  </Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="direct-results-search"
                      type="text"
                      value={resultQuery}
                      onChange={event => setResultQuery(event.target.value)}
                      placeholder="Ziel, Linie oder Zugname"
                      className="h-9 pl-8 pr-8 text-sm"
                    />
                    {resultQuery && (
                      <button
                        type="button"
                        aria-label="Ergebnisfilter zurücksetzen"
                        onClick={() => setResultQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <JourneySortControls
                  options={resultSortOptions}
                  sortKey={resultSort}
                  sortDir={sortDirection}
                  onSort={handleSortClick}
                  ariaLabel="Direktziele sortieren"
                  embedded
                  desktopAlign="start"
                  className="gap-2"
                />
              </div>
            )}

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map(item => (
                  <div key={item} className="h-16 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : !selectedStation ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                Gib oben einen Startbahnhof ein. Danach siehst du alle Ziele, die ohne Umstieg erreichbar sind.
              </div>
            ) : connections.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                Für diesen Filter wurden keine Direktziele gefunden.
              </div>
            ) : (
              <div
                ref={resultsGridRef}
                className="grid gap-2 md:max-h-[640px] md:grid-cols-2 md:overflow-y-auto md:pr-1 xl:grid-cols-3"
                style={desktopResultsHeight ? { maxHeight: `${desktopResultsHeight}px` } : undefined}
              >
                {connections.map(connection => {
                  const detailState = detailsByConnection[connection.station.id]
                  const isExpanded = expandedConnectionId === connection.station.id

                  return (
                  <div
                    key={connection.station.id}
                    id={`direct-result-${connection.station.id}`}
                    onMouseEnter={() => setHighlightedStationId(connection.station.id)}
                    onFocus={() => setHighlightedStationId(connection.station.id)}
                    onClick={() => setHighlightedStationId(connection.station.id)}
                    tabIndex={0}
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      highlightedStationId === connection.station.id
                        ? "border-blue-300 bg-blue-50 shadow-sm"
                        : "border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <Badge className={`${productClasses(connection.products)} w-fit max-w-full shrink-0 whitespace-normal text-left leading-snug`}>
                        {productLabel(connection.products)}
                      </Badge>
                      <div className="min-w-0 sm:order-first">
                        <div className="break-words font-semibold leading-snug text-gray-900">{connection.station.name}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          schnellste Fahrt {formatDuration(connection.time)}
                          {connection.typicalTime && connection.typicalTime !== connection.time && (
                            <> · typisch {formatDuration(connection.typicalTime)}</>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div className="rounded-md bg-gray-50 px-2 py-1.5">
                        <div className="font-semibold text-gray-800">{formatTripsPerDay(connection.tripsPerDay)}</div>
                        <div>Angebot</div>
                      </div>
                      <div className="rounded-md bg-gray-50 px-2 py-1.5">
                        <div className="font-semibold text-gray-800">
                          {connection.firstDeparture && connection.lastDeparture
                            ? `${connection.firstDeparture}-${connection.lastDeparture}`
                            : "unbekannt"}
                        </div>
                        <div>erste/letzte Fahrt</div>
                      </div>
                    </div>
                    {connection.lines && connection.lines.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {connection.lines.slice(0, 6).map(line => (
                          <span
                            key={line}
                            className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600"
                          >
                            {line}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
                      <div className="text-[11px] text-gray-500">
                        Konkrete Abfahrten der nächsten Tage
                      </div>
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation()
                          void toggleConnectionDetails(connection)
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                      >
                        <CalendarDays className="h-3.5 w-3.5" />
                        {isExpanded ? "Ausblenden" : "Details"}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3">
                        {detailState?.status === "loading" || !detailState ? (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                            Verbindungen werden geladen...
                          </div>
                        ) : detailState.status === "error" ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            {detailState.error}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                              <Badge className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50">
                                {detailState.data.summary.departureCount} Fahrten
                              </Badge>
                              <span>
                                {detailState.data.horizonStart && detailState.data.horizonEnd
                                  ? `${formatDateChip(detailState.data.horizonStart)} bis ${formatDateChip(detailState.data.horizonEnd)}`
                                  : "nächste verfügbare Tage"}
                              </span>
                            </div>

                            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                              {detailState.data.days.map(day => (
                                <div key={day.date} className="rounded-md border border-gray-100 bg-gray-50 p-2">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="font-semibold text-gray-900">{formatDateChip(day.date)}</div>
                                    <div className="text-xs text-gray-500">
                                      {day.departures.length} Fahrt{day.departures.length === 1 ? "" : "en"}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {(expandedDetailDays[`${connection.station.id}:${day.date}`] ? day.departures : day.departures.slice(0, 12)).map((departure, index) => (
                                      <div
                                        key={`${departure.departure}-${departure.arrival}-${departure.line ?? ""}-${index}`}
                                        className="grid grid-cols-[minmax(116px,1fr)_minmax(64px,auto)_minmax(42px,auto)] items-center gap-3 rounded bg-white px-2 py-1.5 text-xs text-gray-700"
                                      >
                                        <div className="flex min-w-0 items-center gap-1.5 font-semibold tabular-nums text-gray-900">
                                          <span className={`h-2 w-2 rounded-full ${productDotClasses(departure.product)}`} />
                                          <span className="whitespace-nowrap">{departure.departure}</span>
                                          <ArrowRight className="h-3 w-3 text-gray-300" />
                                          <span className="whitespace-nowrap">{departure.arrival}</span>
                                        </div>
                                        <div className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-gray-500">
                                          <Clock className="h-3 w-3" />
                                          {formatDuration(departure.duration)}
                                        </div>
                                        <div className="min-w-0 truncate text-right font-medium text-gray-600">
                                          {departure.line || productLabel([departure.product])}
                                        </div>
                                      </div>
                                    ))}
                                    {day.departures.length > 12 && (
                                      <button
                                        type="button"
                                        onClick={event => {
                                          event.stopPropagation()
                                          const key = `${connection.station.id}:${day.date}`
                                          setExpandedDetailDays(previous => ({
                                            ...previous,
                                            [key]: !previous[key],
                                          }))
                                        }}
                                        className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-left text-xs font-semibold text-blue-700 transition-colors hover:border-blue-200 hover:bg-blue-50"
                                      >
                                        {expandedDetailDays[`${connection.station.id}:${day.date}`]
                                          ? "Weniger Fahrten anzeigen"
                                          : `+${day.departures.length - 12} weitere Fahrten an diesem Tag`}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}

            {data && (
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
                Daten: {data.source}, Stand {formatGeneratedAt(data.generatedAt)} · {data.stations.length.toLocaleString("de-DE")} Bahnhöfe
              </div>
            )}
          </div>
        </section>

        {selectedStation && connections.length > 0 && showMobileBackToTop && (
          <button
            type="button"
            onClick={() => resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-3 z-[1400] inline-flex min-h-11 items-center gap-2 rounded-full border border-blue-200 bg-white px-3.5 py-2 text-xs font-semibold text-blue-700 shadow-lg transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:hidden"
            aria-label="Zum Ergebnisbereich bei der Karte scrollen"
          >
            <ArrowUp className="h-4 w-4" />
            Nach oben
          </button>
        )}

        <Footer show={showFooter} />
      </PageContainer>
    </div>
  )
}
