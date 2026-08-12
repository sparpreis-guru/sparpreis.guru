"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { FAQPopup } from "@/components/layout/faq-popup"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, MapPin, Calendar, Ticket } from "lucide-react"
import { ICE_STATIONS, getDefaultStations } from "@/lib/stations/ice-stations"
import { logError } from "@/lib/shared/logger"
import { addDaysToDateKey } from "@/lib/shared/berlin-date"
import { useBerlinEarliestSearchDate } from "@/hooks/use-berlin-earliest-search-date"
import {
  ConnectionOptionsModule,
  DateTimeControlStyle,
  DirectionTimeFiltersModule,
  TravelerOptionsModule,
  dateTimeControlClass,
  searchControlClass,
} from "@/components/search/train-search-modules"

const LOG_SCOPE = "urlaubsfinder.search-form"

interface UrlauberfinderSearchFormProps {
  onSearch: (params: UrlauberfinderSearchParams) => void
  isSearching: boolean
  initialParams?: Partial<UrlauberfinderSearchParams>
  autoStartFromInitialParams?: boolean
}

export interface UrlauberfinderSearchParams {
  homeStation: string
  homeStationLabel?: string
  homeStationExtId?: string
  destinations: string[]
  outwardDate: string
  returnDate?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  klasse?: string
  schnelleVerbindungen?: boolean
  maximaleUmstiege?: string
  // Separate time filters for outward and return journeys
  outwardAbfahrtAb?: string
  outwardAbfahrtBis?: string
  outwardAnkunftAb?: string
  outwardAnkunftBis?: string
  returnAbfahrtAb?: string
  returnAbfahrtBis?: string
  returnAnkunftAb?: string
  returnAnkunftBis?: string
  umstiegszeit?: string
}

interface StationSuggestion {
  extId: string
  id: string
  name: string
}

const ctrl = searchControlClass
const dateTimeCtrl = dateTimeControlClass

const CURATED_SMALL_CITIES_PRESET = [
  "Heidelberg Hbf",
  "Freiburg Hbf",
  "Lübeck Hbf",
  "Bamberg",
  "Passau Hbf",
  "Konstanz",
  "Stralsund Hbf",
  "Rostock Hbf",
  "Trier Hbf",
  "Erfurt Hbf",
  "Potsdam Hbf",
]

function normalizeDiscount(art: string, klasse: string): { art: string; klasse: string } {
  const normalizedArt =
    art === "BAHNCARD_25" ? "BAHNCARD25" :
    art === "BAHNCARD_50" ? "BAHNCARD50" :
    art

  // Legacy fallback: if old value had no class, default to 2. Klasse like train-search-form
  if ((normalizedArt === "BAHNCARD25" || normalizedArt === "BAHNCARD50") && klasse === "KLASSENLOS") {
    return { art: normalizedArt, klasse: "KLASSE_2" }
  }

  return { art: normalizedArt, klasse }
}

function formatDateSummary(value: string) {
  if (!value) return "Datum wählen"
  return new Date(`${value}T12:00:00`).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  })
}

