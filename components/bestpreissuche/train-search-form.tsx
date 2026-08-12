"use client"

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { FAQPopup } from "@/components/layout/faq-popup"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeftRight, Ticket, MapPin, Calendar, AlertTriangle, Check, CheckCircle, Lightbulb, Moon, Sparkles } from "lucide-react"
import { logError } from "@/lib/shared/logger"
import { useBerlinEarliestSearchDate } from "@/hooks/use-berlin-earliest-search-date"
import {
  ALL_SEARCH_WEEKDAYS,
  getEligibleDateKeys,
  getReturnSearchFeasibility,
  parseSearchWeekdays,
} from "@/lib/search/return-search-feasibility"
import {
  ConnectionOptionsModule,
  DateTimeControlStyle,
  DirectionTimeFiltersModule,
  TravelerOptionsModule,
  dateTimeControlClass,
  searchControlClass,
} from "@/components/search/train-search-modules"

const LOG_SCOPE = "bestpreissuche.search-form"
const ctrl = searchControlClass
const dateTimeCtrl = dateTimeControlClass

const ALL_WEEKDAYS = ALL_SEARCH_WEEKDAYS
const WEEKDAY_OPTIONS = [
  { label: "Mo", fullLabel: "Montag", value: 1 },
  { label: "Di", fullLabel: "Dienstag", value: 2 },
  { label: "Mi", fullLabel: "Mittwoch", value: 3 },
  { label: "Do", fullLabel: "Donnerstag", value: 4 },
  { label: "Fr", fullLabel: "Freitag", value: 5 },
  { label: "Sa", fullLabel: "Samstag", value: 6 },
  { label: "So", fullLabel: "Sonntag", value: 0 },
]

function sortWeekdays(weekdays: number[]) {
  return [...weekdays].sort(
    (left, right) => ALL_WEEKDAYS.indexOf(left) - ALL_WEEKDAYS.indexOf(right)
  )
}

function formatWeekdaySelection(count: number) {
  if (count === 7) return "alle Tage"
  return `${count} ${count === 1 ? "Tag" : "Tage"}`
}

function addDaysISO(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().split("T")[0]
}

function getDayDistanceISO(startDate: string, endDate: string) {
  const startTimestamp = Date.parse(`${startDate}T00:00:00Z`)
  const endTimestamp = Date.parse(`${endDate}T00:00:00Z`)

  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) return null

  const dayDistance = Math.round((endTimestamp - startTimestamp) / 86_400_000)
  return dayDistance >= 0 ? dayDistance : null
}

interface WeekdaySelectorProps {
  direction: "Hinfahrt" | "Rückfahrt"
  showDirection?: boolean
  selected: number[]
  onChange: (weekdays: number[]) => void
}

