"use client"

import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState, useEffect } from "react"
import { logWarn } from "@/lib/shared/logger"
import { SearchProgressPanel } from "@/components/search/search-progress-panel"
import { useSearchQueueStatus } from "@/hooks/use-search-queue-status"
import { createPriceBandScale, PRICE_BAND_STYLES } from "@/lib/train-search/price-bands"
import { addDaysToDateKey, getEarliestSearchDateKey } from "@/lib/shared/berlin-date"

const LOG_SCOPE = "bestpreissuche.price-calendar"
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
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  allIntervals?: IntervalData[]
}

interface PriceResults {
  [date: string]: PriceData
}

interface PriceCalendarProps {
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
  results,
  onDayClick,
  startStation,
  zielStation,
  searchParams,
  isStreaming,
  expectedDays,
  sessionId,
  onCancelSearch,
  onRestartSearch,
  searchWasCancelled,
  selectedDay,
  lazyDayRequest,
  onRequestDay,
  canRequestAdditionalDays = false,
}: PriceCalendarProps) {
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
      try {
        // Parse weekdays from readable format or default to all days
        let weekdays: number[]
        if (searchParams.wochentage) {
          const decoded = decodeURIComponent(searchParams.wochentage)
          if (decoded.startsWith('[')) {
            // Old JSON format
            weekdays = JSON.parse(decoded)
          } else {
            // New readable format: "1,2,3,4,5"
            weekdays = decoded.split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 6)
          }
        } else {
          // No weekdays param = all days
          weekdays = [1, 2, 3, 4, 5, 6, 0]
        }
        
        const startDate = new Date(searchParams.reisezeitraumAb)
        const endDate = new Date(searchParams.reisezeitraumBis)
        const expectedDates: string[] = []
        
        for (let d = new Date(startDate); d <= endDate && expectedDates.length < 30; d.setDate(d.getDate() + 1)) {
          if (weekdays.includes(d.getDay())) {
            expectedDates.push(formatDateKey(d))
          }
        }
        
        return expectedDates.sort()
      } catch (error) {
        logWarn(LOG_SCOPE, "Could not calculate expected dates from weekdays", {
          fromDate: searchParams?.reisezeitraumAb,
          toDate: searchParams?.reisezeitraumBis,
          weekdays: searchParams?.wochentage,
          error: error instanceof Error ? error.message : error,
        })
      }
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
    if (priceData && priceData.preis > 0) {
      onDayClick(dateKey, priceData)
    }
  }

  const totalDays = expectedDays && expectedDays > 0
    ? expectedDays
    : expectedDateRange.length > 0
      ? expectedDateRange.length
      : (searchParams?.dayLimit ? parseInt(searchParams.dayLimit) : resultDates.length)
  const completedDays = expectedDateRange.length > 0
    ? expectedDateRange.filter(date => results[date]?.preis !== undefined).length
    : Math.min(totalDays, Object.values(results).filter(r => r && r.preis !== undefined).length)
  const isCompleteNow = totalDays > 0 && completedDays >= totalDays
  const queueStatus = useSearchQueueStatus({
    sessionId,
    isActive: Boolean(isStreaming && !isCompleteNow),
    remainingRequests: Math.max(0, totalDays - completedDays),
    searchType: "bestpreissuche",
  })

  if (dates.length === 0 && expectedDateRange.length === 0) return null

  return (
    <>
      <SearchProgressPanel
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
          <header className="flex items-start justify-between gap-2 border-b border-blue-100 bg-blue-50/70 px-4 py-4 sm:items-center sm:gap-3 sm:px-5">
            <div className="min-w-0 flex-1">
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
              className={`w-[7.5rem] shrink-0 self-start rounded-lg border px-2 py-1.5 sm:w-40 sm:self-center sm:px-4 sm:py-2 sm:text-right ${
                minPrice > 0
                  ? "border-green-200 bg-green-50 shadow-sm"
                  : "border-blue-100 bg-white/60"
              }`}
            >
              {minPrice > 0 ? (
                <>
                  <div className="text-[10px] font-medium text-green-700 sm:text-xs">Günstigster Preis</div>
                  <div className="mt-0.5 flex items-baseline gap-1 text-green-800 sm:justify-end">
                    <span className="text-xs font-semibold sm:text-sm">ab</span>
                    <span className="text-xl font-bold tabular-nums sm:text-2xl">
                      {minPrice.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                    </span>
                  </div>
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
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-blue-950">
            <CalendarDays className="h-4 w-4 text-blue-700" />
            Preiskalender
          </h2>
          <span className="text-xs font-medium text-blue-700">Tag für Verbindungen auswählen</span>
        </div>
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
                    {band === "best" && ` ${minPrice} €`}
                    {band === "high" && ` bis ${maxPrice} €`}
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
              const priceData = results[dateKey]
              const isCurrentMonth = day.getMonth() === currentMonth.getMonth()
              const isToday = dateKey === new Date().toISOString().split("T")[0]
              const hasPrice = priceData && priceData.preis > 0
              const hasResult = !!priceData
              const hasMultipleOptions = priceData?.allIntervals && priceData.allIntervals.length > 1
              
              // Check if this day is expected but not yet loaded (pending)
              const isExpectedDay = expectedDateRange.includes(dateKey)
              const isRequestableDay = dateKey >= earliestRequestableDate && dateKey <= latestRequestableDate
              const isLazyPending = lazyDayRequest?.date === dateKey && lazyDayRequest.status === "loading"
              const showLazyPending = isLazyPending && showLazyDayLoadingIndicator
              const lazyRequestFailed = lazyDayRequest?.date === dateKey && lazyDayRequest.status === "error"
              const isInitialPending = Boolean(isStreaming && isExpectedDay && !hasResult)
              const isPendingDay = isInitialPending || showLazyPending
              const canRequestDay = canRequestAdditionalDays && isRequestableDay && !hasResult && !isInitialPending && !isLazyPending && Boolean(onRequestDay)
              const showRequestPrompt = canRequestAdditionalDays && isRequestableDay && !hasResult && !isInitialPending && !showLazyPending && Boolean(onRequestDay)

              return (
                <div
                  key={dateKey}
                  className={`
                    relative h-[90px] sm:h-[100px] p-1 sm:p-3 border rounded-lg transition-all hover:shadow-sm flex flex-col justify-between
                    ${!isCurrentMonth ? "opacity-30" : ""}
                    ${isToday ? "ring-2 ring-blue-500" : ""}
                    ${selectedDay === dateKey ? "ring-2 ring-blue-700 ring-offset-2" : ""}
                    ${hasPrice ? getPriceBg(priceData.preis) : 
                      hasResult ? "bg-gray-50" : 
                      isPendingDay ? "bg-blue-50 border-blue-200" :
                      showRequestPrompt ? "border-dashed border-blue-200 bg-white text-blue-700" : "bg-white"}
                    ${canRequestDay ? "cursor-pointer hover:border-blue-300 hover:bg-blue-50/60" : ""}
                    ${hasPrice ? "cursor-pointer hover:shadow-md hover:scale-105" : ""}
                  `}
                  onClick={() => {
                    if (hasPrice) {
                      handleDayClick(dateKey, priceData)
                    } else if (canRequestDay) {
                      onRequestDay?.(dateKey)
                    }
                  }}
                >
                  {/* Day Number und Multiple options indicator */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs sm:text-sm font-medium text-gray-900">{day.getDate()}</div>
                    {hasMultipleOptions && (
                      <span className="text-[10px] sm:text-xs bg-blue-100 text-blue-600 px-1 rounded ml-1">{priceData.allIntervals!.length}</span>
                    )}
                  </div>

                  {/* Price nur anzeigen, wenn Ergebnis vorhanden */}
                  {hasResult && (
                    <div className="space-y-1 flex flex-col h-full justify-between pb-5">
                      <div>
                        <div className={`text-xs sm:text-sm font-bold ${getPriceColor(priceData.preis)}`}> 
                          {priceData.preis > 0 && (
                            <>
                              <span className="block sm:hidden">{Math.round(priceData.preis)}€</span>
                              <span className="hidden sm:block">{priceData.preis}€</span>
                            </>
                          )}
                        </div>
                        {/* Price indicators */}
                        {priceData.preis > 0 && (
                          <div className="text-[10px] sm:text-xs">
                            {priceData.preis === minPrice && <span>🏆</span>}
                            {priceData.preis === maxPrice && priceScale.getBand(priceData.preis) === "high" && <span>💸</span>}
                          </div>
                        )}
                      </div>
                      {/* Departure time immer unten, absolut positioniert */}
                      {priceData.preis > 0 && priceData.abfahrtsZeitpunkt && priceData.ankunftsZeitpunkt && (
                        <div className="absolute left-1 right-1 bottom-1 text-[10px] sm:text-xs text-gray-500 text-right pointer-events-none max-w-full flex flex-col items-end">
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
                      )}
                    </div>
                  )}
                  
                  {/* Pending indicator for days being searched */}
                  {isPendingDay && (
                    <div className="flex flex-col items-center justify-center h-full text-blue-600">
                      <Loader2 className="mb-1 h-4 w-4 animate-spin" />
                      <div className="text-[9px] sm:text-xs font-medium text-center max-w-full sm:max-w-none truncate whitespace-pre-line">
                        <span className="block sm:hidden">Wird<br/>abgefragt</span>
                        <span className="hidden sm:inline">Wird abgefragt</span>
                      </div>
                    </div>
                  )}

                  {showRequestPrompt && (
                    <button
                      type="button"
                      disabled={!canRequestDay}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (canRequestDay) onRequestDay?.(dateKey)
                      }}
                      className={`mx-auto my-auto px-0.5 py-1 text-center text-[9px] font-medium transition-opacity sm:text-[10px] ${
                        lazyRequestFailed
                          ? "text-red-700 opacity-80 hover:opacity-100"
                          : "text-blue-700 opacity-50 hover:opacity-100"
                      }`}
                      title={lazyRequestFailed ? lazyDayRequest?.message || "Preisabfrage erneut versuchen" : `Preis für den ${dateKey} abfragen`}
                    >
                      <span className="sm:hidden">{lazyRequestFailed ? "Erneut" : "Abfragen"}</span>
                      <span className="hidden sm:inline">{lazyRequestFailed ? "Erneut versuchen" : "Preis abfragen"}</span>
                    </button>
                  )}

                  {/* Click indicator for bookable days entfernt */}
                  {/* Indikator für Tage ohne Fahrten: nur für geprüfte Tage */}
                  {hasResult && priceData?.preis === 0 && (
                    <div className="absolute bottom-1 right-1">
                      <span className="text-gray-400 text-xs select-none">❌</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t bg-gray-50 p-4 text-center text-xs text-gray-600">
          {canRequestAdditionalDays
            ? "Wähle einen Tag mit Preis oder frage einen ungeladenen Tag bis zu zwei Wochen vor oder nach dem Suchzeitraum ab"
            : isStreaming
              ? "Weitere Tage können abgefragt werden, sobald die ursprüngliche Suche vollständig geladen ist."
              : "Weitere Tage können erst nach einer vollständig abgeschlossenen Suche abgefragt werden."}
        </div>
      </div>

    </>
  )
}
