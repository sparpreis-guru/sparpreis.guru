"use client"

import { AlertTriangle, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, CircleX, Loader2 } from "lucide-react"
import { getDaySearchFailure } from "@/lib/search/search-errors"
import { Button } from "@/components/ui/button"
import { useState, useEffect } from "react"
import { SearchProgressPanel } from "@/components/search/search-progress-panel"
import { useSearchQueueStatus } from "@/hooks/use-search-queue-status"
import { createPriceBandScale, PRICE_BAND_STYLES } from "@/lib/train-search/price-bands"
import { addDaysToDateKey, getEarliestSearchDateKey, getBerlinDateKey } from "@/lib/shared/berlin-date"
import { getEligibleDateKeys, parseSearchWeekdays } from "@/lib/search/return-search-feasibility"
import { formatCompactPrice, formatPrice } from "@/lib/shared/format-price"
import { estimateUncachedSearchRequests } from "@/lib/search/search-workload"
import { flexpreisCellAmount, flexpreisStatusLabel, type FlexpreisStatus, type FlexpreisDayData, type FlexpreisComparison } from "@/lib/search/flexpreis-comparison"
import { FlexpreisBasisSelector } from "./flexpreis-basis-selector"

/** A received discovery result is not a completed Flexpreis query. */
export function getCalendarDayLoadingPhase({
  hasResult, flexpreisStatus, isFlexpreisView, isStreaming, isExpectedDay,
  isLazyLoading, showLazyLoading,
}: {
  hasResult: boolean
  flexpreisStatus?: FlexpreisStatus
  isFlexpreisView: boolean
  isStreaming: boolean
  isExpectedDay: boolean
  isLazyLoading: boolean
  showLazyLoading: boolean
}): "discovery" | "flexpreis" | null {
  const isActive = (isStreaming && isExpectedDay) || isLazyLoading
  if (isActive && isFlexpreisView && flexpreisStatus === "pending") return "flexpreis"
  if (!hasResult && ((isStreaming && isExpectedDay) || (isLazyLoading && showLazyLoading))) return "discovery"
  return null
}

const LAZY_LOADING_INDICATOR_DELAY_MS = 150

function useDelayedLoadingIndicator(active: boolean, requestKey: string) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(false)
    if (!active) return

    const timer = window.setTimeout(() => {
      setVisible(true)
    }, LAZY_LOADING_INDICATOR_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [active, requestKey])

  return active && visible
}

interface IntervalData {
  preis: number
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl?: number
  isCheapestPerInterval?: boolean
}

interface PriceData {
  flexpreis?: FlexpreisDayData
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  allIntervals?: IntervalData[]
}

interface PriceResults {
  [date: string]: PriceData
}

// Im Flexpreis-Modus bestimmt der Tagestarif Anzeige, Farbskala und
// Bestpreis-Markierung. Tage ohne ermittelten Flexpreis gelten als Tage ohne
// Preis, damit nie ein Sparpreis als Flexpreis erscheint.
function applyFlexpreis(results: PriceResults, basisId?: string): PriceResults {
  const mapped: PriceResults = {}
  for (const [date, data] of Object.entries(results)) {
    mapped[date] = date === "_meta" ? data : { ...data, preis: flexpreisCellAmount(data.flexpreis, basisId) ?? 0 }
  }
  return mapped
}

interface PriceCalendarProps {
  autoScrollOnSearchStart?: boolean
  isFlexBasisLoading?: boolean
  flexComparison?: FlexpreisComparison
  onFlexBasisChange?: (id: string) => void
  results: PriceResults
  onDayClick: (date: string, data: PriceData) => void
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams?: any
  isStreaming?: boolean
  expectedDays?: number
  sessionId?: string | null
  onCancelSearch?: () => void
  onRestartSearch?: () => void
  searchWasCancelled?: boolean
  selectedDay?: string
  lazyDayRequest?: {
    date: string
    status: "loading" | "complete" | "error"
    message?: string
  } | null
  onRequestDay?: (date: string) => void
  canRequestAdditionalDays?: boolean
  tarif?: string
}

// Wochentage so anpassen, dass Montag links steht
const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
const months = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
]