function WeekdaySelector({ direction, showDirection = true, selected, onChange }: WeekdaySelectorProps) {
  const allDaysSelected = selected.length === ALL_WEEKDAYS.length
  const selectionLabel = showDirection ? `Wochentage der ${direction}` : "Wochentage"

  return (
    <fieldset>
      <legend className="sr-only">{selectionLabel}</legend>
      <div className="mb-2 flex items-center gap-2">
        <div className="text-sm font-medium text-gray-700">{selectionLabel}</div>
        <button
          type="button"
          className={`inline-flex min-h-9 items-center rounded-md px-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${allDaysSelected ? "invisible" : "visible"}`}
          onClick={() => onChange([...ALL_WEEKDAYS])}
          disabled={allDaysSelected}
          aria-hidden={allDaysSelected}
          aria-label={`${selectionLabel}: alle auswählen`}
        >
          Alle auswählen
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {WEEKDAY_OPTIONS.map((weekday) => (
          <button
            key={weekday.value}
            type="button"
            className={`inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
              selected.includes(weekday.value)
                ? "border-blue-400 bg-blue-100/70 text-blue-900 hover:bg-blue-100"
                : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50"
            }`}
            onClick={() => {
              onChange(
                selected.includes(weekday.value)
                  ? selected.filter((value) => value !== weekday.value)
                  : [...selected, weekday.value]
              )
            }}
            aria-pressed={selected.includes(weekday.value)}
            aria-label={`${weekday.fullLabel} ${selected.includes(weekday.value) ? "abwählen" : "auswählen"}`}
          >
            <Check
              className={`h-3.5 w-3.5 ${selected.includes(weekday.value) ? "opacity-100" : "opacity-0"}`}
              aria-hidden="true"
            />
            {weekday.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

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
  wochentage?: string // Only weekdays, not individual dates
  returnWochentage?: string
  umstiegszeit?: string
}

interface TrainSearchFormProps {
  searchParams: SearchParams
  classicModeHref?: string
}

interface StationSuggestion {
  extId: string
  id: string
  name: string
}

export function TrainSearchForm({ searchParams, classicModeHref = "/klassik" }: TrainSearchFormProps) {
  const router = useRouter()
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    const handleSearchState = (event: Event) => {
      const detail = (event as CustomEvent<{ isSearching?: boolean }>).detail
      setIsSearching(Boolean(detail?.isSearching))
    }

    window.addEventListener("bestpreissuche:search-state", handleSearchState)
    return () => window.removeEventListener("bestpreissuche:search-state", handleSearchState)
  }, [])

  // Helper function to check if a string is a station ID (numeric)
  const isStationId = (value: string): boolean => {
    return /^\d+$/.test(value)
  }

  const [start, setStart] = useState(() => {
    // If the start param is an ID, don't show it, we'll resolve it later
    if (searchParams.start && isStationId(searchParams.start)) {
      return ""
    }
    return searchParams.start || ""
  })
  
  const [startId, setStartId] = useState(() => {
    // If the start param looks like an ID, store it as ID
    return searchParams.start && isStationId(searchParams.start) ? searchParams.start : ""
  })
  
  const [ziel, setZiel] = useState(() => {
    // If the ziel param is an ID, don't show it, we'll resolve it later
    if (searchParams.ziel && isStationId(searchParams.ziel)) {
      return ""
    }
    return searchParams.ziel || ""
  })
  
  const [zielId, setZielId] = useState(() => {
    // If the ziel param looks like an ID, store it as ID
    return searchParams.ziel && isStationId(searchParams.ziel) ? searchParams.ziel : ""
  })
  
  const [startSuggestions, setStartSuggestions] = useState<StationSuggestion[]>([])
  const [zielSuggestions, setZielSuggestions] = useState<StationSuggestion[]>([])
  const [showStartSuggestions, setShowStartSuggestions] = useState(false)
  const [showZielSuggestions, setShowZielSuggestions] = useState(false)
  const [activeStartSuggestionIndex, setActiveStartSuggestionIndex] = useState(-1)
  const [activeZielSuggestionIndex, setActiveZielSuggestionIndex] = useState(-1)
  const [loadingStart, setLoadingStart] = useState(false)
  const [loadingZiel, setLoadingZiel] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [zielError, setZielError] = useState<string | null>(null)
  
  const startInputRef = useRef<HTMLInputElement>(null)
  const zielInputRef = useRef<HTMLInputElement>(null)
  const startSuggestionsRef = useRef<HTMLDivElement>(null)
  const zielSuggestionsRef = useRef<HTMLDivElement>(null)
  
  // Debounce timer refs - use undefined as initial value
  const startDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const zielDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  
  const earliestSearchDate = useBerlinEarliestSearchDate()
  const defaultSearchStart = addDaysISO(earliestSearchDate, 6)

  const [reisezeitraumAb, setReisezeitraumAb] = useState(
    searchParams.reisezeitraumAb && searchParams.reisezeitraumAb >= earliestSearchDate
      ? searchParams.reisezeitraumAb
      : defaultSearchStart
  )
  const [alter, setAlter] = useState(searchParams.alter || "ERWACHSENER")
  const [ermaessigungArt, setErmaessigungArt] = useState(searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG")
  const [ermaessigungKlasse, setErmaessigungKlasse] = useState(searchParams.ermaessigungKlasse || "KLASSENLOS")
  const [klasse, setKlasse] = useState(searchParams.klasse || "KLASSE_2")
  const [schnelleVerbindungen, setSchnelleVerbindungen] = useState(
    searchParams.schnelleVerbindungen === undefined || searchParams.schnelleVerbindungen === "1"
  )
  const [abfahrtAb, setAbfahrtAb] = useState(searchParams.abfahrtAb || "")
  const [abfahrtBis, setAbfahrtBis] = useState(searchParams.abfahrtBis || "")
  const [ankunftAb, setAnkunftAb] = useState(searchParams.ankunftAb || "")
  const [ankunftBis, setAnkunftBis] = useState(searchParams.ankunftBis || "")
  const hasReturnSearchParams = searchParams.rueckfahrt === "1"
  const [rueckfahrtAktiv, setRueckfahrtAktiv] = useState(hasReturnSearchParams)
  const [timeFiltersOpen, setTimeFiltersOpen] = useState(Boolean(
    searchParams.abfahrtAb || searchParams.abfahrtBis || searchParams.ankunftAb || searchParams.ankunftBis ||
    searchParams.returnAbfahrtAb || searchParams.returnAbfahrtBis || searchParams.returnAnkunftAb || searchParams.returnAnkunftBis ||
    searchParams.wochentage || searchParams.returnWochentage
  ))
  const [travelerOpen, setTravelerOpen] = useState(false)
  const [connectionOptionsOpen, setConnectionOptionsOpen] = useState(Boolean(
    (searchParams.maximaleUmstiege && searchParams.maximaleUmstiege !== "0") ||
    searchParams.umstiegszeit ||
    searchParams.schnelleVerbindungen === "0"
  ))
  const [minNaechte, setMinNaechte] = useState(searchParams.minNaechte || "3")
  const [maxNaechte, setMaxNaechte] = useState(searchParams.maxNaechte || "")
  const [returnAbfahrtAb, setReturnAbfahrtAb] = useState(searchParams.returnAbfahrtAb || "")
  const [returnAbfahrtBis, setReturnAbfahrtBis] = useState(searchParams.returnAbfahrtBis || "")
  const [returnAnkunftAb, setReturnAnkunftAb] = useState(searchParams.returnAnkunftAb || "")
  const [returnAnkunftBis, setReturnAnkunftBis] = useState(searchParams.returnAnkunftBis || "")
  
  const [umstiegsOption, setUmstiegsOption] = useState<string>(() => {
    if (searchParams.maximaleUmstiege === "0") return "direkt"
    if (!searchParams.maximaleUmstiege || searchParams.maximaleUmstiege === "alle") return "alle"
    return searchParams.maximaleUmstiege
  })
  
  const [reisezeitraumBis, setReisezeitraumBis] = useState(() => {
    if (searchParams.reisezeitraumBis && searchParams.reisezeitraumBis >= reisezeitraumAb) {
      return searchParams.reisezeitraumBis
    }
    return addDaysISO(reisezeitraumAb, 6)
  })

  useEffect(() => {
    setReisezeitraumAb((currentStart) => currentStart < earliestSearchDate ? earliestSearchDate : currentStart)
    setReisezeitraumBis((currentEnd) =>
      currentEnd < earliestSearchDate
        ? addDaysISO(earliestSearchDate, 6)
        : currentEnd
    )
  }, [earliestSearchDate])

  const switchStations = () => {
    const tempName = start
    const tempId = startId
    setStart(ziel)
    setStartId(zielId)
    setZiel(tempName)
    setZielId(tempId)
  }

  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(() =>
    parseSearchWeekdays(searchParams.wochentage)
  )
  const [selectedReturnWeekdays, setSelectedReturnWeekdays] = useState<number[]>(() =>
    searchParams.returnWochentage
      ? parseSearchWeekdays(searchParams.returnWochentage)
      : parseSearchWeekdays(searchParams.wochentage)
  )

  const eligibleDates = useMemo(
    () => getEligibleDateKeys(reisezeitraumAb, reisezeitraumBis, selectedWeekdays),
    [reisezeitraumAb, reisezeitraumBis, selectedWeekdays]
  )

  const eligibleReturnDates = useMemo(
    () => getEligibleDateKeys(reisezeitraumAb, reisezeitraumBis, selectedReturnWeekdays),
    [reisezeitraumAb, reisezeitraumBis, selectedReturnWeekdays]
  )

  const selectedDates = useMemo(() => eligibleDates.slice(0, 30), [eligibleDates])
  const tooManyOutwardDates = eligibleDates.length > 30
  const tooManyReturnDates = rueckfahrtAktiv && eligibleReturnDates.length > 30
  const hasNoOutwardDates = eligibleDates.length === 0
  const hasNoReturnDates = rueckfahrtAktiv && eligibleReturnDates.length === 0
  const tooManyDates = tooManyOutwardDates || tooManyReturnDates
  const hasNoDates = hasNoOutwardDates || hasNoReturnDates

  // Fetch station suggestions with retry logic
  const fetchStationSuggestions = useCallback(async (query: string, type: 'start' | 'ziel', retryCount = 0) => {
    const maxRetries = 3
    
    if (query.trim().length < 2) {
      if (type === 'start') {
        setStartSuggestions([])
        setShowStartSuggestions(false)
        setStartError(null)
      } else {
        setZielSuggestions([])
        setShowZielSuggestions(false)
        setZielError(null)
      }
      return
    }
    
    try {
      if (type === 'start') {
        setLoadingStart(true)
        setStartError(null)
      } else {
        setLoadingZiel(true)
        setZielError(null)
      }
      
      const response = await fetch(`/api/station-search?q=${encodeURIComponent(query)}`)
      
      // Handle rate limiting
      if (response.status === 429) {
        const data = await response.json()
        const retryAfter = data.retryAfter || 1000
        
        if (retryCount < maxRetries) {
          // Show retry message
          const errorMsg = `Zu viele Anfragen, versuche erneut in ${Math.ceil(retryAfter / 1000)}s...`
          if (type === 'start') {
            setStartError(errorMsg)
          } else {
            setZielError(errorMsg)
          }
          
          // Retry after delay
          await new Promise(resolve => setTimeout(resolve, retryAfter))
          return fetchStationSuggestions(query, type, retryCount + 1)
        } else {
          throw new Error('Rate limit exceeded. Bitte versuche es in einigen Sekunden erneut.')
        }
      }
      
      if (!response.ok) {
        throw new Error('Fehler beim Laden der Bahnhöfe')
      }
      
      const data = await response.json()
      
      if (data.results) {
        if (type === 'start') {
          setStartSuggestions(data.results)
          setActiveStartSuggestionIndex(-1)
          setShowStartSuggestions(true)
        } else {
          setZielSuggestions(data.results)
          setActiveZielSuggestionIndex(-1)
          setShowZielSuggestions(true)
        }
      }
    } catch (error) {
      logError(LOG_SCOPE, "Could not fetch station suggestions", error, {
        query,
        field: type,
      })
      const errorMsg = error instanceof Error ? error.message : 'Fehler beim Laden der Bahnhöfe'
      if (type === 'start') {
        setStartError(errorMsg)
      } else {
        setZielError(errorMsg)
      }
    } finally {
      if (type === 'start') {
        setLoadingStart(false)
      } else {
        setLoadingZiel(false)
      }
    }
  }, [])
  
  // Handle input changes with debounce
  const handleStartInput = useCallback((value: string) => {
    setStart(value)
    setStartId("") // Clear ID when manually typing
    setActiveStartSuggestionIndex(-1)
    
    if (startDebounceRef.current) {
      clearTimeout(startDebounceRef.current)
    }
    
    startDebounceRef.current = setTimeout(() => {
      fetchStationSuggestions(value, 'start')
    }, 300)
  }, [fetchStationSuggestions])
  
  const handleZielInput = useCallback((value: string) => {
    setZiel(value)
    setZielId("") // Clear ID when manually typing
    setActiveZielSuggestionIndex(-1)
    
    if (zielDebounceRef.current) {
      clearTimeout(zielDebounceRef.current)
    }
    
    zielDebounceRef.current = setTimeout(() => {
      fetchStationSuggestions(value, 'ziel')
    }, 300)
  }, [fetchStationSuggestions])

  const recordStationSelection = useCallback((query: string, suggestion: StationSuggestion) => {
    const trimmedQuery = query.trim()
    if (trimmedQuery.length < 2) {
      return
    }

    void fetch('/api/station-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: trimmedQuery, station: suggestion }),
      keepalive: true,
    }).catch(() => {})
  }, [])
  
  // Handle suggestion selection
  const selectStartSuggestion = useCallback((suggestion: StationSuggestion) => {
    recordStationSelection(start, suggestion)
    setStart(suggestion.name)
    setStartId(suggestion.extId)
    setActiveStartSuggestionIndex(-1)
    setShowStartSuggestions(false)
  }, [recordStationSelection, start])
  
  const selectZielSuggestion = useCallback((suggestion: StationSuggestion) => {
    recordStationSelection(ziel, suggestion)
    setZiel(suggestion.name)
    setZielId(suggestion.extId)
    setActiveZielSuggestionIndex(-1)
    setShowZielSuggestions(false)
  }, [recordStationSelection, ziel])

  const handleStationKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    type: 'start' | 'ziel'
  ) => {
    const suggestions = type === 'start' ? startSuggestions : zielSuggestions
    const isOpen = type === 'start' ? showStartSuggestions : showZielSuggestions
    const activeIndex = type === 'start' ? activeStartSuggestionIndex : activeZielSuggestionIndex
    const setOpen = type === 'start' ? setShowStartSuggestions : setShowZielSuggestions
    const setActiveIndex = type === 'start' ? setActiveStartSuggestionIndex : setActiveZielSuggestionIndex
    const selectSuggestion = type === 'start' ? selectStartSuggestion : selectZielSuggestion

    const activateSuggestion = (index: number) => {
      setActiveIndex(index)
      window.requestAnimationFrame(() => {
        document.getElementById(`${type}-suggestion-${index}`)?.scrollIntoView({ block: 'nearest' })
      })
    }

    if (event.key === 'Escape') {
      if (!isOpen) return
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
      return
    }

    if (event.key === 'Tab') {
      setOpen(false)
      setActiveIndex(-1)
      return
    }

    if (suggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      activateSuggestion(activeIndex < suggestions.length - 1 ? activeIndex + 1 : 0)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      activateSuggestion(activeIndex > 0 ? activeIndex - 1 : suggestions.length - 1)
      return
    }

    if (isOpen && event.key === 'Home') {
      event.preventDefault()
      activateSuggestion(0)
      return
    }

    if (isOpen && event.key === 'End') {
      event.preventDefault()
      activateSuggestion(suggestions.length - 1)
      return
    }

    if (isOpen && event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      selectSuggestion(suggestions[activeIndex])
    }
  }
  
  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (startInputRef.current && !startInputRef.current.contains(event.target as Node) &&
          startSuggestionsRef.current && !startSuggestionsRef.current.contains(event.target as Node)) {
        setShowStartSuggestions(false)
        setActiveStartSuggestionIndex(-1)
      }
      if (zielInputRef.current && !zielInputRef.current.contains(event.target as Node) &&
          zielSuggestionsRef.current && !zielSuggestionsRef.current.contains(event.target as Node)) {
        setShowZielSuggestions(false)
        setActiveZielSuggestionIndex(-1)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Cleanup debounce timers
  useEffect(() => {
    return () => {
      if (startDebounceRef.current) clearTimeout(startDebounceRef.current)
      if (zielDebounceRef.current) clearTimeout(zielDebounceRef.current)
    }
  }, [])

  // Resolve station IDs to names on mount
  useEffect(() => {
    const resolveStationId = async (id: string, type: 'start' | 'ziel') => {
      try {
        // Search for the station by ID - the API will return the station details
        const response = await fetch(`/api/station-search?q=${encodeURIComponent(id)}`)
        const data = await response.json()
        
        if (data.results && data.results.length > 0) {
          // Find exact match by extId
          const station = data.results.find((s: StationSuggestion) => s.extId === id) || data.results[0]
          if (type === 'start') {
            setStart(station.name)
          } else {
            setZiel(station.name)
          }
        }
      } catch (error) {
        logError(LOG_SCOPE, "Could not resolve station ID", error, {
          stationId: id,
          field: type,
        })
        // Fallback: show the ID if resolution fails
        if (type === 'start') {
          setStart(id)
        } else {
          setZiel(id)
        }
      }
    }
    
    // Resolve station IDs from URL params only. A freshly selected suggestion already
    // has the correct label and must not be overwritten by another lookup.
    if (startId && !start.trim()) {
      resolveStationId(startId, 'start')
    }
    
    if (zielId && !ziel.trim()) {
      resolveStationId(zielId, 'ziel')
    }
  }, [startId, zielId, start, ziel])
  
  const parsedMinNights = Number(minNaechte)
  const parsedMaxNights = maxNaechte ? Number(maxNaechte) : undefined
  const returnDetailsInvalid = rueckfahrtAktiv && (
    !Number.isInteger(parsedMinNights) ||
    parsedMinNights < 1 ||
    (parsedMaxNights !== undefined && (
      !Number.isInteger(parsedMaxNights) || parsedMaxNights < parsedMinNights
    ))
  )
  const returnFeasibility = useMemo(
    () => getReturnSearchFeasibility({
      outwardDates: eligibleDates,
      returnDates: eligibleReturnDates,
      minNights: parsedMinNights,
      maxNights: parsedMaxNights,
    }),
    [eligibleDates, eligibleReturnDates, parsedMinNights, parsedMaxNights]
  )
  const hasImpossibleStay = rueckfahrtAktiv && !returnDetailsInvalid && !hasNoDates && !returnFeasibility.hasCombination
  const hasSearchConfigurationError = tooManyDates || hasNoDates || hasImpossibleStay
  const impossibleStayMessage = returnFeasibility.maximumAvailableNights !== null &&
    returnFeasibility.maximumAvailableNights < parsedMinNights
      ? `Der Reisezeitraum ermöglicht höchstens ${returnFeasibility.maximumAvailableNights} ${returnFeasibility.maximumAvailableNights === 1 ? "Nacht" : "Nächte"}. Verlängere den Zeitraum oder reduziere die Mindestdauer.`
      : "Mit den gewählten Reisetagen und der Aufenthaltsdauer ist keine Hin- und Rückfahrt möglich."

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (hasSearchConfigurationError || returnDetailsInvalid) return
    const params = new URLSearchParams()
    
    // Use station ID if available, otherwise fallback to name
    if (startId) {
      params.set("start", startId)
    } else if (start) {
      params.set("start", start)
    }
    
    if (zielId) {
      params.set("ziel", zielId)
    } else if (ziel) {
      params.set("ziel", ziel)
    }
    
    if (reisezeitraumAb) params.set("reisezeitraumAb", reisezeitraumAb)
    if (reisezeitraumBis) params.set("reisezeitraumBis", reisezeitraumBis)
    if (alter) params.set("alter", alter)
    params.set("ermaessigungArt", ermaessigungArt)
    params.set("ermaessigungKlasse", ermaessigungKlasse)
    params.set("klasse", klasse)
    if (schnelleVerbindungen) params.set("schnelleVerbindungen", "1")
    if (abfahrtAb) params.set("abfahrtAb", abfahrtAb)
    if (abfahrtBis) params.set("abfahrtBis", abfahrtBis)
    if (ankunftAb) params.set("ankunftAb", ankunftAb)
    if (ankunftBis) params.set("ankunftBis", ankunftBis)
    if (umstiegszeit && umstiegszeit !== "normal") {
      params.set("umstiegszeit", umstiegszeit)
    }
    if (rueckfahrtAktiv) {
      params.set("rueckfahrt", "1")
      params.set("minNaechte", minNaechte || "1")
      if (maxNaechte) params.set("maxNaechte", maxNaechte)
      if (returnAbfahrtAb) params.set("returnAbfahrtAb", returnAbfahrtAb)
      if (returnAbfahrtBis) params.set("returnAbfahrtBis", returnAbfahrtBis)
      if (returnAnkunftAb) params.set("returnAnkunftAb", returnAnkunftAb)
      if (returnAnkunftBis) params.set("returnAnkunftBis", returnAnkunftBis)
      params.set("returnWochentage", sortWeekdays(selectedReturnWeekdays).join(","))
    }
    
    // Umstiegs-Logik basierend auf umstiegsOption
    if (umstiegsOption === "direkt") {
      params.set("maximaleUmstiege", "0")
    } else if (umstiegsOption === "alle") {
      // Kein maximaleUmstiege Parameter setzen = alle Verbindungen
    } else {
      // umstiegsOption ist "1", "2", "3", "4", oder "5"
      params.set("maximaleUmstiege", umstiegsOption)
    }
    
    // Only send weekdays if not all days are selected
    const isAllDaysSelected = ALL_WEEKDAYS.every(day => selectedWeekdays.includes(day)) && selectedWeekdays.length === ALL_WEEKDAYS.length
    
    if (!isAllDaysSelected) {
      // Use readable format: "1,2,3,4,5" instead of JSON
      params.set("wochentage", sortWeekdays(selectedWeekdays).join(","))
    }
    
    const currentParams = new URLSearchParams(window.location.search)
    const normalizedCurrentParams = new URLSearchParams(currentParams)
    const normalizedNextParams = new URLSearchParams(params)
    normalizedCurrentParams.sort()
    normalizedNextParams.sort()

    if (normalizedCurrentParams.toString() === normalizedNextParams.toString()) {
      window.dispatchEvent(new Event("bestpreissuche:restart"))
    } else {
      window.dispatchEvent(new Event("bestpreissuche:replace"))
      router.push(`/?${params.toString()}`, { scroll: false })
    }
  }

  const handleReset = () => {
    const resetStart = defaultSearchStart
    setStart("")
    setStartId("")
    setZiel("")
    setZielId("")
    setReisezeitraumAb(resetStart)
    setReisezeitraumBis(addDaysISO(resetStart, 6))
    setAlter("ERWACHSENER")
    setErmaessigungArt("KEINE_ERMAESSIGUNG")
    setErmaessigungKlasse("KLASSENLOS")
    setKlasse("KLASSE_2")
    setSchnelleVerbindungen(true)
    setUmstiegsOption("alle")
    setAbfahrtAb("")
    setAbfahrtBis("")
    setAnkunftAb("")
    setAnkunftBis("")
    setRueckfahrtAktiv(false)
    setTimeFiltersOpen(false)
    setTravelerOpen(false)
    setConnectionOptionsOpen(false)
    setMinNaechte("3")
    setMaxNaechte("")
    setReturnAbfahrtAb("")
    setReturnAbfahrtBis("")
    setReturnAnkunftAb("")
    setReturnAnkunftBis("")
    setUmstiegszeit("normal")
    setSelectedWeekdays([...ALL_WEEKDAYS])
    setSelectedReturnWeekdays([...ALL_WEEKDAYS])
    window.history.replaceState({}, document.title, window.location.pathname)
  }

  const handleReisezeitraumAbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextStart = e.target.value
    const previousDayDistance = getDayDistanceISO(reisezeitraumAb, reisezeitraumBis)

    setReisezeitraumAb(nextStart)
    if (nextStart) {
      setReisezeitraumBis(addDaysISO(nextStart, previousDayDistance ?? 1))
    }
  }

  const [umstiegszeit, setUmstiegszeit] = useState(searchParams.umstiegszeit || "normal")

  const hasTimeRestriction = Boolean(
    abfahrtAb || abfahrtBis || ankunftAb || ankunftBis ||
    (rueckfahrtAktiv && (returnAbfahrtAb || returnAbfahrtBis || returnAnkunftAb || returnAnkunftBis))
  )
  const scheduleSummary = `${
    rueckfahrtAktiv
      ? `Hin: ${formatWeekdaySelection(selectedWeekdays.length)} · Rück: ${formatWeekdaySelection(selectedReturnWeekdays.length)}`
      : formatWeekdaySelection(selectedWeekdays.length)
  } · ${hasTimeRestriction ? "Zeitfilter aktiv" : "ganztägig"}`
  const largestDirectionDayCount = Math.max(
    eligibleDates.length,
    rueckfahrtAktiv ? eligibleReturnDates.length : 0
  )
  const isSmallSearch = largestDirectionDayCount <= 14
  const isLargeSearch = rueckfahrtAktiv
    ? eligibleDates.length >= 20 && eligibleReturnDates.length >= 20
    : eligibleDates.length >= 20
  const searchSize = isLargeSearch ? "large" : isSmallSearch ? "small" : "medium"
  const searchSizeClasses = hasSearchConfigurationError
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : searchSize === "large"
      ? "border-orange-200 bg-orange-50 text-orange-900"
      : searchSize === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-green-200 bg-green-50 text-green-900"
  const searchSizeHint = searchSize === "large"
    ? "Große Abfrage – die Suche kann deutlich länger dauern."
    : largestDirectionDayCount > 10
      ? "Je weniger Tage du vergleichst, desto schneller erhältst du Ergebnisse."
      : "Optimale Auswahl für schnelle Ergebnisse."
  return (
    <div className="w-full bg-white p-3 sm:rounded-xl sm:border sm:border-gray-200 sm:p-5 sm:shadow-sm">
      <DateTimeControlStyle />
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2.5">
            <h2 className="shrink-0 text-lg font-bold text-gray-900 sm:text-2xl">Bestpreise finden</h2>
            <a
              href={classicModeHref}
              className="group inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-red-200 bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 px-2 py-1 text-[11px] font-semibold text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:border-red-300 hover:shadow-md sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs"
              aria-label="Zeitreise zum bahn.guru-Klassikmodus"
            >
              <Sparkles className="h-3 w-3 text-amber-500 transition-transform group-hover:rotate-12 sm:h-3.5 sm:w-3.5" />
              <span className="sm:hidden">bahn.guru-Modus</span>
              <span className="hidden sm:inline">Zeitreise: bahn.guru-Klassikmodus</span>
              <span className="transition-transform group-hover:translate-x-0.5 sm:inline" aria-hidden="true">→</span>
            </a>
          </div>
          <p className="mt-1 whitespace-nowrap text-xs text-gray-600 sm:text-sm">Zeitraum wählen, Bestpreis finden.</p>
        </div>
        <div className="hidden sm:block">
          <FAQPopup context="bestpreissuche" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4">
          <fieldset className="order-1 mb-4">
            <legend className="mb-2 text-sm font-medium text-gray-700">Reiseart</legend>
            <div className="grid grid-cols-2 rounded-lg bg-gray-200/70 p-1" role="group" aria-label="Reiseart wählen">
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${!rueckfahrtAktiv ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                onClick={() => setRueckfahrtAktiv(false)}
                aria-pressed={!rueckfahrtAktiv}
              >
                Einfache Fahrt
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${rueckfahrtAktiv ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                onClick={() => {
                  if (!rueckfahrtAktiv) {
                    setSelectedReturnWeekdays([...selectedWeekdays])
                  }
                  setRueckfahrtAktiv(true)
                }}
                aria-pressed={rueckfahrtAktiv}
              >
                Hin &amp; Rückfahrt
              </button>
            </div>
          </fieldset>

          <div className="order-2 mb-4 grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-end gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2">
            <div className="relative min-w-0">
              <Label htmlFor="start" className="mb-2 block text-sm font-medium text-gray-600">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-blue-500" />
                  Von
                </span>
              </Label>
              <Input
                ref={startInputRef}
                id="start"
                type="text"
                placeholder="München Hbf"
                value={start}
                onChange={(e) => handleStartInput(e.target.value)}
                onFocus={() => start.length >= 2 && startSuggestions.length > 0 && setShowStartSuggestions(true)}
                onKeyDown={(event) => handleStationKeyDown(event, 'start')}
                required
                className={ctrl}
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showStartSuggestions}
                aria-controls="start-suggestions"
                aria-activedescendant={showStartSuggestions && activeStartSuggestionIndex >= 0 ? `start-suggestion-${activeStartSuggestionIndex}` : undefined}
              />
              {startError && (
                <div className="absolute z-50 w-full mt-1 bg-amber-50 border border-amber-300 rounded-md shadow-sm p-2">
                  <p className="text-xs text-amber-800 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {startError}
                  </p>
                </div>
              )}
              {showStartSuggestions && (loadingStart || startSuggestions.length > 0) && (
                <div
                  id="start-suggestions"
                  ref={startSuggestionsRef}
                  className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
                  role="listbox"
                >
                  {loadingStart && (
                    <div className="p-2 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Lädt...
                    </div>
                  )}
                  {startSuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.extId}
                      id={`start-suggestion-${index}`}
                      type="button"
                      tabIndex={-1}
                      className={`min-h-11 w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 ${activeStartSuggestionIndex === index ? "bg-blue-50 text-blue-950" : "text-gray-900 hover:bg-blue-50"}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveStartSuggestionIndex(index)}
                      onClick={() => selectStartSuggestion(suggestion)}
                      role="option"
                      aria-selected={activeStartSuggestionIndex === index}
                    >
                      <div className="font-medium text-gray-900">{suggestion.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex h-11 items-center justify-center">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={switchStations}
                className="h-11 w-11 rounded-md border-gray-300 bg-white p-0 text-gray-600 shadow-none hover:bg-gray-50"
                aria-label="Bahnhöfe tauschen"
              >
                <ArrowLeftRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>
            <div className="relative min-w-0">
              <Label htmlFor="ziel" className="mb-2 block text-sm font-medium text-gray-600">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-blue-500" />
                  Nach
                </span>
              </Label>
              <Input
                ref={zielInputRef}
                id="ziel"
                type="text"
                placeholder="Berlin Hbf"
                value={ziel}
                onChange={(e) => handleZielInput(e.target.value)}
                onFocus={() => ziel.length >= 2 && zielSuggestions.length > 0 && setShowZielSuggestions(true)}
                onKeyDown={(event) => handleStationKeyDown(event, 'ziel')}
                required
                className={ctrl}
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showZielSuggestions}
                aria-controls="ziel-suggestions"
                aria-activedescendant={showZielSuggestions && activeZielSuggestionIndex >= 0 ? `ziel-suggestion-${activeZielSuggestionIndex}` : undefined}
              />
              {zielError && (
                <div className="absolute z-50 w-full mt-1 bg-amber-50 border border-amber-300 rounded-md shadow-sm p-2">
                  <p className="text-xs text-amber-800 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {zielError}
                  </p>
                </div>
              )}
              {showZielSuggestions && (loadingZiel || zielSuggestions.length > 0) && (
                <div
                  id="ziel-suggestions"
                  ref={zielSuggestionsRef}
                  className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
                  role="listbox"
                >
                  {loadingZiel && (
                    <div className="p-2 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Lädt...
                    </div>
                  )}
                  {zielSuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.extId}
                      id={`ziel-suggestion-${index}`}
                      type="button"
                      tabIndex={-1}
                      className={`min-h-11 w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 ${activeZielSuggestionIndex === index ? "bg-blue-50 text-blue-950" : "text-gray-900 hover:bg-blue-50"}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveZielSuggestionIndex(index)}
                      onClick={() => selectZielSuggestion(suggestion)}
                      role="option"
                      aria-selected={activeZielSuggestionIndex === index}
                    >
                      <div className="font-medium text-gray-900">{suggestion.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={`order-3 grid gap-4 ${rueckfahrtAktiv ? "sm:grid-cols-2" : ""}`}>
            <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
              <div className="mb-3 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                  <Calendar className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-gray-900">Reisezeitraum</div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {rueckfahrtAktiv
                      ? "In welchem Zeitraum sollen Hin- und Rückfahrt liegen?"
                      : "Wann möchtest du losfahren?"}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="reisezeitraumAb" className="mb-1 block text-xs font-medium text-gray-600">
                    Frühestens
                  </Label>
                  <Input
                    id="reisezeitraumAb"
                    type="date"
                    value={reisezeitraumAb}
                    onChange={handleReisezeitraumAbChange}
                    min={earliestSearchDate}
                    className={dateTimeCtrl}
                  />
                </div>
                <div>
                  <Label htmlFor="reisezeitraumBis" className="mb-1 block text-xs font-medium text-gray-600">
                    Spätestens
                  </Label>
                  <Input
                    id="reisezeitraumBis"
                    type="date"
                    min={reisezeitraumAb}
                    value={reisezeitraumBis}
                    onChange={(event) => setReisezeitraumBis(event.target.value)}
                    className={dateTimeCtrl}
                  />
                </div>
              </div>
            </div>

            {rueckfahrtAktiv && (
              <fieldset className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
                <legend className="sr-only">Aufenthaltsdauer</legend>
                <div className="mb-3 flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                    <Moon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Aufenthaltsdauer</div>
                    <p className="mt-0.5 text-xs text-gray-500">Wie lange möchtest du am Ziel bleiben?</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="minNaechte" className="mb-1 block text-xs font-medium text-gray-600">
                      Mindestens
                    </Label>
                    <div className="relative">
                      <Input
                        id="minNaechte"
                        type="number"
                        min="1"
                        max="365"
                        value={minNaechte}
                        onChange={(event) => setMinNaechte(event.target.value)}
                        className={`${ctrl} pr-16`}
                        required={rueckfahrtAktiv}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                        {Number.parseInt(minNaechte, 10) === 1 ? "Nacht" : "Nächte"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="maxNaechte" className="mb-1 block text-xs font-medium text-gray-600">
                      Höchstens
                    </Label>
                    <div className="relative">
                      <Input
                        id="maxNaechte"
                        type="number"
                        min={minNaechte || "1"}
                        max="365"
                        placeholder="offen"
                        value={maxNaechte}
                        onChange={(event) => setMaxNaechte(event.target.value)}
                        className={`${ctrl} pr-16`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                        {Number.parseInt(maxNaechte, 10) === 1 ? "Nacht" : "Nächte"}
                      </span>
                    </div>
                  </div>
                </div>
                <p className={`mt-1.5 text-xs ${returnDetailsInvalid || hasImpossibleStay ? "text-amber-700" : "text-gray-500"}`}>
                  {returnDetailsInvalid
                    ? (!minNaechte
                        ? "Bitte gib die gewünschte Mindestdauer an."
                        : "Die maximale Dauer muss mindestens der minimalen entsprechen.")
                    : hasImpossibleStay
                      ? impossibleStayMessage
                    : maxNaechte && minNaechte === maxNaechte
                      ? `Rückfahrt nach ${minNaechte} ${Number.parseInt(minNaechte, 10) === 1 ? "Nacht" : "Nächten"}.`
                      : maxNaechte
                        ? `Rückfahrt nach ${minNaechte} bis ${maxNaechte} Nächten.`
                        : `Rückfahrt nach ${minNaechte} ${Number.parseInt(minNaechte, 10) === 1 ? "Nacht" : "Nächten"} oder mehr.`}
                </p>
              </fieldset>
            )}
          </div>

          {!hasImpossibleStay && (
            <div
              className={`order-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${searchSizeClasses}`}
              role={hasSearchConfigurationError ? "alert" : "status"}
            >
              {hasSearchConfigurationError
                ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : searchSize === "small"
                  ? <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : searchSize === "medium"
                    ? <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>
                {tooManyOutwardDates
                  ? `Die Hinfahrt enthält ${eligibleDates.length} Reisetage. Bitte auf maximal 30 Tage begrenzen.`
                  : tooManyReturnDates
                    ? `Die Rückfahrt enthält ${eligibleReturnDates.length} Reisetage. Bitte auf maximal 30 Tage begrenzen.`
                    : hasNoOutwardDates
                      ? "Für die Hinfahrt liegt kein gewählter Wochentag im Reisezeitraum."
                      : hasNoReturnDates
                        ? "Für die Rückfahrt liegt kein gewählter Wochentag im Reisezeitraum."
                        : rueckfahrtAktiv
                          ? `${eligibleDates.length} Hinfahrts- und ${eligibleReturnDates.length} Rückfahrtstage werden verglichen. ${searchSizeHint}`
                          : `${eligibleDates.length} ${eligibleDates.length === 1 ? "Reisetag wird" : "Reisetage werden"} verglichen. ${searchSizeHint}`}
              </span>
            </div>
          )}

          <div className="order-5 mt-3">
            <DirectionTimeFiltersModule
              open={timeFiltersOpen}
              onOpenChange={setTimeFiltersOpen}
              includeReturn={rueckfahrtAktiv}
              title="Reisezeiten"
              summary={scheduleSummary}
              outboundContext={formatWeekdaySelection(selectedWeekdays.length)}
              returnContext={formatWeekdaySelection(selectedReturnWeekdays.length)}
              outboundValues={{
                departureFrom: abfahrtAb,
                departureUntil: abfahrtBis,
                arrivalFrom: ankunftAb,
                arrivalUntil: ankunftBis,
              }}
              onOutboundChange={(values) => {
                setAbfahrtAb(values.departureFrom)
                setAbfahrtBis(values.departureUntil)
                setAnkunftAb(values.arrivalFrom)
                setAnkunftBis(values.arrivalUntil)
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
              outboundBefore={(
                <WeekdaySelector
                  direction="Hinfahrt"
                  showDirection={rueckfahrtAktiv}
                  selected={selectedWeekdays}
                  onChange={setSelectedWeekdays}
                />
              )}
              returnBefore={(
                <WeekdaySelector
                  direction="Rückfahrt"
                  selected={selectedReturnWeekdays}
                  onChange={setSelectedReturnWeekdays}
                />
              )}
            />
          </div>
        </div>

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
            key={rueckfahrtAktiv ? "return-search" : "single-search"}
            type="submit"
            disabled={hasSearchConfigurationError || returnDetailsInvalid}
            className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Ticket className="mr-2 h-4 w-4" />
            {isSearching
              ? "Neue Suche starten"
              : rueckfahrtAktiv
                ? "Günstigste Kombinationen suchen"
                : `Bestpreise für ${eligibleDates.length} ${eligibleDates.length === 1 ? "Tag" : "Tage"} suchen`}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs">
          <button type="button" onClick={handleReset} className="text-gray-500 underline-offset-4 hover:text-gray-800 hover:underline">
            Angaben zurücksetzen
          </button>
        </div>
      </form>
    </div>
  )
}