export function UrlauberfinderSearchForm({
  onSearch,
  isSearching,
  initialParams,
  autoStartFromInitialParams = false,
}: UrlauberfinderSearchFormProps) {
  const earliestSearchDate = useBerlinEarliestSearchDate()
  const defaultOutwardDate = addDaysToDateKey(earliestSearchDate, 6)
  const hasInitialParams = !!initialParams && Object.keys(initialParams).length > 0
  const initialDestinationNames = (initialParams?.destinations ?? []).filter(destination =>
    ICE_STATIONS.some(station => station.name === destination)
  )

  const normalizedInitialDiscount = normalizeDiscount(
    initialParams?.ermaessigungArt || "KEINE_ERMAESSIGUNG",
    initialParams?.ermaessigungKlasse || "KLASSENLOS"
  )

  const initialOutwardDate = (() => {
    if (initialParams?.outwardDate && initialParams.outwardDate >= earliestSearchDate) {
      return initialParams.outwardDate
    }
    return defaultOutwardDate
  })()

  const initialReturnDate = (() => {
    if (initialParams?.returnDate && initialParams.returnDate >= initialOutwardDate) {
      return initialParams.returnDate
    }
    return addDaysToDateKey(initialOutwardDate, 7)
  })()

  const initialUmstiegsOption = (() => {
    if (!initialParams?.maximaleUmstiege) {
      return "alle"
    }
    return initialParams.maximaleUmstiege === "0" ? "direkt" : initialParams.maximaleUmstiege
  })()

  // Home station
  const [homeStation, setHomeStation] = useState(initialParams?.homeStationLabel || initialParams?.homeStation || "")
  const [homeStationId, setHomeStationId] = useState(initialParams?.homeStationExtId || "")
  const [homeSuggestions, setHomeSuggestions] = useState<StationSuggestion[]>([])
  const [showHomeSuggestions, setShowHomeSuggestions] = useState(false)
  const [loadingHome, setLoadingHome] = useState(false)
  const [homeError, setHomeError] = useState<string | null>(null)

  // Destinations
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>(
    () => initialDestinationNames.length > 0 ? initialDestinationNames : getDefaultStations().map(s => s.name)
  )

  // Dates
  const [outwardDate, setOutwardDate] = useState(initialOutwardDate)

  const [returnDate, setReturnDate] = useState(initialReturnDate)

  const [includeReturnDate, setIncludeReturnDate] = useState(
    hasInitialParams ? !!initialParams?.returnDate : true
  )

  // Filters
  const [alter, setAlter] = useState(initialParams?.alter || "ERWACHSENER")
  const initialDiscount = normalizeDiscount("KEINE_ERMAESSIGUNG", "KLASSENLOS")
  const [ermaessigungArt, setErmaessigungArt] = useState(normalizedInitialDiscount.art || initialDiscount.art)
  const [ermaessigungKlasse, setErmaessigungKlasse] = useState(normalizedInitialDiscount.klasse || initialDiscount.klasse)
  const [klasse, setKlasse] = useState(initialParams?.klasse || "KLASSE_2")
  const [schnelleVerbindungen, setSchnelleVerbindungen] = useState(initialParams?.schnelleVerbindungen ?? true)
  const [umstiegsOption, setUmstiegsOption] = useState<string>(initialUmstiegsOption)
  const [timeFiltersOpen, setTimeFiltersOpen] = useState(false)
  const [travelerOpen, setTravelerOpen] = useState(false)
  const [connectionOptionsOpen, setConnectionOptionsOpen] = useState(
    initialUmstiegsOption !== "alle" ||
    initialParams?.umstiegszeit !== undefined ||
    initialParams?.schnelleVerbindungen === false
  )
  
  // Separate time filters for outward and return journeys
  const [outwardAbfahrtAb, setOutwardAbfahrtAb] = useState(initialParams?.outwardAbfahrtAb || "")
  const [outwardAbfahrtBis, setOutwardAbfahrtBis] = useState(initialParams?.outwardAbfahrtBis || "")
  const [outwardAnkunftAb, setOutwardAnkunftAb] = useState(initialParams?.outwardAnkunftAb || "")
  const [outwardAnkunftBis, setOutwardAnkunftBis] = useState(initialParams?.outwardAnkunftBis || "")
  const [returnAbfahrtAb, setReturnAbfahrtAb] = useState(initialParams?.returnAbfahrtAb || "")
  const [returnAbfahrtBis, setReturnAbfahrtBis] = useState(initialParams?.returnAbfahrtBis || "")
  const [returnAnkunftAb, setReturnAnkunftAb] = useState(initialParams?.returnAnkunftAb || "")
  const [returnAnkunftBis, setReturnAnkunftBis] = useState(initialParams?.returnAnkunftBis || "")
  
  const [umstiegszeit, setUmstiegszeit] = useState(initialParams?.umstiegszeit || "normal")
  const [showLargeRequestDialog, setShowLargeRequestDialog] = useState(false)
  const [pendingSearchParams, setPendingSearchParams] = useState<UrlauberfinderSearchParams | null>(null)
  const initialSearchStartedRef = useRef(false)

  const togglePreset = useCallback((presetNames: string[]) => {
    setSelectedDestinations(prev => {
      const allSelected = presetNames.every(name => prev.includes(name))
      if (allSelected) {
        return prev.filter(name => !presetNames.includes(name))
      }
      return [...new Set([...prev, ...presetNames])]
    })
  }, [])

  const germanRegionsSorted = Array.from(
    new Set(
      ICE_STATIONS
        .filter((s) => s.region !== "Europa" && !s.isDefault)
        .map((s) => s.region)
    )
  ).sort((a, b) => a.localeCompare(b, "de"))

  const homeInputRef = useRef<HTMLInputElement>(null)
  const homeSuggestionsRef = useRef<HTMLDivElement>(null)
  const homeDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const fetchHomeSuggestions = useCallback(async (query: string, retryCount = 0) => {
    const maxRetries = 3

    if (query.trim().length < 2) {
      setHomeSuggestions([])
      setShowHomeSuggestions(false)
      setHomeError(null)
      return
    }

    try {
      setLoadingHome(true)
      setHomeError(null)

      const response = await fetch(`/api/station-search?q=${encodeURIComponent(query)}`)

      if (response.status === 429) {
        const data = await response.json()
        const retryAfter = data.retryAfter || 1000

        if (retryCount < maxRetries) {
          const errorMsg = `Zu viele Anfragen, versuche erneut in ${Math.ceil(retryAfter / 1000)}s...`
          setHomeError(errorMsg)
          await new Promise(resolve => setTimeout(resolve, retryAfter))
          return fetchHomeSuggestions(query, retryCount + 1)
        } else {
          throw new Error("Rate limit exceeded. Bitte versuche es in einigen Sekunden erneut.")
        }
      }

      if (!response.ok) {
        throw new Error("Fehler beim Laden der Bahnhöfe")
      }

      const data = await response.json()
      if (data.results) {
        setHomeSuggestions(data.results)
        setShowHomeSuggestions(true)
      }
    } catch (error) {
      logError(LOG_SCOPE, "Could not fetch home station suggestions", error, { query })
      const errorMsg = error instanceof Error ? error.message : "Fehler beim Laden der Bahnhöfe"
      setHomeError(errorMsg)
    } finally {
      setLoadingHome(false)
    }
  }, [])

  const handleHomeInput = useCallback(
    (value: string) => {
      setHomeStation(value)
      setHomeStationId("")

      if (homeDebounceRef.current) {
        clearTimeout(homeDebounceRef.current)
      }

      homeDebounceRef.current = setTimeout(() => {
        fetchHomeSuggestions(value)
      }, 300)
    },
    [fetchHomeSuggestions]
  )

  const recordStationSelection = useCallback((query: string, suggestion: StationSuggestion) => {
    const trimmedQuery = query.trim()
    if (trimmedQuery.length < 2) {
      return
    }

    void fetch("/api/station-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: trimmedQuery, station: suggestion }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  const selectHomeSuggestion = useCallback((suggestion: StationSuggestion) => {
    recordStationSelection(homeStation, suggestion)
    setHomeStation(suggestion.name)
    setHomeStationId(suggestion.extId)
    setShowHomeSuggestions(false)
  }, [homeStation, recordStationSelection])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        homeInputRef.current &&
        !homeInputRef.current.contains(event.target as Node) &&
        homeSuggestionsRef.current &&
        !homeSuggestionsRef.current.contains(event.target as Node)
      ) {
        setShowHomeSuggestions(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    return () => {
      if (homeDebounceRef.current) clearTimeout(homeDebounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!initialParams || Object.keys(initialParams).length === 0) {
      return
    }

    if (initialParams.homeStation || initialParams.homeStationLabel) {
      setHomeStation(initialParams.homeStationLabel || initialParams.homeStation || "")
      setHomeStationId(initialParams.homeStationExtId || "")
    }

    const hydratedDestinations = (initialParams.destinations ?? []).filter(destination =>
      ICE_STATIONS.some(station => station.name === destination)
    )
    if (hydratedDestinations.length > 0) {
      setSelectedDestinations(hydratedDestinations)
    }

    const hydratedOutwardDate = initialParams.outwardDate && initialParams.outwardDate >= earliestSearchDate
      ? initialParams.outwardDate
      : defaultOutwardDate
    setOutwardDate(hydratedOutwardDate)

    const hydratedReturnDate = initialParams.returnDate
      ? initialParams.returnDate >= hydratedOutwardDate
        ? initialParams.returnDate
        : addDaysToDateKey(hydratedOutwardDate, 7)
      : undefined

    if (hydratedReturnDate) {
      setReturnDate(hydratedReturnDate)
      setIncludeReturnDate(true)
    } else {
      setIncludeReturnDate(false)
    }

    setAlter(initialParams.alter || "ERWACHSENER")

    const normalizedDiscount = normalizeDiscount(
      initialParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
      initialParams.ermaessigungKlasse || "KLASSENLOS"
    )
    setErmaessigungArt(normalizedDiscount.art)
    setErmaessigungKlasse(normalizedDiscount.klasse)

    if (initialParams.klasse) {
      setKlasse(initialParams.klasse)
    }

    setSchnelleVerbindungen(initialParams.schnelleVerbindungen ?? true)

    const mappedUmstiegsOption = !initialParams.maximaleUmstiege
      ? "alle"
      : initialParams.maximaleUmstiege === "0"
      ? "direkt"
      : initialParams.maximaleUmstiege
    setUmstiegsOption(mappedUmstiegsOption)
    if (
      mappedUmstiegsOption !== "alle" ||
      initialParams.umstiegszeit ||
      initialParams.schnelleVerbindungen === false
    ) {
      setConnectionOptionsOpen(true)
    }

    setOutwardAbfahrtAb(initialParams.outwardAbfahrtAb || "")
    setOutwardAbfahrtBis(initialParams.outwardAbfahrtBis || "")
    setOutwardAnkunftAb(initialParams.outwardAnkunftAb || "")
    setOutwardAnkunftBis(initialParams.outwardAnkunftBis || "")
    setReturnAbfahrtAb(initialParams.returnAbfahrtAb || "")
    setReturnAbfahrtBis(initialParams.returnAbfahrtBis || "")
    setReturnAnkunftAb(initialParams.returnAnkunftAb || "")
    setReturnAnkunftBis(initialParams.returnAnkunftBis || "")
    setUmstiegszeit(initialParams.umstiegszeit || "normal")
    if (
      initialParams.outwardAbfahrtAb ||
      initialParams.outwardAbfahrtBis ||
      initialParams.outwardAnkunftAb ||
      initialParams.outwardAnkunftBis ||
      initialParams.returnAbfahrtAb ||
      initialParams.returnAbfahrtBis ||
      initialParams.returnAnkunftAb ||
      initialParams.returnAnkunftBis
    ) {
      setTimeFiltersOpen(true)
    }

    const hydratedHomeStation = initialParams.homeStationLabel || initialParams.homeStation || ""
    if (
      !autoStartFromInitialParams ||
      initialSearchStartedRef.current ||
      (!hydratedHomeStation.trim() && !initialParams.homeStationExtId) ||
      hydratedDestinations.length === 0
    ) {
      return
    }

    initialSearchStartedRef.current = true
    const initialSearchParams: UrlauberfinderSearchParams = {
      homeStation: initialParams.homeStationExtId || hydratedHomeStation.trim(),
      homeStationLabel: hydratedHomeStation.trim(),
      homeStationExtId: initialParams.homeStationExtId,
      destinations: hydratedDestinations,
      outwardDate: hydratedOutwardDate,
      ...(hydratedReturnDate && { returnDate: hydratedReturnDate }),
      alter: initialParams.alter || "ERWACHSENER",
      ermaessigungArt: normalizedDiscount.art,
      ermaessigungKlasse: normalizedDiscount.klasse,
      klasse: initialParams.klasse || "KLASSE_2",
      schnelleVerbindungen: initialParams.schnelleVerbindungen ?? true,
      maximaleUmstiege:
        mappedUmstiegsOption === "alle"
          ? undefined
          : mappedUmstiegsOption === "direkt"
            ? "0"
            : mappedUmstiegsOption,
      outwardAbfahrtAb: initialParams.outwardAbfahrtAb,
      outwardAbfahrtBis: initialParams.outwardAbfahrtBis,
      outwardAnkunftAb: initialParams.outwardAnkunftAb,
      outwardAnkunftBis: initialParams.outwardAnkunftBis,
      ...(hydratedReturnDate && {
        returnAbfahrtAb: initialParams.returnAbfahrtAb,
        returnAbfahrtBis: initialParams.returnAbfahrtBis,
        returnAnkunftAb: initialParams.returnAnkunftAb,
        returnAnkunftBis: initialParams.returnAnkunftBis,
      }),
      umstiegszeit: initialParams.umstiegszeit && initialParams.umstiegszeit !== "normal"
        ? initialParams.umstiegszeit
        : undefined,
    }

    if (hydratedDestinations.length > 25) {
      setPendingSearchParams(initialSearchParams)
      setShowLargeRequestDialog(true)
      return
    }

    onSearch(initialSearchParams)
  }, [autoStartFromInitialParams, initialParams])

  useEffect(() => {
    if (outwardDate < earliestSearchDate) {
      setOutwardDate(defaultOutwardDate)
    }
  }, [outwardDate, earliestSearchDate, defaultOutwardDate])

  useEffect(() => {
    if (returnDate < outwardDate) {
      setReturnDate(addDaysToDateKey(outwardDate, 7))
    }
  }, [outwardDate, returnDate])

  const submitSearch = (params: UrlauberfinderSearchParams) => {
    onSearch(params)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (outwardDate < earliestSearchDate) {
      setOutwardDate(defaultOutwardDate)
      return
    }

    if (!homeStation.trim() && !homeStationId) {
      setHomeError("Bitte wähle einen Heimatbahnhof aus")
      return
    }

    if (selectedDestinations.length === 0) {
      alert("Bitte wähle mindestens ein Ziel aus")
      return
    }

    const payload: UrlauberfinderSearchParams = {
      // Always use the extId when available – it's unambiguous (same as train-search-form)
      homeStation: homeStationId || homeStation.trim(),
      homeStationLabel: homeStation.trim(),
      homeStationExtId: homeStationId || undefined,
      destinations: [...selectedDestinations],
      outwardDate,
      ...(includeReturnDate && { returnDate }),
      alter,
      ermaessigungArt,
      ermaessigungKlasse,
      klasse,
      schnelleVerbindungen,
      maximaleUmstiege: umstiegsOption === "alle" ? undefined : umstiegsOption === "direkt" ? "0" : umstiegsOption,
      outwardAbfahrtAb: outwardAbfahrtAb || undefined,
      outwardAbfahrtBis: outwardAbfahrtBis || undefined,
      outwardAnkunftAb: outwardAnkunftAb || undefined,
      outwardAnkunftBis: outwardAnkunftBis || undefined,
      ...(includeReturnDate && {
        returnAbfahrtAb: returnAbfahrtAb || undefined,
        returnAbfahrtBis: returnAbfahrtBis || undefined,
        returnAnkunftAb: returnAnkunftAb || undefined,
        returnAnkunftBis: returnAnkunftBis || undefined,
      }),
      umstiegszeit: umstiegszeit !== "normal" ? umstiegszeit : undefined,
    }

    if (selectedDestinations.length > 25) {
      setPendingSearchParams(payload)
      setShowLargeRequestDialog(true)
      return
    }

    submitSearch(payload)
  }

  const hasTimeRestriction = Boolean(
    outwardAbfahrtAb ||
    outwardAbfahrtBis ||
    outwardAnkunftAb ||
    outwardAnkunftBis ||
    (includeReturnDate && (
      returnAbfahrtAb ||
      returnAbfahrtBis ||
      returnAnkunftAb ||
      returnAnkunftBis
    ))
  )
  const timeFilterSummary = `${includeReturnDate ? "Hin- und Rückfahrt" : "Hinfahrt"} · ${
    hasTimeRestriction ? "Zeitfilter aktiv" : "ganztägig"
  }`

  return (
    <div className="w-full bg-white p-3 sm:rounded-xl sm:border sm:border-gray-200 sm:p-5 sm:shadow-sm">
      <DateTimeControlStyle />
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 sm:text-2xl">Urlaubsfinder</h2>
          <p className="mt-1 text-sm text-gray-600">Günstige Reiseziele für deine Reisedaten finden.</p>
        </div>
        <div className="hidden sm:block">
          <FAQPopup context="urlaubsfinder" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Heimatbahnhof */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
          <h3 className="text-md font-semibold text-gray-700 mb-2 sm:mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            Heimatbahnhof
          </h3>
          <div className="relative">
            <Label htmlFor="homeStation" className="text-sm font-medium text-gray-600 mb-2 block">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-4 h-4 text-blue-500" />
                Von wo startest du?
              </span>
            </Label>
            <Input
              ref={homeInputRef}
              id="homeStation"
              type="text"
              placeholder="z.B. München Hbf"
              value={homeStation}
              onChange={e => handleHomeInput(e.target.value)}
              onFocus={() => homeStation.length >= 2 && setShowHomeSuggestions(true)}
              required
              className={ctrl}
              autoComplete="off"
            />
            {homeError && (
              <div className="absolute z-50 w-full mt-1 bg-amber-50 border border-amber-300 rounded-md shadow-sm p-2">
                <p className="text-xs text-amber-800 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {homeError}
                </p>
              </div>
            )}
            {showHomeSuggestions && homeSuggestions.length > 0 && (
              <div
                ref={homeSuggestionsRef}
                className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
              >
                {loadingHome && (
                  <div className="p-2 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    Lädt...
                  </div>
                )}
                {homeSuggestions.map(suggestion => (
                  <button
                    key={suggestion.extId}
                    type="button"
                    onClick={() => selectHomeSuggestion(suggestion)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 text-sm"
                  >
                    {suggestion.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ziele */}
        <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <h3 className="text-md font-semibold text-gray-700 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-600" />
              Reiseziele
            </h3>
            <span className="text-xs text-gray-500 font-medium">
              {selectedDestinations.length} ausgewählt
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => togglePreset(ICE_STATIONS.filter(s => s.isDefault).map(s => s.name))}
              className="rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
            >
              🏙️ Großstädte
            </button>
            <button
              type="button"
              onClick={() => togglePreset(CURATED_SMALL_CITIES_PRESET.filter(name => ICE_STATIONS.some(s => s.name === name)))}
              className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              🌳 Kleinere Städte (Empfehlung)
            </button>
            <button
              type="button"
              onClick={() => togglePreset(ICE_STATIONS.filter(s => s.region === "Europa").map(s => s.name))}
              className="rounded-full border border-purple-300 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-100"
            >
              🌍 Europäische Ziele
            </button>
            <button
              type="button"
              onClick={() => togglePreset(ICE_STATIONS.map(s => s.name))}
              className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
            >
              ✓ Alle Ziele
            </button>
            <button
              type="button"
              onClick={() => setSelectedDestinations([])}
              className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
            >
              ✕ Auswahl leeren
            </button>
          </div>

          <div className="space-y-4 max-h-[340px] overflow-y-auto pr-1">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">🏙️ Großstädte</h4>
                <button
                  type="button"
                  onClick={() => {
                    const names = ICE_STATIONS.filter(s => s.isDefault).map(s => s.name)
                    const allSelected = names.every(n => selectedDestinations.includes(n))
                    if (allSelected) setSelectedDestinations(prev => prev.filter(n => !names.includes(n)))
                    else setSelectedDestinations(prev => [...new Set([...prev, ...names])])
                  }}
                  className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold"
                >
                  {ICE_STATIONS.filter(s => s.isDefault).every(s => selectedDestinations.includes(s.name))
                    ? "Auswahl leeren"
                    : "Alle wählen"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ICE_STATIONS.filter(s => s.isDefault).map(station => {
                  const checked = selectedDestinations.includes(station.name)
                  return (
                    <button
                      key={station.name}
                      type="button"
                      onClick={() => {
                        if (checked) setSelectedDestinations(prev => prev.filter(n => n !== station.name))
                        else setSelectedDestinations(prev => [...prev, station.name])
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                        checked
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      {station.displayName.replace(" Hauptbahnhof", "")}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-500">🌍 Europäische Ziele</h4>
                <button
                  type="button"
                  onClick={() => {
                    const names = ICE_STATIONS.filter(s => s.region === "Europa").map(s => s.name)
                    const allSelected = names.every(n => selectedDestinations.includes(n))
                    if (allSelected) setSelectedDestinations(prev => prev.filter(n => !names.includes(n)))
                    else setSelectedDestinations(prev => [...new Set([...prev, ...names])])
                  }}
                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-800"
                >
                  {ICE_STATIONS.filter(s => s.region === "Europa").every(s => selectedDestinations.includes(s.name))
                    ? "Auswahl leeren"
                    : "Alle wählen"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ICE_STATIONS.filter(s => s.region === "Europa").map(station => {
                  const checked = selectedDestinations.includes(station.name)
                  return (
                    <button
                      key={station.name}
                      type="button"
                      onClick={() => {
                        if (checked) setSelectedDestinations(prev => prev.filter(n => n !== station.name))
                        else setSelectedDestinations(prev => [...prev, station.name])
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                        checked
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      {station.displayName}
                    </button>
                  )
                })}
              </div>
            </div>

            {germanRegionsSorted.map(region => {
              const stations = ICE_STATIONS.filter(s => !s.isDefault && s.region === region)
              if (stations.length === 0) return null
              return (
                <div key={region}>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-xs font-bold uppercase text-gray-500">{region}</h4>
                    <button
                      type="button"
                      onClick={() => {
                        const names = stations.map(s => s.name)
                        const allSelected = names.every(n => selectedDestinations.includes(n))
                        if (allSelected) setSelectedDestinations(prev => prev.filter(n => !names.includes(n)))
                        else setSelectedDestinations(prev => [...new Set([...prev, ...names])])
                      }}
                      className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold"
                    >
                      {stations.every(s => selectedDestinations.includes(s.name))
                        ? "Auswahl leeren"
                        : "Alle wählen"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stations.map(station => {
                      const checked = selectedDestinations.includes(station.name)
                      return (
                        <button
                          key={station.name}
                          type="button"
                          onClick={() => {
                            if (checked) setSelectedDestinations(prev => prev.filter(n => n !== station.name))
                            else setSelectedDestinations(prev => [...prev, station.name])
                          }}
                          className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                            checked
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                          }`}
                        >
                          {station.displayName.replace(" Hauptbahnhof", "")}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-medium text-gray-700">Reiseart</legend>
            <div className="grid grid-cols-2 rounded-lg bg-gray-200/70 p-1" role="group" aria-label="Reiseart wählen">
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                  !includeReturnDate ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
                onClick={() => setIncludeReturnDate(false)}
                aria-pressed={!includeReturnDate}
              >
                Einfache Fahrt
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                  includeReturnDate ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
                onClick={() => setIncludeReturnDate(true)}
                aria-pressed={includeReturnDate}
              >
                Hin &amp; Rückfahrt
              </button>
            </div>
          </fieldset>

          <div className={`grid grid-cols-1 gap-3 ${includeReturnDate ? "sm:grid-cols-2" : ""}`}>
            <div>
              <Label htmlFor="outwardDate" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 text-blue-500" />
                Hinfahrt
              </Label>
              <Input
                id="outwardDate"
                type="date"
                value={outwardDate}
                onChange={e => {
                  setOutwardDate(e.target.value)
                  if (e.target.value > returnDate) {
                    setReturnDate(addDaysToDateKey(e.target.value, 7))
                  }
                }}
                min={earliestSearchDate}
                className={dateTimeCtrl}
              />
            </div>

            {includeReturnDate && (
              <div>
                <Label htmlFor="returnDate" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                  <Calendar className="h-4 w-4 text-blue-500" />
                  Rückfahrt
                </Label>
                <Input
                  id="returnDate"
                  type="date"
                  value={returnDate}
                  onChange={e => setReturnDate(e.target.value)}
                  min={outwardDate}
                  className={dateTimeCtrl}
                />
              </div>
            )}
          </div>
        </div>

        <DirectionTimeFiltersModule
          open={timeFiltersOpen}
          onOpenChange={setTimeFiltersOpen}
          includeReturn={includeReturnDate}
          title="Reisezeiten"
          summary={timeFilterSummary}
          outboundContext={formatDateSummary(outwardDate)}
          returnContext={formatDateSummary(returnDate)}
          outboundValues={{
            departureFrom: outwardAbfahrtAb,
            departureUntil: outwardAbfahrtBis,
            arrivalFrom: outwardAnkunftAb,
            arrivalUntil: outwardAnkunftBis,
          }}
          onOutboundChange={(values) => {
            setOutwardAbfahrtAb(values.departureFrom)
            setOutwardAbfahrtBis(values.departureUntil)
            setOutwardAnkunftAb(values.arrivalFrom)
            setOutwardAnkunftBis(values.arrivalUntil)
          }}
          returnValues={{
            departureFrom: returnAbfahrtAb,
            departureUntil: returnAbfahrtBis,
            arrivalFrom: returnAnkunftAb,
            arrivalUntil: returnAnkunftBis,
          }}
          onReturnChange={(values) => {
            setReturnAbfahrtAb(values.departureFrom)
            setReturnAbfahrtBis(values.departureUntil)
            setReturnAnkunftAb(values.arrivalFrom)
            setReturnAnkunftBis(values.arrivalUntil)
          }}
        />

        <TravelerOptionsModule
          open={travelerOpen}
          onOpenChange={setTravelerOpen}
          age={alter}
          onAgeChange={setAlter}
          discountType={ermaessigungArt}
          discountClass={ermaessigungKlasse}
          onDiscountChange={(type, discountClass) => {
            setErmaessigungArt(type)
            setErmaessigungKlasse(discountClass)
          }}
          travelClass={klasse}
          onTravelClassChange={setKlasse}
        />

        <ConnectionOptionsModule
          open={connectionOptionsOpen}
          onOpenChange={setConnectionOptionsOpen}
          fastConnections={schnelleVerbindungen}
          onFastConnectionsChange={setSchnelleVerbindungen}
          transferOption={umstiegsOption}
          onTransferOptionChange={setUmstiegsOption}
          transferTime={umstiegszeit}
          onTransferTimeChange={setUmstiegszeit}
        />

        <div className="sticky bottom-2 z-30 rounded-xl border border-gray-200 bg-white/95 p-2 shadow-lg backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <Button
            type="submit"
            className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Ticket className="mr-2 h-4 w-4" />
            {isSearching ? "Neue Suche starten" : "Günstige Ziele finden"}
          </Button>
        </div>
      </form>

      <AlertDialog open={showLargeRequestDialog} onOpenChange={setShowLargeRequestDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Umfangreiche Anfrage</AlertDialogTitle>
            <AlertDialogDescription>
              Du hast <strong>{selectedDestinations.length}</strong> Ziele ausgewählt. Das erzeugt viele API-Abfragen und kann deutlich länger dauern.
              <br /><br />
              Möchtest du die Suche wirklich starten?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSearchParams) {
                  submitSearch(pendingSearchParams)
                  setPendingSearchParams(null)
                }
                setShowLargeRequestDialog(false)
              }}
            >
              Trotzdem starten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