export function PriceCalendar({
  autoScrollOnSearchStart = true,
  isFlexBasisLoading = false,
  results: rawResults,
  onDayClick,
  startStation,
  zielStation,
  searchParams,
  isStreaming = false,
  expectedDays,
  sessionId,
  onCancelSearch,
  onRestartSearch,
  searchWasCancelled,
  selectedDay,
  lazyDayRequest,
  onRequestDay,
  canRequestAdditionalDays = false,
  tarif,
  flexComparison,
  onFlexBasisChange,
}: PriceCalendarProps) {
  const isFlexpreis = tarif === "FLEXPREIS"
  // Standardansicht je nach Modus: Im Preisvergleich ("Spar- & Flexpreise")
  // beginnt der Kalender mit dem Flexpreis, in der reinen Sparpreis-Suche mit
  // dem Sparpreis. Der Umschalter bleibt für manuelle Wechsel erhalten.
  const [priceView, setPriceView] = useState<"sparpreis" | "flexpreis">(isFlexpreis ? "flexpreis" : "sparpreis")
  const priceModeKey = JSON.stringify(searchParams)
  useEffect(() => {
    // Jede neue Suche startet mit der passenden Standardansicht. Eine laufende
    // Nutzerwahl wird erst beim nächsten Suchlauf überschrieben.
    setPriceView(isFlexpreis ? "flexpreis" : "sparpreis")
  }, [priceModeKey, isFlexpreis])
  const results = isFlexpreis && priceView === "flexpreis" ? applyFlexpreis(rawResults, flexComparison?.basis?.id) : rawResults
  const lazyDayRequestKey = lazyDayRequest?.date || ""
  const showLazyDayLoadingIndicator = useDelayedLoadingIndicator(
    lazyDayRequest?.status === "loading",
    lazyDayRequestKey
  )
  const resultDates = Object.keys(results).filter(key => key !== '_meta').sort()
  const tomorrow = getEarliestSearchDateKey()
  const originalStartDate = searchParams?.reisezeitraumAb || resultDates[0] || tomorrow
  const originalEndDate = searchParams?.reisezeitraumBis || resultDates[resultDates.length - 1] || originalStartDate
  const earliestRequestableDate = [addDaysToDateKey(originalStartDate, -14), tomorrow].sort().at(-1)!
  const latestRequestableDate = addDaysToDateKey(originalEndDate, 14)
  const earliestRequestableDateObject = new Date(`${earliestRequestableDate}T12:00:00`)
  const latestRequestableDateObject = new Date(`${latestRequestableDate}T12:00:00`)
  const earliestRequestableMonth = new Date(
    earliestRequestableDateObject.getFullYear(),
    earliestRequestableDateObject.getMonth(),
    1
  )
  const latestRequestableMonth = new Date(
    latestRequestableDateObject.getFullYear(),
    latestRequestableDateObject.getMonth(),
    1
  )
  
  // Hilfsfunktion: Date zu YYYY-MM-DD (lokal, nicht UTC!)
  const formatDateKey = (date: Date) => {
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  
  // Get the date range from results or expected range
  const dates = Object.keys(results).filter(key => key !== '_meta').sort()
  
  // Der vollständige Suchbereich bleibt auch nach Abschluss oder Abbruch erhalten,
  // damit noch nicht abgefragte Tage gezielt nachgeladen werden können.
  const getExpectedDateRange = () => {
    // Berechne erwartete Daten aus Wochentagen und Datumsbereich
    if (searchParams?.reisezeitraumAb && searchParams?.reisezeitraumBis) {
      return getEligibleDateKeys(
        searchParams.reisezeitraumAb,
        searchParams.reisezeitraumBis,
        parseSearchWeekdays(searchParams.wochentage)
      ).slice(0, 30)
    }
    
    return dates
  }
  
  const expectedDateRange = getExpectedDateRange()
  const firstExpectedDate = expectedDateRange.length > 0 ? new Date(expectedDateRange[0]) : (dates.length > 0 ? new Date(dates[0]) : new Date())

  const firstDate = expectedDateRange.length > 0
    ? firstExpectedDate
    : dates.length > 0
      ? new Date(dates[0])
      : new Date()

  // State for calendar navigation
  const [currentMonth, setCurrentMonth] = useState(() => new Date())

  useEffect(() => {
    if (firstDate) {
      setCurrentMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1))
    }
  }, [firstDate.getFullYear(), firstDate.getMonth()])

  useEffect(() => {
    if (!selectedDay) return
    const selectedDate = new Date(selectedDay)
    setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
  }, [selectedDay])

  const prices = Object.values(results)
    .map((r) => r.preis)
    .filter((p) => p > 0)

  const hasFlexPriceResult = Object.values(rawResults).some(
    (result) => Boolean(flexpreisCellAmount(result.flexpreis, flexComparison?.basis?.id))
  )
  const allFlexPricesUnavailable = isFlexpreis && priceView === "flexpreis" && !isStreaming && resultDates.length > 0 && !hasFlexPriceResult
  const hasUnavailableFlexPrices = isFlexpreis && priceView === "flexpreis" && resultDates.some((dateKey) => {
    const result = rawResults[dateKey]
    return Boolean(
      result &&
      result.preis > 0 &&
      !flexpreisCellAmount(result.flexpreis, flexComparison?.basis?.id)
    )
  })
  const activePriceLabel = priceView === "flexpreis" ? "Flexpreis der Vergleichsverbindung" : "Bestpreis"
  const activeBindingLabel = priceView === "flexpreis" ? "ohne Zugbindung" : "gefundener Ticketpreis"
  const selectedClassLabel = searchParams?.klasse === "KLASSE_1" ? "1. Klasse" : "2. Klasse"
  const selectedAgeLabel = {
    KIND: "Kind",
    JUGENDLICHER: "Jugendlicher",
    ERWACHSENER: "Erwachsener",
    SENIOR: "Senior",
  }[searchParams?.alter as string] || "Reisender"
  const selectedDiscountLabel = searchParams?.ermaessigungArt === "BAHNCARD25"
    ? "BahnCard 25"
    : searchParams?.ermaessigungArt === "BAHNCARD50"
      ? "BahnCard 50"
      : "keine BahnCard"

  const priceScale = createPriceBandScale(prices)
  const minPrice = priceScale.min
  const maxPrice = priceScale.max

  // Generate calendar days for current month
  const generateCalendarDays = () => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    // First day of the month
    const firstDayOfMonth = new Date(year, month, 1)
    // Last day of the month
    const lastDayOfMonth = new Date(year, month + 1, 0)

    // Start from the first Monday of the week containing the first day
    const startDate = new Date(firstDayOfMonth)
    const dayOfWeek = (startDate.getDay() + 6) % 7 // Montag=0, Sonntag=6
    startDate.setDate(startDate.getDate() - dayOfWeek)

    // End at the last Sunday of the week containing the last day
    const endDate = new Date(lastDayOfMonth)
    const endDayOfWeek = (endDate.getDay() + 6) % 7
    endDate.setDate(endDate.getDate() + (6 - endDayOfWeek))

    const days = []
    const current = new Date(startDate)

    while (current <= endDate) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }

    return days
  }

  const calendarDays = generateCalendarDays()

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const getPriceColor = (price: number) => {
    if (price === 0) return "text-gray-400"
    return PRICE_BAND_STYLES[priceScale.getBand(price)].text
  }

  const getPriceBg = (price: number) => {
    if (price === 0) return "bg-gray-50"
    const style = PRICE_BAND_STYLES[priceScale.getBand(price)]
    return `${style.background} ${style.border} ${style.emphasis}`
  }

  const handleDayClick = (dateKey: string, priceData: PriceData | undefined) => {
    if (rawResults[dateKey]) {
      // Bewusst der unveränderte Eintrag: die Tagesansicht listet die
      // Sparpreise der einzelnen Verbindungen.
      onDayClick(dateKey, rawResults[dateKey])
    }
  }

  const totalDays = expectedDays && expectedDays > 0
    ? expectedDays
    : expectedDateRange.length > 0
      ? expectedDateRange.length
      : (searchParams?.dayLimit ? parseInt(searchParams.dayLimit) : resultDates.length)
  const completedDays = expectedDateRange.filter(date => {
    const result = rawResults[date]
    return isFlexpreis ? Boolean(result?.flexpreis && result.flexpreis.status !== "pending") : result?.preis !== undefined
  }).length
  const isCompleteNow = totalDays > 0 && completedDays >= totalDays
  const queueStatus = useSearchQueueStatus({
    sessionId,
    isActive: Boolean(isStreaming),
    remainingRateLimitedRequests: estimateUncachedSearchRequests(
      Math.max(0, totalDays - completedDays),
      isFlexpreis ? "FLEXPREIS" : "SPARPREIS"
    ),
    searchType: "bestpreissuche",
  })

  if (dates.length === 0 && expectedDateRange.length === 0) return null

  return (
    <>
      <SearchProgressPanel
        autoScrollOnStart={autoScrollOnSearchStart}
        isActive={Boolean(isStreaming)}
        completedItems={completedDays}
        totalItems={totalDays}
        queueStatus={queueStatus}
        progressUnit="Reisetagen"
        completedUnit="Reisetage"
        isCancelled={searchWasCancelled}
        onCancel={onCancelSearch}
        onRestart={onRestartSearch}
      />

      {/* Calendar Header und Legende */}
      <div className="mt-4 overflow-hidden border-y border-gray-200 bg-white sm:rounded-lg sm:border sm:shadow-sm">
        {startStation && zielStation && (
          <header className="flex flex-wrap items-start justify-between gap-x-2 gap-y-3 border-b border-blue-100 bg-blue-50/70 px-4 py-4 sm:flex-nowrap sm:items-center sm:gap-3 sm:px-5">
            <div className="min-w-[9rem] flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Einfache Fahrt</div>
              <h2 className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-base text-blue-950 sm:flex-nowrap sm:text-lg">
                <span className="min-w-0 truncate font-bold">{startStation.name}</span>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-600" aria-hidden="true">
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 truncate font-bold">{zielStation.name}</span>
              </h2>
              <p className="mt-1 text-xs text-blue-700">{resultDates.length} Reisetage ausgewertet</p>
            </div>
            <div
                className={`w-max shrink-0 self-start rounded-lg border px-2 py-1.5 sm:self-center sm:px-4 sm:py-2 sm:text-right ${
                minPrice > 0
                  ? "border-green-200 bg-green-50 shadow-sm"
                  : allFlexPricesUnavailable
                    ? "border-amber-200 bg-amber-50"
                    : "border-blue-100 bg-white/60"
              }`}
            >
              {minPrice > 0 ? (
                <>
                  <div className="whitespace-nowrap text-[10px] font-medium leading-3 text-green-700 sm:text-xs sm:leading-4">
                    {priceView === "flexpreis" ? "Niedrigster Vergleichspreis" : "Günstigster Bestpreis"}
                  </div>
                  <div className="mt-0.5 flex min-w-0 flex-nowrap items-baseline gap-x-1 text-green-800 sm:justify-end">
                    {priceView !== "flexpreis" && <span className="text-xs font-semibold sm:text-sm">ab</span>}
                    <span className="shrink-0 whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl">
                      {formatPrice(minPrice)}
                    </span>
                  </div>
                </>
              ) : allFlexPricesUnavailable ? (
                <>
                  <div className="text-[10px] font-semibold text-amber-700 sm:text-xs">Kein Vergleichspreis</div>
                  <div className="mt-1 text-xs leading-4 text-gray-600">Bestpreise bleiben auswählbar.</div>
                </>
              ) : (
                <>
                  <span className="sr-only">Günstigster Preis wird ermittelt</span>
                  <div className="h-3 w-20 rounded bg-blue-100 sm:ml-auto sm:w-24" aria-hidden="true" />
                  <div className="mt-2 flex items-center gap-1 sm:justify-end" aria-hidden="true">
                    <div className="h-3 w-4 rounded bg-blue-100" />
                    <div className="h-6 w-20 rounded bg-blue-100 sm:h-7" />
                  </div>
                </>
              )}
            </div>
          </header>
        )}
        <div className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-blue-950">
              <CalendarDays className="h-4 w-4 text-blue-700" />
              Preiskalender
            </h2>
            <span className="text-right text-xs font-medium text-blue-700 sm:hidden">
              {priceView === "flexpreis" ? "Flexpreis-Vergleich" : "Bestpreise"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="hidden text-xs font-medium text-blue-700 sm:inline">
              {priceView === "flexpreis" ? "Flexpreis-Vergleich" : "Bestpreise"}
            </span>
            {isFlexpreis && (
              <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label="Preisansicht wählen">
                <button
                  type="button"
                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors sm:px-3 ${
                    priceView === "sparpreis" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                  aria-pressed={priceView === "sparpreis"}
                  onClick={() => setPriceView("sparpreis")}
                >
                    Bestpreis
                </button>
                <button
                  type="button"
                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors sm:px-3 ${
                    priceView === "flexpreis" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                  aria-pressed={priceView === "flexpreis"}
                  onClick={() => setPriceView("flexpreis")}
                >
                  Flexpreis
                </button>
              </div>
            )}
          </div>
        </div>
        {isFlexpreis && priceView === "flexpreis" && (
          <FlexpreisBasisSelector comparison={flexComparison} isLoading={isStreaming || isFlexBasisLoading} onChange={onFlexBasisChange} />
        )}
        {/* Calendar Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousMonth}
            disabled={currentMonth.getTime() <= earliestRequestableMonth.getTime()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <h3 className="text-lg font-semibold">
            {months[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h3>

          <Button
            variant="outline"
            size="sm"
            onClick={goToNextMonth}
            disabled={currentMonth.getTime() >= latestRequestableMonth.getTime()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b bg-gray-50 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs sm:gap-3">
            {priceScale.activeBands.length > 0 ? (
              priceScale.activeBands.map((band) => {
                const style = PRICE_BAND_STYLES[band]
                return (
                  <span
                    key={band}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-medium ${band === "best" ? "min-w-[7.5rem] justify-center" : ""} ${style.background} ${style.border} ${style.text}`}
                  >
                    {style.label}
                    {band === "best" && ` ${formatPrice(minPrice)}`}
                    {band === "high" && ` bis ${formatPrice(maxPrice)}`}
                  </span>
                )
              })
            ) : (
              <span className="inline-flex h-6 w-[7.5rem] items-center justify-center gap-1.5 rounded border border-gray-200 bg-white" aria-hidden="true">
                <span className="h-2.5 w-14 rounded bg-gray-200" />
                <span className="h-2.5 w-10 rounded bg-gray-200" />
              </span>
            )}
            {priceScale.activeBands.length === 0 && <span className="sr-only">Preislegende wird ermittelt</span>}
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="p-4">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekdays.map((day) => (
              <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const dateKey = formatDateKey(day)
              const rawPriceData = rawResults[dateKey]
              const priceData = results[dateKey]
              // Preis der aktuell gewählten Ansicht (Sparpreis oder Flexpreis).
              // Die separate Konstante vermeidet Non-Null-Assertions und macht
              // die Zustände im Kalender eindeutig.
              const cellPrice = priceData?.preis ?? 0
              const isCurrentMonth = day.getMonth() === currentMonth.getMonth()
              const isToday = dateKey === getBerlinDateKey()
              const hasSparPrice = Boolean(rawPriceData && rawPriceData.preis > 0)
              const hasFlexPrice = Boolean(flexpreisCellAmount(rawPriceData?.flexpreis, flexComparison?.basis?.id))
              const hasPrice = cellPrice > 0
              const dayFailure = hasPrice ? null : getDaySearchFailure(rawPriceData)
              const flexPriceUnavailable = isFlexpreis && priceView === "flexpreis" && Boolean(rawPriceData?.flexpreis) && !hasFlexPrice
              const hasResult = !!priceData
              const hasMultipleOptions = priceData?.allIntervals && priceData.allIntervals.length > 1
              
              // Check if this day is expected but not yet loaded (pending)
              const isExpectedDay = expectedDateRange.includes(dateKey)
              const isRequestableDay = dateKey >= earliestRequestableDate && dateKey <= latestRequestableDate
              const isLazyPending = lazyDayRequest?.date === dateKey && lazyDayRequest.status === "loading"
              const showLazyPending = isLazyPending && showLazyDayLoadingIndicator
              const lazyRequestFailed = lazyDayRequest?.date === dateKey && lazyDayRequest.status === "error"
              const isInitialPending = Boolean(isStreaming && isExpectedDay && !hasResult)
              const loadingPhase = getCalendarDayLoadingPhase({
                hasResult, flexpreisStatus: rawPriceData?.flexpreis?.status,
                isFlexpreisView: isFlexpreis && priceView === "flexpreis",
                isStreaming, isExpectedDay, isLazyLoading: isLazyPending, showLazyLoading: showLazyPending,
              })
              const isPendingDay = loadingPhase !== null
              const flexStatusText = rawPriceData?.flexpreis?.status === "pending" && !isPendingDay
                ? "Nicht geprüft"
                : flexpreisStatusLabel(rawPriceData?.flexpreis?.status)
              const canRequestDay = canRequestAdditionalDays && isRequestableDay && !hasResult && !isInitialPending && !isLazyPending && Boolean(onRequestDay)
              const showRequestPrompt = canRequestAdditionalDays && isRequestableDay && !hasResult && !isInitialPending && !showLazyPending && Boolean(onRequestDay)
              const canOpenDay = hasPrice || hasSparPrice || (isFlexpreis && Boolean(rawPriceData))
              const isInteractiveDay = canOpenDay || canRequestDay
              const formattedCellDate = day.toLocaleDateString("de-DE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
              const cellAriaLabel = isPendingDay
                ? `${formattedCellDate}: ${loadingPhase === "flexpreis" ? "Flexpreis wird abgefragt" : "Preis wird abgefragt"}`
                : dayFailure
                ? `${formattedCellDate}: ${dayFailure.message}`
                : flexPriceUnavailable
                ? `${formattedCellDate}: ${flexStatusText}`
                : hasPrice && priceView === "flexpreis"
                  ? `${formattedCellDate}: Flexpreis ${formatPrice(cellPrice)}`
                  : hasPrice
                    ? `${formattedCellDate}: Bestpreis ${formatPrice(cellPrice)}`
                    : canRequestDay
                      ? `${formattedCellDate}: Preis abfragen`
                      : formattedCellDate

              return (
                <button
                  type="button"
                  key={dateKey}
                  disabled={!isInteractiveDay}
                  aria-label={cellAriaLabel}
                  title={hasPrice ? formatPrice(cellPrice) : dayFailure?.message}
                  aria-busy={isPendingDay}
                  className={`
                    relative flex h-[90px] min-w-0 w-full flex-col justify-between rounded-lg border px-0.5 py-1 text-left sm:h-[100px] sm:p-3
                    ${!isCurrentMonth ? "opacity-30" : ""}
                    ${isToday ? "ring-2 ring-blue-500" : ""}
                    ${selectedDay === dateKey ? "ring-2 ring-blue-700 ring-offset-2" : ""}
                    ${isPendingDay ? "bg-blue-50 border-blue-200" :
                      hasPrice ? getPriceBg(cellPrice) :
                      flexPriceUnavailable ? "border-gray-200 bg-gray-50" :
                      hasResult ? "bg-gray-50" : 
                      showRequestPrompt ? "border-dashed border-blue-200 bg-white text-blue-700" : "bg-white"}
                    ${canRequestDay ? "cursor-pointer" : ""}
                    ${canOpenDay ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2" : ""}
                    ${!isInteractiveDay ? "cursor-default" : ""}
                  `}
                  onClick={() => {
                    if (canOpenDay) {
                      handleDayClick(dateKey, rawPriceData)
                    } else if (canRequestDay) {
                      onRequestDay?.(dateKey)
                    }
                  }}
                >
                  {/* Day Number und Multiple options indicator */}
                  <div className="mb-1 flex shrink-0 items-center justify-between">
                    <div className="text-xs sm:text-sm font-medium text-gray-900">{day.getDate()}</div>
                    {priceView !== "flexpreis" && hasMultipleOptions && priceData.allIntervals ? (
                      <span className="text-[10px] sm:text-xs bg-blue-100 text-blue-600 px-1 rounded ml-1">{priceData.allIntervals.length}</span>
                    ) : null}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    {isPendingDay ? (
                      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden text-blue-600">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        <span className="text-center text-[10px] font-medium leading-tight sm:text-xs">
                          <span className="sm:hidden">{loadingPhase === "flexpreis" ? "Flex" : "Preis"}</span>
                          <span className="hidden sm:inline">{loadingPhase === "flexpreis" ? "Flexpreis" : "Preis"}<br />wird geprüft</span>
                        </span>
                      </div>
                    ) : hasResult ? (
                      <div className="flex min-h-0 flex-1 flex-col justify-between gap-1">
                        <div>
                          <div className={`text-xs sm:text-sm font-bold ${hasPrice ? getPriceColor(cellPrice) : "text-amber-700"}`}>
                            {cellPrice > 0 && (
                              <>
                                <span className="block whitespace-nowrap text-[11px] tracking-tight tabular-nums sm:text-sm md:hidden">{formatCompactPrice(cellPrice)}</span>
                                <span className="hidden whitespace-nowrap md:block">{formatPrice(cellPrice)}</span>
                              </>
                            )}
                            {flexPriceUnavailable && (
                              <>
                                <span className="block text-[10px] font-medium leading-3.5 text-gray-600 sm:text-xs">
                                  {flexStatusText}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {priceView === "sparpreis" && hasSparPrice && priceData.abfahrtsZeitpunkt && priceData.ankunftsZeitpunkt ? (
                          <div className="pointer-events-none mt-auto flex max-w-full flex-col items-end text-right text-[10px] text-gray-500 sm:text-xs">
                            {/* Mobil: Zwei Zeilen */}
                            <span className="block sm:hidden truncate">
                              {new Date(priceData.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="block sm:hidden truncate">
                              <span className="mx-1">→</span>
                              {new Date(priceData.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {/* Desktop: Eine Zeile */}
                            <span className="hidden sm:inline truncate whitespace-nowrap">
                              {new Date(priceData.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                              <span className="mx-1">→</span>
                              {new Date(priceData.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : showRequestPrompt ? (
                      <span
                        className={`mx-auto my-auto px-0.5 py-1 text-center text-[10px] font-medium ${
                          lazyRequestFailed
                            ? "text-red-700 opacity-80"
                            : "text-blue-700 opacity-50"
                        }`}
                      >
                        <span className="sm:hidden">{lazyRequestFailed ? "Erneut" : "Abfragen"}</span>
                        <span className="hidden sm:inline">{lazyRequestFailed ? "Erneut versuchen" : "Preis abfragen"}</span>
                      </span>
                    ) : null}
                  </div>

                  {/* Indikator für Tage ohne Fahrten: nur für geprüfte Tage */}
                  {hasResult && !isPendingDay && dayFailure && (
                    <div className="absolute bottom-1 right-1 text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Preisabfrage fehlgeschlagen</span>
                    </div>
                  )}
                  {hasResult && !isPendingDay && !dayFailure && !flexPriceUnavailable && cellPrice === 0 && (
                    <div className="absolute bottom-1 right-1 text-gray-400">
                      <CircleX className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Keine Verbindung verfügbar</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-t bg-blue-50 px-4 py-3 text-left text-xs text-blue-800 sm:px-5">
          <p className="text-center font-semibold text-blue-900">
            {activePriceLabel} · {selectedClassLabel} · {activeBindingLabel}
            <span className="font-normal text-blue-700"> ({selectedAgeLabel} · {selectedDiscountLabel})</span>
          </p>
          <p className="mx-auto mt-1 max-w-3xl text-center leading-4">
            {priceView === "flexpreis"
              ? "Preise ausgewählter Verbindungen. Die Streckengültigkeit richtet sich nach dem Ticket."
              : "Der Kalender zeigt pro Reisetag den günstigsten gefundenen Ticketpreis für deine Suche."}
          </p>
          {hasUnavailableFlexPrices && (
            <p className="mx-auto mt-1 max-w-3xl text-center leading-4 text-blue-800">
              Für einzelne Tage fehlt ein passender Vergleichstreffer. Details findest du beim jeweiligen Tag.
            </p>
          )}
        </div>

      </div>

    </>
  )
}
