"use client"

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Euro,
  GripVertical,
  Loader2,
  RotateCcw,
  Shuffle,
  Table2,
  Train,
  TrendingUp,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { calculateDuration, createBookingLink, getDurationMinutes } from "@/lib/train-search/day-details-utils"
import { ConnectionsTable } from "./day-connections-table"
import { DayDetailsPanel } from "./day-details-panel"
import { PriceHistoryChart, type PriceHistoryEntry } from "./price-history-chart"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchProgressPanel } from "@/components/search/search-progress-panel"
import {
  JourneyBookingButton,
  JourneyBookingButtonGroup,
  JourneyDisclosureButton,
  JourneyResultActionBar,
  RoundTripJourneyDetails,
  RoundTripJourneySummary,
  RoundTripJourneySummaryPlaceholder,
} from "@/components/search/journey-result"
import { JourneySortControls } from "@/components/search/journey-sort-controls"
import { getFeasibleReturnSearchDates } from "@/lib/search/return-search-feasibility"
import { useSearchQueueStatus } from "@/hooks/use-search-queue-status"
import {
  createPriceBandScale,
  getPriceBandClasses,
  PRICE_BAND_STYLES,
  type PriceBand,
} from "@/lib/train-search/price-bands"

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

export interface TravelCombination {
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

export interface LazyCombinationRequestState {
  outwardDate: string
  returnDate: string
  status: "loading" | "complete" | "error"
  message?: string
}

type CombinationSortKey = "outward" | "return" | "nights" | "duration" | "transfers" | "price"

interface TravelCombinationsProps {
  combinations: TravelCombination[]
  outwardResults: PriceResults
  returnResults: PriceResults
  expectedOutwardDays: number
  expectedReturnDays: number
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams: any
  isStreaming?: boolean
  sessionId?: string | null
  onCancelSearch?: () => void
  onRestartSearch?: () => void
  searchWasCancelled?: boolean
  lazyCombinationRequest?: LazyCombinationRequestState | null
  onRequestCombination?: (outwardDate: string, returnDate: string) => void | Promise<void>
  onResolveLazyCombination?: () => void
  isFullMatrixLoading?: boolean
  fullMatrixLoadError?: string | null
  onRequestFullMatrix?: (outwardDates: string[], returnDates: string[]) => void | Promise<void>
  onResetFullMatrix?: () => void
}

interface PriceData {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  priceHistory?: PriceHistoryEntry[]
  allIntervals?: Array<{
    preis: number
    abfahrtsZeitpunkt: string
    ankunftsZeitpunkt: string
    abfahrtsOrt?: string
    ankunftsOrt?: string
    info?: string
    umstiegsAnzahl?: number
    isCheapestPerInterval?: boolean
    priceHistory?: PriceHistoryEntry[]
    abschnitte?: JourneyLeg[]
  }>
}

const LAZY_LOADING_INDICATOR_DELAY_MS = 150
const PINNED_COMBINATION_TRANSITION_MS = 550

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

interface PriceResults {
  [date: string]: PriceData
}

function normalizeDayDetailsData(
  data: PriceData | undefined,
  fromName: string,
  toName: string
) {
  if (!data) return null

  const intervals = data.allIntervals?.length
    ? data.allIntervals
    : data.preis > 0
      ? [{
          preis: data.preis,
          abfahrtsZeitpunkt: data.abfahrtsZeitpunkt,
          ankunftsZeitpunkt: data.ankunftsZeitpunkt,
          abfahrtsOrt: fromName,
          ankunftsOrt: toName,
          info: data.info,
          umstiegsAnzahl: 0,
          isCheapestPerInterval: true,
          priceHistory: data.priceHistory,
        }]
      : []

  return {
    preis: data.preis,
    info: data.info,
    abfahrtsZeitpunkt: data.abfahrtsZeitpunkt,
    ankunftsZeitpunkt: data.ankunftsZeitpunkt,
    priceHistory: data.priceHistory,
    allIntervals: intervals.map((interval) => ({
      preis: interval.preis,
      abfahrtsZeitpunkt: interval.abfahrtsZeitpunkt,
      ankunftsZeitpunkt: interval.ankunftsZeitpunkt,
      abfahrtsOrt: interval.abfahrtsOrt || fromName,
      ankunftsOrt: interval.ankunftsOrt || toName,
      info: interval.info || data.info || "",
      umstiegsAnzahl: interval.umstiegsAnzahl,
      isCheapestPerInterval: interval.isCheapestPerInterval,
      priceHistory: interval.priceHistory,
      abschnitte: interval.abschnitte,
    })),
  }
}

function getJourneyPriceHistory(
  result: PriceData | undefined,
  departure: string,
  arrival: string
) {
  const matchingInterval = result?.allIntervals?.find(
    (interval) => interval.abfahrtsZeitpunkt === departure && interval.ankunftsZeitpunkt === arrival
  )
  const history = matchingInterval?.priceHistory || (
    result?.abfahrtsZeitpunkt === departure && result?.ankunftsZeitpunkt === arrival
      ? result.priceHistory
      : undefined
  )

  return history && history.length > 1 ? history : undefined
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  })
}

function formatFullDate(value?: string) {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function formatTime(value: string) {
  if (!value) return "--:--"
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

function formatPrice(value: number) {
  return `${value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`
}

function formatNightCount(value: number) {
  return `${value} ${value === 1 ? "Nacht" : "Nächte"}`
}

function isSameCombination(left?: TravelCombination | null, right?: TravelCombination | null) {
  return Boolean(
    left &&
    right &&
    left.outwardDate === right.outwardDate &&
    left.returnDate === right.returnDate
  )
}

function getCombinationKey(outwardDate: string, returnDate: string) {
  return `${outwardDate}::${returnDate}`
}

function generateDateKeys(from?: string, to?: string, weekdaysParam?: string, limit = 30) {
  if (!from || !to) return []

  let weekdays = [1, 2, 3, 4, 5, 6, 0]
  if (weekdaysParam) {
    try {
      const decoded = decodeURIComponent(weekdaysParam)
      weekdays = decoded.startsWith("[")
        ? JSON.parse(decoded)
        : decoded.split(",").map(Number).filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6)
    } catch {}
  }

  const dates: string[] = []
  const start = new Date(from)
  const end = new Date(to)
  for (let d = new Date(start); d <= end && dates.length < limit; d.setDate(d.getDate() + 1)) {
    if (weekdays.includes(d.getDay())) {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, "0")
      const day = String(d.getDate()).padStart(2, "0")
      dates.push(`${year}-${month}-${day}`)
    }
  }
  return dates
}


function parsePositiveInt(value: unknown, fallback?: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getDisplayInterval(data: PriceData) {
  const intervals = Array.isArray(data.allIntervals) ? data.allIntervals : []
  return (
    intervals.find((interval) =>
      interval.preis === data.preis &&
      interval.abfahrtsZeitpunkt &&
      interval.ankunftsZeitpunkt
    ) ||
    intervals.find((interval) => interval.abfahrtsZeitpunkt && interval.ankunftsZeitpunkt)
  )
}

function getJourneyTimes(data: PriceData) {
  const displayInterval = getDisplayInterval(data)
  const legs = Array.isArray(displayInterval?.abschnitte) ? displayInterval.abschnitte : []

  return {
    departure: data.abfahrtsZeitpunkt || displayInterval?.abfahrtsZeitpunkt || legs[0]?.abfahrtsZeitpunkt || "",
    arrival: data.ankunftsZeitpunkt || displayInterval?.ankunftsZeitpunkt || legs[legs.length - 1]?.ankunftsZeitpunkt || "",
    transfers: displayInterval?.umstiegsAnzahl || 0,
    legs,
  }
}

function dayOffsetPercent(date: string, from?: string, to?: string) {
  if (!from || !to) return 0
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  const current = new Date(date).getTime()
  const span = Math.max(1, end - start)
  return Math.min(100, Math.max(0, ((current - start) / span) * 100))
}

function getNights(outwardDate: string, returnDate: string) {
  return Math.round((new Date(returnDate).getTime() - new Date(outwardDate).getTime()) / 86_400_000)
}

function getMatrixDateAxes(outwardDates: string[], returnDates: string[]) {
  return {
    outwardDates: outwardDates.filter((outwardDate) =>
      returnDates.some((returnDate) => getNights(outwardDate, returnDate) >= 1)
    ),
    returnDates: returnDates.filter((returnDate) =>
      outwardDates.some((outwardDate) => getNights(outwardDate, returnDate) >= 1)
    ),
  }
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatMonthTitle(date: Date) {
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" })
}

function generateCalendarDaysForMonth(monthDate: Date) {
  const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const lastDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
  const startDate = new Date(firstDayOfMonth)
  const startOffset = (startDate.getDay() + 6) % 7
  startDate.setDate(startDate.getDate() - startOffset)

  const endDate = new Date(lastDayOfMonth)
  const endOffset = (endDate.getDay() + 6) % 7
  endDate.setDate(endDate.getDate() + (6 - endOffset))

  const days: Date[] = []
  for (const day = new Date(startDate); day <= endDate; day.setDate(day.getDate() + 1)) {
    days.push(new Date(day))
  }
  return days
}

function getCalendarMonths(dateKeys: string[]) {
  const monthKeys = Array.from(new Set(dateKeys.map((date) => date.slice(0, 7)))).sort()
  return monthKeys.map((key) => {
    const [year, month] = key.split("-").map(Number)
    return new Date(year, month - 1, 1)
  })
}

function getBestReturnForOutward({
  outwardDate,
  returnDates,
  outwardResults,
  returnResults,
  minNights,
  maxNights,
}: {
  outwardDate: string
  returnDates: string[]
  outwardResults: PriceResults
  returnResults: PriceResults
  minNights: number
  maxNights?: number
}) {
  const outward = outwardResults[outwardDate]
  if (!outward || outward.preis <= 0) return null

  return returnDates
    .flatMap((returnDate) => {
      const returning = returnResults[returnDate]
      const nights = getNights(outwardDate, returnDate)
      if (
        !returning ||
        returning.preis <= 0 ||
        nights < minNights ||
        (typeof maxNights === "number" && nights > maxNights)
      ) return []

      return [{
        outwardDate,
        returnDate,
        nights,
        total: Math.round((outward.preis + returning.preis) * 100) / 100,
        outwardPrice: outward.preis,
        returnPrice: returning.preis,
      }]
    })
    .sort((a, b) => a.total - b.total || a.nights - b.nights)[0] || null
}


function ComboMatrix({
  outwardDates,
  returnDates,
  outwardResults,
  returnResults,
  minNights,
  maxNights,
  isStreaming,
  lazyCombinationRequest,
  revealedCombinationKeys,
  isFullMatrixLoading,
  fullMatrixLoadError,
  selectedCombination,
  onSelectCombination,
  onRequestAllPrices,
  onResetMatrix,
  focused = false,
}: {
  outwardDates: string[]
  returnDates: string[]
  outwardResults: PriceResults
  returnResults: PriceResults
  minNights: number
  maxNights?: number
  isStreaming?: boolean
  lazyCombinationRequest?: LazyCombinationRequestState | null
  revealedCombinationKeys?: ReadonlySet<string>
  isFullMatrixLoading?: boolean
  fullMatrixLoadError?: string | null
  selectedCombination?: TravelCombination | null
  onSelectCombination: (outwardDate: string, returnDate: string) => void
  onRequestAllPrices?: () => void
  onResetMatrix?: () => void
  focused?: boolean
}) {
  const lazyRequestKey = lazyCombinationRequest
    ? `${lazyCombinationRequest.outwardDate}|${lazyCombinationRequest.returnDate}`
    : ""
  const showLazyRequestIndicator = useDelayedLoadingIndicator(
    lazyCombinationRequest?.status === "loading",
    lazyRequestKey
  )
  const {
    outwardDates: matrixOutwardDates,
    returnDates: matrixReturnDates,
  } = getMatrixDateAxes(outwardDates, returnDates)
  const validCells = matrixOutwardDates.flatMap((outwardDate) =>
    matrixReturnDates.flatMap((returnDate) => {
      const outward = outwardResults[outwardDate]
      const returning = returnResults[returnDate]
      const nights = getNights(outwardDate, returnDate)
      if (
        !outward ||
        !returning ||
        outward.preis <= 0 ||
        returning.preis <= 0 ||
        nights < minNights ||
        (typeof maxNights === "number" && nights > maxNights)
      ) return []
      return [{
        outwardDate,
        returnDate,
        nights,
        total: Math.round((outward.preis + returning.preis) * 100) / 100,
      }]
    })
  )
  const prices = validCells.map((cell) => cell.total)
  const priceScale = createPriceBandScale(prices)

  const getCellTone = (price: number) => {
    return getPriceBandClasses(priceScale.getBand(price))
  }

  return (
    <div className={cn(
      "bg-white",
      focused
        ? "flex h-full min-h-0 flex-col rounded-lg border border-gray-200 p-2 sm:p-3"
        : "rounded-lg border border-gray-200 p-2 sm:p-3"
    )}>
      <div className={cn(
        "space-y-3",
        "mb-3",
        focused && "shrink-0"
      )}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="text-base font-semibold text-gray-900">Preismatrix</h3>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto">
            {onRequestAllPrices && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-blue-200 bg-white text-xs text-blue-700 hover:bg-blue-50"
                onClick={onRequestAllPrices}
                disabled={isStreaming || isFullMatrixLoading}
              >
                {isFullMatrixLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Table2 className="h-3.5 w-3.5" />}
                Alle Preise ohne Nächtefilter abfragen
              </Button>
            )}
            {onResetMatrix && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                onClick={onResetMatrix}
                disabled={isFullMatrixLoading || !revealedCombinationKeys?.size}
                title="Zusätzlich aufgedeckte Matrixpreise wieder ausblenden"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Zurücksetzen
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="shrink-0 text-xs font-medium text-gray-700">
            Aufenthalt: mindestens {formatNightCount(minNights)}{typeof maxNights === "number" ? `, maximal ${formatNightCount(maxNights)}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Preislegende">
            {priceScale.activeBands.map((band) => {
              const style = PRICE_BAND_STYLES[band]
              return (
                <span key={band} className={cn("inline-flex shrink-0 items-center rounded border px-2 py-1", style.background, style.border, style.text)}>
                  {style.label}
                </span>
              )
            })}
            <span className="relative inline-flex shrink-0 items-center overflow-hidden rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 after:absolute after:right-0 after:top-0 after:border-l-[6px] after:border-t-[6px] after:border-l-transparent after:border-t-slate-500 after:content-['']">
              Außerhalb Filter
            </span>
          </div>
        </div>
      </div>

      {fullMatrixLoadError && (
        <div className={cn("mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800", focused && "shrink-0")} role="alert">
          {fullMatrixLoadError}
        </div>
      )}

      <div
        data-matrix-scroll-container
        className={cn(
          "relative isolate bg-white",
          focused
            ? "min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200"
            : "max-h-[36rem] overflow-auto rounded-lg border border-gray-200"
        )}
      >
        <div
          className="grid min-w-max gap-1 [--matrix-label-width:4.5rem] sm:[--matrix-label-width:5.5rem]"
          style={{ gridTemplateColumns: `var(--matrix-label-width) repeat(${matrixOutwardDates.length}, minmax(4.5rem, 1fr))` }}
        >
          <div className="sticky left-0 top-0 z-50 flex flex-col border-b border-r border-gray-200 bg-white p-1 text-[9px] font-semibold leading-tight text-gray-500 shadow-sm before:absolute before:-right-1 before:top-0 before:h-full before:w-1 before:bg-white before:content-[''] after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:bg-white after:content-['']">
            <span className="self-end">Hin →</span>
            <span>Rück ↓</span>
          </div>
          {matrixOutwardDates.map((date) => (
            <div key={date} className="sticky top-0 z-40 border-b border-r border-blue-100 bg-blue-50 px-1 py-1 text-center text-[11px] font-semibold text-blue-800 shadow-sm after:absolute after:-bottom-1 after:left-0 after:h-1 after:w-full after:bg-white after:content-[''] sm:px-2">
              <div>Hin</div>
              <div>{formatDate(date)}</div>
            </div>
          ))}

          {matrixReturnDates.map((returnDate) => (
            <div key={returnDate} className="contents">
              <div className="sticky left-0 z-30 border-b border-r border-gray-200 bg-gray-100 px-1 py-2 text-[11px] font-semibold text-gray-700 shadow-sm after:absolute after:-right-1 after:top-0 after:h-full after:w-1 after:bg-white after:content-[''] sm:px-2">
                <div>Rück</div>
                <div>{formatDate(returnDate)}</div>
              </div>
              {matrixOutwardDates.map((outwardDate) => {
                const outward = outwardResults[outwardDate]
                const returning = returnResults[returnDate]
                const nights = getNights(outwardDate, returnDate)
                const combinationKey = getCombinationKey(outwardDate, returnDate)
                const isInvalidDuration =
                  nights < minNights ||
                  (typeof maxNights === "number" && nights > maxNights)
                const isChronological = nights >= 1
                const isOutsideStayFilter = isChronological && isInvalidDuration
                const outwardLoaded = Object.prototype.hasOwnProperty.call(outwardResults, outwardDate)
                const returnLoaded = Object.prototype.hasOwnProperty.call(returnResults, returnDate)
                const hasKnownPrices = outward?.preis > 0 && returning?.preis > 0
                const isRevealed = revealedCombinationKeys?.has(combinationKey) ?? false
                const showPrice =
                  hasKnownPrices &&
                  isChronological &&
                  (!isOutsideStayFilter || isRevealed)
                const hasKnownUnavailableDirection =
                  (outwardLoaded && (!outward || outward.preis <= 0)) ||
                  (returnLoaded && (!returning || returning.preis <= 0))
                const canRequestPrice =
                  isChronological &&
                  !hasKnownUnavailableDirection &&
                  (!outwardLoaded || !returnLoaded || (isOutsideStayFilter && !isRevealed))
                const total = hasKnownPrices
                  ? Math.round((outward.preis + returning.preis) * 100) / 100
                  : 0
                const isSelected =
                  selectedCombination?.outwardDate === outwardDate &&
                  selectedCombination?.returnDate === returnDate
                const isInitialPending =
                  isStreaming &&
                  isChronological &&
                  !isOutsideStayFilter &&
                  (!outwardLoaded || !returnLoaded)
                const isLazyRequestPending =
                  lazyCombinationRequest?.status === "loading" &&
                  lazyCombinationRequest.outwardDate === outwardDate &&
                  lazyCombinationRequest.returnDate === returnDate
                const showLazyPending = isLazyRequestPending && showLazyRequestIndicator && !showPrice
                const isFullMatrixPending =
                  Boolean(isFullMatrixLoading) &&
                  isChronological &&
                  !hasKnownUnavailableDirection &&
                  (!outwardLoaded || !returnLoaded)
                const canTriggerRequest = canRequestPrice && !isInitialPending && !isLazyRequestPending && !isFullMatrixLoading
                const showRequestPrompt = canTriggerRequest || (isLazyRequestPending && !showLazyRequestIndicator)

                if (!isChronological) {
                  return <div key={`${outwardDate}-${returnDate}`} className="min-h-14" aria-hidden="true" />
                }

                return (
                  <button
                    type="button"
                    key={`${outwardDate}-${returnDate}`}
                    disabled={!showPrice && !canTriggerRequest}
                    data-selected-combination={isSelected ? "true" : undefined}
                    title={
                      isOutsideStayFilter
                        ? showPrice ? "Außerhalb des Filters" : "Außerhalb des Filters: Preis abfragen"
                        : undefined
                    }
                    onClick={() => {
                      if (showPrice || canTriggerRequest) {
                        onSelectCombination(outwardDate, returnDate)
                      }
                    }}
                    className={cn(
                      "group relative z-0 min-h-14 rounded-md border px-1 py-1 text-center text-xs transition sm:px-2",
                      showPrice && getCellTone(total),
                      showPrice && "cursor-pointer hover:shadow-sm",
                      showPrice && isOutsideStayFilter && "overflow-hidden !border-slate-300 after:absolute after:right-0 after:top-0 after:border-l-[8px] after:border-t-[8px] after:border-l-transparent after:border-t-slate-500 after:content-['']",
                      (isInitialPending || showLazyPending || isFullMatrixPending) && "border-blue-100 bg-blue-50 text-blue-700",
                      showRequestPrompt && !isOutsideStayFilter && "cursor-pointer border-dashed border-blue-200 bg-white text-blue-700 hover:border-blue-300 hover:bg-blue-50",
                      showRequestPrompt && isOutsideStayFilter && "cursor-pointer border-transparent bg-transparent text-blue-700 hover:border-blue-200 hover:bg-blue-50/60 focus-visible:border-blue-300 focus-visible:bg-blue-50/60",
                      !showPrice && !isInitialPending && !showLazyPending && !isFullMatrixPending && !showRequestPrompt && (
                        isOutsideStayFilter
                          ? "border-transparent bg-transparent text-gray-200"
                          : "border-gray-100 bg-gray-50 text-gray-300"
                      ),
                      isSelected && "ring-2 ring-inset ring-blue-600"
                    )}
                  >
                    {showPrice ? (
                      <>
                        <div className="font-bold">{total}€</div>
                        <div className="mt-0.5 text-[10px] opacity-80">{nights} {nights === 1 ? "Nacht" : "Nächte"}</div>
                      </>
                    ) : isInitialPending || showLazyPending || isFullMatrixPending ? (
                      <div className="flex h-full items-center justify-center gap-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      </div>
                    ) : showRequestPrompt ? (
                      <span className={cn(
                        "text-[11px] font-medium transition-opacity sm:text-[10px]",
                        isOutsideStayFilter && "opacity-60 group-hover:opacity-100 group-focus-visible:opacity-100"
                      )}>
                        Preis abfragen
                      </span>
                    ) : (
                      <span>-</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CombinationSearchTimeline({
  combination,
  searchStart,
  searchEnd,
  outwardDates,
  returnDates,
  isStreaming,
  pendingSelection,
  onSelectCombination,
}: {
  combination: TravelCombination
  searchStart: string
  searchEnd: string
  outwardDates: string[]
  returnDates: string[]
  isStreaming?: boolean
  pendingSelection?: { outwardDate: string; returnDate: string } | null
  onSelectCombination: (outwardDate: string, returnDate: string, focusResult?: boolean) => void
}) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<"outward" | "return" | null>(null)
  const [draftSelection, setDraftSelection] = useState<{ outwardDate: string; returnDate: string } | null>(null)
  const displayedOutwardDate = draftSelection?.outwardDate || pendingSelection?.outwardDate || combination.outwardDate
  const displayedReturnDate = draftSelection?.returnDate || pendingSelection?.returnDate || combination.returnDate

  useEffect(() => {
    if (!draftSelection) return
    const settledSelection = pendingSelection || combination
    if (
      settledSelection.outwardDate === draftSelection.outwardDate &&
      settledSelection.returnDate === draftSelection.returnDate
    ) {
      setDraftSelection(null)
    }
  }, [combination, draftSelection, pendingSelection])
  const normalizedStart = searchStart || combination.outwardDate
  const normalizedEnd = searchEnd || combination.returnDate
  const totalDays = Math.max(1, getNights(normalizedStart, normalizedEnd))
  const outwardOffset = Math.max(0, Math.min(totalDays, getNights(normalizedStart, displayedOutwardDate)))
  const returnOffset = Math.max(0, Math.min(totalDays, getNights(normalizedStart, displayedReturnDate)))
  const outwardPosition = (outwardOffset / totalDays) * 100
  const returnPosition = (returnOffset / totalDays) * 100
  const selectedWidth = Math.max(0, returnPosition - outwardPosition)
  const centerPosition = outwardPosition + selectedWidth / 2
  const closeMarkers = selectedWidth < 20
  const ticks = Array.from({ length: totalDays + 1 }, (_, index) => index)
  const dayWidth = 100 / totalDays
  const timelineDays = ticks.map((offset) => {
    const date = new Date(`${normalizedStart}T12:00:00`)
    date.setDate(date.getDate() + offset)
    const position = (offset / totalDays) * 100
    return {
      offset,
      dayOfWeek: date.getDay(),
      weekday: date.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", ""),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      left: Math.max(0, position - dayWidth / 2),
      right: Math.min(100, position + dayWidth / 2),
      position,
    }
  })
  const selectableOutwardDates = outwardDates.filter((date) => getNights(date, displayedReturnDate) >= 1)
  const selectableReturnDates = returnDates.filter((date) => getNights(displayedOutwardDate, date) >= 1)

  const markerAlignment = (position: number) => {
    if (position <= 0) return "translate-x-0"
    if (position >= 100) return "-translate-x-full"
    return "-translate-x-1/2"
  }

  const selectClosestDate = (
    direction: "outward" | "return",
    clientX: number,
    focusResult = false
  ) => {
    const timeline = timelineRef.current
    if (!timeline) return

    const rect = timeline.getBoundingClientRect()
    const pointerPosition = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
    const targetOffset = pointerPosition * totalDays
    const selectableDates = direction === "outward" ? selectableOutwardDates : selectableReturnDates
    if (selectableDates.length === 0) return

    const closestDate = selectableDates.reduce((closest, candidate) => {
      const closestDistance = Math.abs(getNights(normalizedStart, closest) - targetOffset)
      const candidateDistance = Math.abs(getNights(normalizedStart, candidate) - targetOffset)
      return candidateDistance < closestDistance ? candidate : closest
    })

    const outwardDate = direction === "outward" ? closestDate : displayedOutwardDate
    const returnDate = direction === "return" ? closestDate : displayedReturnDate
    setDraftSelection({ outwardDate, returnDate })
    if (focusResult) {
      onSelectCombination(outwardDate, returnDate, focusResult)
    }
  }

  const handlePointerDown = (
    direction: "outward" | "return",
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(direction)
    selectClosestDate(direction, event.clientX)
  }

  const handlePointerMove = (
    direction: "outward" | "return",
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.preventDefault()
    selectClosestDate(direction, event.clientX)
  }

  const handlePointerEnd = (
    direction: "outward" | "return",
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    selectClosestDate(direction, event.clientX, true)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(null)
  }

  const handleMarkerKeyDown = (
    direction: "outward" | "return",
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()

    const selectableDates = direction === "outward" ? selectableOutwardDates : selectableReturnDates
    const currentDate = direction === "outward" ? displayedOutwardDate : displayedReturnDate
    const currentIndex = selectableDates.indexOf(currentDate)
    const nextIndex = Math.max(
      0,
      Math.min(selectableDates.length - 1, currentIndex + (event.key === "ArrowRight" ? 1 : -1))
    )
    const nextDate = selectableDates[nextIndex]
    if (!nextDate || nextDate === currentDate) return

    onSelectCombination(
      direction === "outward" ? nextDate : displayedOutwardDate,
      direction === "return" ? nextDate : displayedReturnDate,
      true
    )
  }

  const markerTitle = (direction: "outward" | "return") => {
    const selectableDates = direction === "outward" ? selectableOutwardDates : selectableReturnDates
    if (selectableDates.length > 1) {
      return direction === "outward" ? "Hinfahrt verschieben" : "Rückfahrt verschieben"
    }
    if (isStreaming) return "Weitere Reisetage werden geladen"
    return direction === "outward" ? "Keine weitere Hinfahrt verfügbar" : "Keine weitere Rückfahrt verfügbar"
  }

  return (
    <div className="pt-3">
      <div className="flex justify-end text-xs">
        <div className="flex items-center gap-3 text-blue-700">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 border border-gray-200 bg-gray-100" />
            Wochenende
          </span>
          <span>{totalDays + 1} Reisetage</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:hidden">
        <div>
          <div className="font-medium text-gray-500">Hinfahrt</div>
          <div className="font-semibold text-blue-800">{formatDate(displayedOutwardDate)}</div>
        </div>
        <div className="text-right">
          <div className="font-medium text-gray-500">Rückfahrt</div>
          <div className="font-semibold text-blue-800">{formatDate(displayedReturnDate)}</div>
        </div>
      </div>

      <div ref={timelineRef} className="relative mx-1 mt-1 h-28 select-none sm:mx-2 sm:mt-3 sm:h-32">
        {timelineDays.filter((day) => day.isWeekend).map((day) => (
          <span
            key={`weekend-${day.offset}`}
            className={cn(
              "absolute bottom-10 top-3 bg-gray-100/90 sm:top-8",
              day.dayOfWeek === 6
                ? "rounded-l-md border-y border-l border-gray-200"
                : "rounded-r-md border-y border-r border-gray-200"
            )}
            style={{ left: `${day.left}%`, width: `${day.right - day.left}%` }}
          />
        ))}
        {timelineDays
          .filter((day) => totalDays <= 14 || day.isWeekend || day.dayOfWeek === 1)
          .map((day) => (
            <span
              key={`weekday-${day.offset}`}
              className={cn(
              "absolute top-[2.1rem] z-10 text-[9px] font-medium sm:top-[4.1rem]",
                markerAlignment(day.position),
                day.isWeekend ? "font-bold text-gray-600" : "text-gray-400"
              )}
              style={{ left: `${day.position}%` }}
            >
              {day.weekday}
            </span>
          ))}
        <div className="absolute left-0 right-0 top-5 h-1 rounded bg-blue-100 sm:top-12" />
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute top-4 h-3 w-px bg-blue-200 sm:top-11"
            style={{ left: `${(tick / totalDays) * 100}%` }}
          />
        ))}

        <div
          className="absolute top-5 h-1 rounded bg-blue-600 sm:top-12"
          style={{ left: `${outwardPosition}%`, width: `${selectedWidth}%` }}
        />

        <div
          className={cn(
            "absolute hidden whitespace-nowrap text-xs font-semibold text-blue-800 sm:block",
            markerAlignment(outwardPosition)
          )}
          style={{ left: `${outwardPosition}%`, top: 0 }}
        >
          Hin · {formatDate(displayedOutwardDate)}
        </div>
        <button
          type="button"
          aria-label="Hinfahrtsdatum verschieben"
          aria-valuetext={formatDate(displayedOutwardDate)}
          title={markerTitle("outward")}
          onPointerDown={(event) => handlePointerDown("outward", event)}
          onPointerMove={(event) => handlePointerMove("outward", event)}
          onPointerUp={(event) => handlePointerEnd("outward", event)}
          onPointerCancel={(event) => handlePointerEnd("outward", event)}
          onKeyDown={(event) => handleMarkerKeyDown("outward", event)}
          className={cn(
            "absolute top-1 z-20 flex h-8 w-8 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:top-8",
            selectableOutwardDates.length > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default",
            markerAlignment(outwardPosition),
            dragging === "outward" && "z-30"
          )}
          style={{ left: `${outwardPosition}%` }}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-sm transition-transform hover:scale-110">
            <GripVertical className="h-3 w-3" />
          </span>
        </button>

        <div
          className={cn(
            "absolute hidden whitespace-nowrap text-xs font-semibold text-blue-800 sm:block",
            markerAlignment(returnPosition)
          )}
          style={{ left: `${returnPosition}%`, top: closeMarkers ? 20 : 0 }}
        >
          Rück · {formatDate(displayedReturnDate)}
        </div>
        <button
          type="button"
          aria-label="Rückfahrtsdatum verschieben"
          aria-valuetext={formatDate(displayedReturnDate)}
          title={markerTitle("return")}
          onPointerDown={(event) => handlePointerDown("return", event)}
          onPointerMove={(event) => handlePointerMove("return", event)}
          onPointerUp={(event) => handlePointerEnd("return", event)}
          onPointerCancel={(event) => handlePointerEnd("return", event)}
          onKeyDown={(event) => handleMarkerKeyDown("return", event)}
          className={cn(
            "absolute top-1 z-20 flex h-8 w-8 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 sm:top-8",
            selectableReturnDates.length > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default",
            markerAlignment(returnPosition),
            dragging === "return" && "z-30"
          )}
          style={{ left: `${returnPosition}%` }}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-blue-600 bg-white text-blue-700 shadow-sm transition-transform hover:scale-110">
            <GripVertical className="h-3 w-3" />
          </span>
        </button>

        <div
          className="absolute top-[3rem] -translate-x-1/2 whitespace-nowrap text-xs font-bold text-gray-900 sm:top-[4.9rem]"
          style={{ left: `${centerPosition}%` }}
        >
          {formatNightCount(getNights(displayedOutwardDate, displayedReturnDate))}
        </div>

        <div className="absolute bottom-0 left-0 text-left">
          <div className="text-[10px] uppercase text-gray-500">Suchbeginn</div>
          <div className="text-xs font-semibold text-gray-800 sm:text-sm">{formatDate(normalizedStart)}</div>
        </div>
        <div className="absolute bottom-0 right-0 text-right">
          <div className="text-[10px] uppercase text-gray-500">Suchende</div>
          <div className="text-xs font-semibold text-gray-800 sm:text-sm">{formatDate(normalizedEnd)}</div>
        </div>
      </div>
    </div>
  )
}

interface CombinationBadgeState {
  isBestPrice: boolean
  hasShortestTravelTime: boolean
  isDirectCombination: boolean
  outsideStayFilter: boolean
}

function isCombinationOutsideStayFilter(
  combination: TravelCombination,
  minNights: number,
  maxNights?: number
) {
  return combination.nights < minNights ||
    (typeof maxNights === "number" && combination.nights > maxNights)
}

function getCombinationTravelTime(combination: TravelCombination) {
  if (
    !combination.outwardDeparture ||
    !combination.outwardArrival ||
    !combination.returnDeparture ||
    !combination.returnArrival
  ) return Number.POSITIVE_INFINITY

  return getDurationMinutes(combination.outwardDeparture, combination.outwardArrival) +
    getDurationMinutes(combination.returnDeparture, combination.returnArrival)
}

function getCombinationBadgeState({
  combination,
  bestPrice,
  shortestTravelTime,
  minNights,
  maxNights,
}: {
  combination: TravelCombination
  bestPrice: number
  shortestTravelTime: number
  minNights: number
  maxNights?: number
}): CombinationBadgeState {
  const outsideStayFilter = isCombinationOutsideStayFilter(combination, minNights, maxNights)
  const travelTime = getCombinationTravelTime(combination)

  return {
    isBestPrice: !outsideStayFilter && combination.totalPrice === bestPrice,
    hasShortestTravelTime: Number.isFinite(travelTime) && travelTime === shortestTravelTime,
    isDirectCombination: combination.outwardTransfers === 0 && combination.returnTransfers === 0,
    outsideStayFilter,
  }
}

function CombinationBadges({
  state,
  compact = false,
  outsideStayFilterLabel,
  outsideStayFilterDescription,
}: {
  state: CombinationBadgeState
  compact?: boolean
  outsideStayFilterLabel?: string
  outsideStayFilterDescription?: string
}) {
  const spacing = compact ? "whitespace-nowrap px-1.5 text-[10px]" : "whitespace-nowrap px-2 text-[11px]"
  const [stayLabel, filterLabel] = outsideStayFilterLabel?.split(" · ") || []

  return (
    <>
      {state.isBestPrice && (
        <Badge className={cn("inline-flex items-center gap-1 rounded-full border border-green-400 bg-green-50 py-0.5 font-semibold text-green-800 shadow-sm", spacing)}>
          <Euro className="h-3 w-3" />
          Bestpreis
        </Badge>
      )}
      {state.outsideStayFilter && (
        <Badge
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300 bg-amber-100 py-0.5 font-semibold text-amber-900 shadow-none",
            spacing,
            compact && "whitespace-normal text-left leading-tight"
          )}
          title={outsideStayFilterDescription}
          aria-label={outsideStayFilterDescription}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {stayLabel && filterLabel ? (
            <span>
              <span className="whitespace-nowrap">{stayLabel}</span>
              <span className="whitespace-nowrap"> · {filterLabel}</span>
            </span>
          ) : outsideStayFilterLabel || "Außerhalb des Filters"}
        </Badge>
      )}
    </>
  )
}

function CombinationResultListItem({
  combination,
  badgeState,
  priceBand,
  active,
  detailsOpen,
  manuallySelected = false,
  dense = false,
  minNights,
  maxNights,
  startStation,
  zielStation,
  searchParams,
  outwardPriceHistory,
  returnPriceHistory,
  resultRef,
  onSelect,
  onToggleDetails,
  onDismiss,
}: {
  combination: TravelCombination
  badgeState: CombinationBadgeState
  priceBand: PriceBand
  active: boolean
  detailsOpen: boolean
  manuallySelected?: boolean
  dense?: boolean
  minNights: number
  maxNights?: number
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams: any
  outwardPriceHistory?: PriceHistoryEntry[]
  returnPriceHistory?: PriceHistoryEntry[]
  resultRef?: (element: HTMLButtonElement | null) => void
  onSelect: () => void
  onToggleDetails: () => void
  onDismiss?: () => void
}) {
  const [priceHistoryOpen, setPriceHistoryOpen] = useState(false)

  useEffect(() => {
    setPriceHistoryOpen(false)
  }, [
    combination.outwardDate,
    combination.returnDate,
    combination.outwardDeparture,
    combination.returnDeparture,
  ])

  const { isBestPrice, outsideStayFilter } = badgeState
  const outwardLegs = combination.outwardLegs || []
  const returnLegs = combination.returnLegs || []
  const hasJourneyDetails = outwardLegs.length > 0 || returnLegs.length > 0
  const hasPriceHistory = Boolean(outwardPriceHistory?.length || returnPriceHistory?.length)
  const priceStyle = PRICE_BAND_STYLES[priceBand]
  const priceTone = `${priceStyle.background} ${priceStyle.border} ${priceStyle.text} ${priceStyle.emphasis}`
  const filterRangeLabel = typeof maxNights === "number"
    ? minNights === maxNights ? `${minNights}` : `${minNights}–${maxNights}`
    : `ab ${minNights}`
  const outsideStayFilterDescription = outsideStayFilter
    ? `Diese Auswahl hat ${formatNightCount(combination.nights)} und liegt außerhalb des ursprünglichen Filters${typeof maxNights === "number" ? minNights === maxNights ? ` von ${formatNightCount(minNights)}.` : ` von ${minNights} bis ${maxNights} Nächten.` : ` von mindestens ${formatNightCount(minNights)}.`}`
    : undefined
  const outsideStayFilterLabel = outsideStayFilter
    ? `${combination.nights} ${combination.nights === 1 ? "Nacht" : "Nächte"} · Filter ${filterRangeLabel}`
    : undefined
  const journeyDetailsId = `journey-details-${useId()}`

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border shadow-[0_1px_4px_rgba(15,23,42,0.10)] transition",
        isBestPrice ? "border-green-400 bg-green-100/60" : "border-gray-300 bg-white",
        outsideStayFilter && "border-amber-300 bg-amber-50/60",
        active && !manuallySelected && "ring-2 ring-blue-500 ring-offset-1",
        manuallySelected && "border-blue-500"
      )}
    >
      {manuallySelected && (
        <div className={cn("flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800", dense ? "py-1.5" : "py-2 sm:px-4")}>
          <GripVertical className="h-3.5 w-3.5" />
          Über Zeitraumregler ausgewählt
        </div>
      )}
      <div className="relative">
        <button
          ref={resultRef}
          type="button"
          className="pointer-events-none peer absolute inset-0 z-0 w-full text-left focus-visible:outline-none"
          onClick={onSelect}
          aria-pressed={active}
          aria-label="Diese Hin- und Rückfahrt auswählen"
        />
        <div className={cn(
          "relative z-10 cursor-pointer transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-blue-500",
          outsideStayFilter
            ? "hover:bg-amber-50"
            : isBestPrice
              ? "hover:bg-green-100/80"
              : "hover:bg-gray-50"
        )} onClick={onSelect}>
          <RoundTripJourneySummary
            journey={{
              ...combination,
              outwardOrigin: startStation?.name,
              outwardDestination: zielStation?.name,
              returnOrigin: zielStation?.name,
              returnDestination: startStation?.name,
            }}
            mobileBadges={(
            <CombinationBadges
              state={badgeState}
              compact
              outsideStayFilterLabel={outsideStayFilterLabel}
              outsideStayFilterDescription={outsideStayFilterDescription}
            />
            )}
            desktopBadges={(
              <CombinationBadges
                state={badgeState}
                compact={dense}
                outsideStayFilterLabel={outsideStayFilterLabel}
                outsideStayFilterDescription={outsideStayFilterDescription}
              />
            )}
            priceTone={priceTone}
            dense={dense}
            isFastestJourney={badgeState.hasShortestTravelTime}
            onTransfersClick={hasJourneyDetails ? () => {
              setPriceHistoryOpen(false)
              onToggleDetails()
            } : undefined}
            transfersExpanded={detailsOpen}
            transfersControlsId={journeyDetailsId}
          />
        </div>
      </div>

      <JourneyResultActionBar
        dense={dense}
        secondaryColumns={hasJourneyDetails && hasPriceHistory ? 2 : 1}
        bookingActions={(
          <JourneyBookingButtonGroup>
            <DirectionBookingButton
              combination={combination}
              direction="outward"
              startStation={startStation}
              zielStation={zielStation}
              searchParams={searchParams}
            />
            <DirectionBookingButton
              combination={combination}
              direction="return"
              startStation={startStation}
              zielStation={zielStation}
              searchParams={searchParams}
            />
          </JourneyBookingButtonGroup>
        )}
        secondaryActions={(
          <>
          {hasJourneyDetails && (
            <JourneyDisclosureButton
              icon={<Train className="h-3.5 w-3.5" />}
              label="Fahrtverlauf anzeigen"
              expandedLabel="Fahrtverlauf schließen"
              mobileLabel="Fahrtverlauf"
              expanded={detailsOpen}
              onClick={() => {
                setPriceHistoryOpen(false)
                onToggleDetails()
              }}
            />
          )}
          {hasPriceHistory && (
            <JourneyDisclosureButton
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              label="Preisentwicklung anzeigen"
              expandedLabel="Preisentwicklung schließen"
              mobileLabel="Preisentwicklung"
              expanded={priceHistoryOpen}
              onClick={() => {
                if (detailsOpen) onToggleDetails()
                setPriceHistoryOpen((open) => !open)
              }}
            />
          )}
          {onDismiss && (
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={onDismiss}
              aria-label="Verbindungsübersicht schließen"
              title="Verbindungsübersicht schließen"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          </>
        )}
      />

      {detailsOpen && hasJourneyDetails && (
        <RoundTripJourneyDetails journey={combination} id={journeyDetailsId} />
      )}
      {priceHistoryOpen && hasPriceHistory && (
        <RoundTripPriceHistoryDetails
          outwardHistory={outwardPriceHistory}
          returnHistory={returnPriceHistory}
        />
      )}
    </article>
  )
}

function RoundTripPriceHistoryDetails({
  outwardHistory,
  returnHistory,
}: {
  outwardHistory?: PriceHistoryEntry[]
  returnHistory?: PriceHistoryEntry[]
}) {
  return (
    <div className="grid gap-3 border-t border-gray-200 bg-white p-3 sm:p-4 lg:grid-cols-2">
      {outwardHistory && outwardHistory.length > 1 && (
        <PriceHistoryChart history={outwardHistory} title="Preisentwicklung Hinfahrt" />
      )}
      {returnHistory && returnHistory.length > 1 && (
        <PriceHistoryChart history={returnHistory} title="Preisentwicklung Rückfahrt" />
      )}
    </div>
  )
}

function SelectedCombinationListItem({
  combination,
  badgeState,
  priceBand,
  detailsOpen,
  manuallySelected = false,
  dense = false,
  minNights,
  maxNights,
  startStation,
  zielStation,
  searchParams,
  outwardPriceHistory,
  returnPriceHistory,
  lazyCombinationRequest,
  onSelect,
  onToggleDetails,
  onDismiss,
}: {
  combination: TravelCombination
  badgeState: CombinationBadgeState
  priceBand: PriceBand
  detailsOpen: boolean
  manuallySelected?: boolean
  dense?: boolean
  minNights: number
  maxNights?: number
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams: any
  outwardPriceHistory?: PriceHistoryEntry[]
  returnPriceHistory?: PriceHistoryEntry[]
  lazyCombinationRequest?: LazyCombinationRequestState | null
  onSelect: () => void
  onToggleDetails: () => void
  onDismiss?: () => void
}) {
  const lazyRequestKey = lazyCombinationRequest
    ? `${lazyCombinationRequest.outwardDate}|${lazyCombinationRequest.returnDate}`
    : ""
  const showLoadingPlaceholder = useDelayedLoadingIndicator(
    lazyCombinationRequest?.status === "loading",
    lazyRequestKey
  )

  if (
    lazyCombinationRequest?.status === "loading" &&
    (manuallySelected || showLoadingPlaceholder)
  ) {
    return (
      <LazyCombinationListPlaceholder
        request={lazyCombinationRequest}
        dense={dense}
        manuallySelected={manuallySelected}
      />
    )
  }

  if (lazyCombinationRequest?.status === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{lazyCombinationRequest.message || "Die Verbindung konnte nicht geladen werden."}</span>
        </div>
      </div>
    )
  }

  return (
    <CombinationResultListItem
      combination={combination}
      badgeState={badgeState}
      priceBand={priceBand}
      active
      detailsOpen={detailsOpen}
      manuallySelected={manuallySelected}
      dense={dense}
      minNights={minNights}
      maxNights={maxNights}
      startStation={startStation}
      zielStation={zielStation}
      searchParams={searchParams}
      outwardPriceHistory={outwardPriceHistory}
      returnPriceHistory={returnPriceHistory}
      onSelect={onSelect}
      onToggleDetails={onToggleDetails}
      onDismiss={onDismiss}
    />
  )
}

function LazyCombinationListPlaceholder({
  request,
  dense = false,
  manuallySelected = false,
}: {
  request: LazyCombinationRequestState
  dense?: boolean
  manuallySelected?: boolean
}) {
  const nights = getNights(request.outwardDate, request.returnDate)

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border bg-white shadow-sm ring-2",
        manuallySelected
          ? "border-blue-500 ring-0"
          : "border-dashed border-blue-300 ring-blue-500 ring-offset-1"
      )}
      aria-live="polite"
    >
      {manuallySelected && (
        <div className={cn("flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800", dense ? "py-1.5" : "py-2 sm:px-4")}>
          <GripVertical className="h-3.5 w-3.5" />
          Über Zeitraumregler ausgewählt
        </div>
      )}
      <RoundTripJourneySummaryPlaceholder
        outwardDate={request.outwardDate}
        returnDate={request.returnDate}
        nights={nights}
        dense={dense}
        mobileBadge={(
          <Badge className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 shadow-none">
            <Loader2 className="h-3 w-3 animate-spin" />
            Preis wird abgefragt
          </Badge>
        )}
        desktopBadge={(
          <Badge className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 shadow-none">
            <Loader2 className="h-3 w-3 animate-spin" />
            Preis wird abgefragt
          </Badge>
        )}
      />

      <JourneyResultActionBar
        dense={dense}
        secondaryColumns={2}
        bookingActions={(
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <div className="h-8 rounded-md bg-blue-100 sm:w-28" aria-hidden="true" />
            <div className="h-8 rounded-md border border-blue-100 bg-white sm:w-28" aria-hidden="true" />
          </div>
        )}
        secondaryActions={(
          <>
            <div className="h-8 rounded-md border border-gray-200 bg-white sm:h-4 sm:w-28 sm:border-0 sm:bg-gray-100" aria-hidden="true" />
            <div className="h-8 rounded-md border border-gray-200 bg-white sm:h-4 sm:w-28 sm:border-0 sm:bg-gray-100" aria-hidden="true" />
          </>
        )}
      />
    </article>
  )
}

function CombinationComparisonPanel({
  combinations,
  selectedCombination,
  searchStart,
  searchEnd,
  outwardDates,
  returnDates,
  outwardResults,
  returnResults,
  minNights,
  maxNights,
  isStreaming,
  startStation,
  zielStation,
  searchParams,
  lazyCombinationRequest,
  isFullMatrixLoading,
  fullMatrixLoadError,
  onRequestFullMatrix,
  onResetFullMatrix,
  onSelectCombination,
  onSelectTimelineCombination,
}: {
  combinations: TravelCombination[]
  selectedCombination: TravelCombination
  searchStart: string
  searchEnd: string
  outwardDates: string[]
  returnDates: string[]
  outwardResults: PriceResults
  returnResults: PriceResults
  minNights: number
  maxNights?: number
  isStreaming?: boolean
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams: any
  lazyCombinationRequest?: LazyCombinationRequestState | null
  isFullMatrixLoading?: boolean
  fullMatrixLoadError?: string | null
  onRequestFullMatrix?: (outwardDates: string[], returnDates: string[]) => void | Promise<void>
  onResetFullMatrix?: () => void
  onSelectCombination: (outwardDate: string, returnDate: string) => void
  onSelectTimelineCombination: (outwardDate: string, returnDate: string) => void
}) {
  const [combinationSortKey, setCombinationSortKey] = useState<CombinationSortKey>("price")
  const [combinationSortDir, setCombinationSortDir] = useState<"asc" | "desc">("asc")
  const [mobileResultsView, setMobileResultsView] = useState<"list" | "matrix">("list")
  const [dayDetailsDirection, setDayDetailsDirection] = useState<"outward" | "return" | null>(null)
  const [pendingResultFocus, setPendingResultFocus] = useState<string | null>(null)
  const [expandedCombinationKeys, setExpandedCombinationKeys] = useState<Set<string>>(new Set())
  const [revealedMatrixCombinationKeys, setRevealedMatrixCombinationKeys] = useState<Set<string>>(new Set())
  const [pinSelectedCombination, setPinSelectedCombination] = useState(false)
  const [renderPinnedCombination, setRenderPinnedCombination] = useState(false)
  const [showPinnedCombination, setShowPinnedCombination] = useState(false)
  const [pendingTimelineSelection, setPendingTimelineSelection] = useState<{
    outwardDate: string
    returnDate: string
  } | null>(null)
  const combinationResultRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const combinationListRef = useRef<HTMLDivElement>(null)
  const combinationListSectionRef = useRef<HTMLElement>(null)
  const pinnedCombinationFrameRef = useRef<number | null>(null)
  const pinnedCombinationTimerRef = useRef<number | null>(null)
  const outwardDayData = outwardResults[selectedCombination.outwardDate]
  const returnDayData = returnResults[selectedCombination.returnDate]
  const outwardRideCount = outwardDayData?.allIntervals?.length || (outwardDayData?.preis > 0 ? 1 : 0)
  const returnRideCount = returnDayData?.allIntervals?.length || (returnDayData?.preis > 0 ? 1 : 0)
  const showingReturnDay = dayDetailsDirection === "return"
  const dayDetailsDate = dayDetailsDirection
    ? showingReturnDay ? selectedCombination.returnDate : selectedCombination.outwardDate
    : null
  const dayDetailsData = dayDetailsDirection
    ? normalizeDayDetailsData(
        showingReturnDay ? returnDayData : outwardDayData,
        showingReturnDay ? zielStation?.name || "Ziel" : startStation?.name || "Start",
        showingReturnDay ? startStation?.name || "Start" : zielStation?.name || "Ziel"
      )
    : null
  const dayDetailsSearchParams = showingReturnDay
    ? {
        ...searchParams,
        abfahrtAb: searchParams.returnAbfahrtAb,
        abfahrtBis: searchParams.returnAbfahrtBis,
        ankunftAb: searchParams.returnAnkunftAb,
        ankunftBis: searchParams.returnAnkunftBis,
      }
    : searchParams

  const revealMatrixCombination = (outwardDate: string, returnDate: string) => {
    const combinationKey = getCombinationKey(outwardDate, returnDate)
    setRevealedMatrixCombinationKeys((current) => {
      if (current.has(combinationKey)) return current
      const next = new Set(current)
      next.add(combinationKey)
      return next
    })
  }

  useEffect(() => {
    setRevealedMatrixCombinationKeys(new Set())
  }, [searchStart, searchEnd, startStation?.id, zielStation?.id])

  useEffect(() => {
    if (isCombinationOutsideStayFilter(selectedCombination, minNights, maxNights)) {
      revealMatrixCombination(selectedCombination.outwardDate, selectedCombination.returnDate)
    }
  }, [selectedCombination, minNights, maxNights])

  const toggleCombinationDetails = (key: string) => {
    setExpandedCombinationKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const revealPinnedCombination = () => {
    if (pinnedCombinationTimerRef.current !== null) {
      window.clearTimeout(pinnedCombinationTimerRef.current)
      pinnedCombinationTimerRef.current = null
    }
    if (pinnedCombinationFrameRef.current !== null) {
      window.cancelAnimationFrame(pinnedCombinationFrameRef.current)
      pinnedCombinationFrameRef.current = null
    }

    setRenderPinnedCombination(true)
    if (renderPinnedCombination) {
      setShowPinnedCombination(true)
      return
    }

    setShowPinnedCombination(false)
    pinnedCombinationFrameRef.current = window.requestAnimationFrame(() => {
      setShowPinnedCombination(true)
      pinnedCombinationFrameRef.current = null
    })
  }

  const dismissPinnedCombination = () => {
    if (pinnedCombinationFrameRef.current !== null) {
      window.cancelAnimationFrame(pinnedCombinationFrameRef.current)
      pinnedCombinationFrameRef.current = null
    }
    if (pinnedCombinationTimerRef.current !== null) {
      window.clearTimeout(pinnedCombinationTimerRef.current)
    }

    setPinSelectedCombination(false)
    setShowPinnedCombination(false)
    pinnedCombinationTimerRef.current = window.setTimeout(() => {
      setRenderPinnedCombination(false)
      setPendingTimelineSelection(null)
      pinnedCombinationTimerRef.current = null
    }, PINNED_COMBINATION_TRANSITION_MS)
  }

  useEffect(() => () => {
    if (pinnedCombinationFrameRef.current !== null) {
      window.cancelAnimationFrame(pinnedCombinationFrameRef.current)
    }
    if (pinnedCombinationTimerRef.current !== null) {
      window.clearTimeout(pinnedCombinationTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!pendingTimelineSelection) return
    if (
      selectedCombination.outwardDate === pendingTimelineSelection.outwardDate &&
      selectedCombination.returnDate === pendingTimelineSelection.returnDate
    ) {
      setPendingTimelineSelection(null)
    }
  }, [pendingTimelineSelection, selectedCombination])

  useEffect(() => {
    if (!pendingResultFocus) return
    if (getCombinationKey(selectedCombination.outwardDate, selectedCombination.returnDate) !== pendingResultFocus) return

    const animationFrame = window.requestAnimationFrame(() => {
      const result = combinationResultRefs.current.get(pendingResultFocus)
      const list = combinationListRef.current
      if (!result || !list) return

      const card = result.closest<HTMLElement>("article") || result
      const listRect = list.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      const listStyles = window.getComputedStyle(list)
      const listPaddingTop = Number.parseFloat(listStyles.paddingTop) || 0

      list.scrollTo({
        top: Math.max(0, list.scrollTop + cardRect.top - listRect.top - listPaddingTop),
        behavior: "smooth",
      })
      setPendingResultFocus(null)
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [pendingResultFocus, selectedCombination])

  const handleTimelineSelection = (
    outwardDate: string,
    returnDate: string,
    focusResult = false
  ) => {
    if (focusResult) {
      setPinSelectedCombination(true)
      revealPinnedCombination()
      setPendingResultFocus(getCombinationKey(outwardDate, returnDate))
      const hasLoadedCombination =
        (outwardResults[outwardDate]?.preis ?? 0) > 0 &&
        (returnResults[returnDate]?.preis ?? 0) > 0
      setPendingTimelineSelection(
        hasLoadedCombination ? null : { outwardDate, returnDate }
      )
    }
    onSelectTimelineCombination(outwardDate, returnDate)
  }

  const handleMatrixSelection = (outwardDate: string, returnDate: string) => {
    matrixViewportAnchorTopRef.current = inlineMatrixRef.current?.getBoundingClientRect().top ?? null
    revealMatrixCombination(outwardDate, returnDate)
    dismissPinnedCombination()
    onSelectCombination(outwardDate, returnDate)
  }

  const handleRequestAllMatrixPrices = () => {
    const matrixDates = getMatrixDateAxes(outwardDates, returnDates)
    const revealedKeys = new Set(revealedMatrixCombinationKeys)

    for (const outwardDate of matrixDates.outwardDates) {
      for (const returnDate of matrixDates.returnDates) {
        const nights = getNights(outwardDate, returnDate)
        const isOutsideStayFilter =
          nights >= 1 &&
          (nights < minNights || (typeof maxNights === "number" && nights > maxNights))
        if (isOutsideStayFilter) {
          revealedKeys.add(getCombinationKey(outwardDate, returnDate))
        }
      }
    }

    setRevealedMatrixCombinationKeys(revealedKeys)
    void onRequestFullMatrix?.(matrixDates.outwardDates, matrixDates.returnDates)
  }

  const handleResetMatrix = () => {
    setRevealedMatrixCombinationKeys(new Set())
    onResetFullMatrix?.()
  }

  const handleCombinationSort = (key: CombinationSortKey) => {
    if (combinationSortKey === key) {
      setCombinationSortDir((direction) => direction === "asc" ? "desc" : "asc")
      return
    }
    setCombinationSortKey(key)
    setCombinationSortDir("asc")
  }

  const compareCombinations = (left: TravelCombination, right: TravelCombination) => {
    let difference = 0

    switch (combinationSortKey) {
      case "outward":
        difference = new Date(left.outwardDeparture || left.outwardDate).getTime() -
          new Date(right.outwardDeparture || right.outwardDate).getTime()
        break
      case "return":
        difference = new Date(left.returnDeparture || left.returnDate).getTime() -
          new Date(right.returnDeparture || right.returnDate).getTime()
        break
      case "nights":
        difference = left.nights - right.nights
        break
      case "duration":
        difference = getCombinationTravelTime(left) - getCombinationTravelTime(right)
        break
      case "transfers":
        difference = ((left.outwardTransfers ?? 0) + (left.returnTransfers ?? 0)) -
          ((right.outwardTransfers ?? 0) + (right.returnTransfers ?? 0))
        break
      case "price":
        difference = left.totalPrice - right.totalPrice
        break
    }

    if (difference !== 0) {
      return combinationSortDir === "asc" ? difference : -difference
    }
    return left.totalPrice - right.totalPrice || left.nights - right.nights
  }

  const ranked = [...combinations].sort(
    (left, right) => left.totalPrice - right.totalPrice || left.nights - right.nights
  )
  const visibleCombinations = (
    ranked.some((combination) => isSameCombination(combination, selectedCombination))
      ? ranked
      : [...ranked, selectedCombination]
  ).sort(compareCombinations)
  const prices = visibleCombinations.map((combination) => combination.totalPrice)
  const eligiblePrices = visibleCombinations
    .filter((combination) => !isCombinationOutsideStayFilter(combination, minNights, maxNights))
    .map((combination) => combination.totalPrice)
  const priceScale = createPriceBandScale(prices)
  const minPrice = eligiblePrices.length > 0
    ? Math.min(...eligiblePrices)
    : priceScale.min || selectedCombination.totalPrice
  const shortestTotalTravelTime = visibleCombinations.reduce(
    (shortest, combination) => Math.min(shortest, getCombinationTravelTime(combination)),
    Number.POSITIVE_INFINITY
  )
  const selectedBadgeState = getCombinationBadgeState({
    combination: selectedCombination,
    bestPrice: minPrice,
    shortestTravelTime: shortestTotalTravelTime,
    minNights,
    maxNights,
  })
  const [isInlineMatrixFocused, setIsInlineMatrixFocused] = useState(false)
  const [isInlineMatrixCaptured, setIsInlineMatrixCaptured] = useState(false)
  const [showAllCombinations, setShowAllCombinations] = useState(false)
  const inlineMatrixRef = useRef<HTMLDivElement>(null)
  const inlineMatrixViewportRef = useRef<HTMLDivElement>(null)
  const matrixViewportAnchorTopRef = useRef<number | null>(null)
  const matrixAutoSnapDoneRef = useRef(false)
  const lastWindowScrollYRef = useRef(0)
  const shouldOfferExpandedMatrix =
    outwardDates.length > 7 || returnDates.length > 7 || outwardDates.length * returnDates.length > 49
  const sortedAlternativeCombinations = visibleCombinations.filter(
    (combination) => !isSameCombination(combination, selectedCombination)
  )
  const matchingTimelineRequest = pendingTimelineSelection &&
    lazyCombinationRequest?.outwardDate === pendingTimelineSelection.outwardDate &&
    lazyCombinationRequest.returnDate === pendingTimelineSelection.returnDate
      ? lazyCombinationRequest
      : null
  const pinnedTimelineRequest: LazyCombinationRequestState | null = pendingTimelineSelection
    ? matchingTimelineRequest?.status === "error"
      ? matchingTimelineRequest
      : {
          outwardDate: pendingTimelineSelection.outwardDate,
          returnDate: pendingTimelineSelection.returnDate,
          status: "loading",
        }
    : null
  const listedCombinations = showAllCombinations
    ? renderPinnedCombination
      ? sortedAlternativeCombinations
      : visibleCombinations
    : renderPinnedCombination
      ? sortedAlternativeCombinations.slice(0, 4)
      : visibleCombinations.slice(0, 5)
  const displayedCombinationCount = listedCombinations.length + (renderPinnedCombination ? 1 : 0)

  useLayoutEffect(() => {
    const anchorTop = matrixViewportAnchorTopRef.current
    const matrix = inlineMatrixRef.current
    if (anchorTop === null || !matrix) return

    const offset = matrix.getBoundingClientRect().top - anchorTop
    if (Math.abs(offset) > 0.5) {
      window.scrollBy({ top: offset, behavior: "auto" })
    }

    if (!lazyCombinationRequest || lazyCombinationRequest.status === "error") {
      matrixViewportAnchorTopRef.current = null
    }
  })

  useEffect(() => {
    if (lazyCombinationRequest?.status !== "loading") return

    const updateAnchorAfterUserScroll = () => {
      if (matrixViewportAnchorTopRef.current === null) return
      const matrix = inlineMatrixRef.current
      if (matrix) matrixViewportAnchorTopRef.current = matrix.getBoundingClientRect().top
    }

    window.addEventListener("scroll", updateAnchorAfterUserScroll, { passive: true })
    return () => window.removeEventListener("scroll", updateAnchorAfterUserScroll)
  }, [lazyCombinationRequest?.status])

  useEffect(() => {
    setMobileResultsView("list")
    setShowAllCombinations(false)
    setPinSelectedCombination(false)
    setRenderPinnedCombination(false)
    setShowPinnedCombination(false)
    setPendingTimelineSelection(null)
  }, [searchStart, searchEnd, startStation?.id, zielStation?.id])

  useEffect(() => {
    if (mobileResultsView !== "matrix") return

    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const matrixViewport = inlineMatrixViewportRef.current
        const scrollContainer = matrixViewport?.querySelector<HTMLElement>("[data-matrix-scroll-container]")
        const selectedCell = matrixViewport?.querySelector<HTMLElement>('[data-selected-combination="true"]')
        if (!scrollContainer || !selectedCell) return

        const containerRect = scrollContainer.getBoundingClientRect()
        const cellRect = selectedCell.getBoundingClientRect()
        const nextLeft = scrollContainer.scrollLeft + cellRect.left - containerRect.left - (containerRect.width - cellRect.width) / 2
        const nextTop = scrollContainer.scrollTop + cellRect.top - containerRect.top - (containerRect.height - cellRect.height) / 2

        scrollContainer.scrollTo({
          left: Math.max(0, nextLeft),
          top: Math.max(0, nextTop),
          behavior: "auto",
        })
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
    }
  }, [mobileResultsView, selectedCombination.outwardDate, selectedCombination.returnDate])

  useEffect(() => {
    const focusStage = inlineMatrixRef.current
    if (!focusStage || !shouldOfferExpandedMatrix) {
      setIsInlineMatrixFocused(false)
      setIsInlineMatrixCaptured(false)
      return
    }

    const desktopViewport = window.matchMedia("(min-width: 1280px)")
    let animationFrame: number | null = null
    lastWindowScrollYRef.current = window.scrollY

    const updateFocusState = () => {
      animationFrame = null
      if (!desktopViewport.matches) {
        setIsInlineMatrixFocused(false)
        setIsInlineMatrixCaptured(false)
        return
      }

      const bounds = focusStage.getBoundingClientRect()
      const currentScrollY = window.scrollY
      const scrollingDown = currentScrollY > lastWindowScrollYRef.current + 1
      lastWindowScrollYRef.current = currentScrollY
      const focusEntry = window.innerHeight * 0.55
      const captureEntry = window.innerHeight * 0.02

      if (bounds.top > focusEntry) matrixAutoSnapDoneRef.current = false

      setIsInlineMatrixFocused(bounds.top <= focusEntry)
      setIsInlineMatrixCaptured(
        bounds.top <= captureEntry ||
        (matrixAutoSnapDoneRef.current && bounds.top <= focusEntry)
      )

      if (
        scrollingDown &&
        !matrixAutoSnapDoneRef.current &&
        bounds.top <= focusEntry &&
        bounds.top > captureEntry
      ) {
        matrixAutoSnapDoneRef.current = true
        setIsInlineMatrixFocused(true)
        setIsInlineMatrixCaptured(true)
        const matrixBounds = inlineMatrixViewportRef.current?.getBoundingClientRect() || bounds
        window.scrollTo({
          top: Math.max(0, currentScrollY + matrixBounds.top - captureEntry),
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        })
      }
    }

    const scheduleFocusUpdate = () => {
      if (animationFrame !== null) return
      animationFrame = window.requestAnimationFrame(updateFocusState)
    }

    scheduleFocusUpdate()
    desktopViewport.addEventListener("change", scheduleFocusUpdate)
    window.addEventListener("scroll", scheduleFocusUpdate, { passive: true })
    window.addEventListener("resize", scheduleFocusUpdate)

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      desktopViewport.removeEventListener("change", scheduleFocusUpdate)
      window.removeEventListener("scroll", scheduleFocusUpdate)
      window.removeEventListener("resize", scheduleFocusUpdate)
    }
  }, [shouldOfferExpandedMatrix])

  const scrollToMatrix = () => {
    const matrixViewport = inlineMatrixViewportRef.current
    if (!matrixViewport) return

    const targetOffset = window.innerHeight * 0.02
    const bounds = matrixViewport.getBoundingClientRect()
    window.scrollTo({
      top: Math.max(0, window.scrollY + bounds.top - targetOffset),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    })
  }

  const scrollToCombinationList = () => {
    combinationListSectionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    })
  }
  const combinationSortOptions: Array<{ key: CombinationSortKey; label: string }> = [
    { key: "price", label: "Gesamtpreis" },
    { key: "outward", label: "Hinfahrt" },
    { key: "return", label: "Rückfahrt" },
    { key: "nights", label: "Nächte" },
    { key: "duration", label: "Fahrzeit" },
    { key: "transfers", label: "Umstiege" },
  ]
  const activeCombinationSortLabel = combinationSortOptions.find(
    (option) => option.key === combinationSortKey
  )?.label || "Gesamtpreis"

  return (
    <>
    <section className="overflow-hidden border-y border-gray-200 bg-white sm:rounded-lg sm:border sm:shadow-sm">
      <header className="flex items-start justify-between gap-2 border-b border-blue-100 bg-blue-50/70 px-4 py-4 sm:items-center sm:gap-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Hin- und Rückfahrt</div>
          <h2 className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-base text-blue-950 sm:flex-nowrap sm:text-lg">
            <span className="min-w-0 truncate font-bold">{startStation?.name || "Start"}</span>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-600" aria-hidden="true">
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 truncate font-bold">{zielStation?.name || "Ziel"}</span>
          </h2>
          <p className="mt-1 text-xs text-blue-700">
            {visibleCombinations.length} {visibleCombinations.length === 1 ? "Reisekombination" : "Reisekombinationen"}
          </p>
        </div>
        <div className="shrink-0 self-start rounded-lg border border-green-200 bg-green-50 px-2 py-1.5 shadow-sm sm:self-center sm:px-4 sm:py-2 sm:text-right">
          <div className="text-[10px] font-medium text-green-700 sm:text-xs">Günstigster Gesamtpreis</div>
          <div className="mt-0.5 flex items-baseline gap-1 text-green-800 sm:justify-end">
            <span className="text-xs font-semibold sm:text-sm">ab</span>
            <span className="text-xl font-bold tabular-nums sm:text-2xl">{formatPrice(minPrice)}</span>
          </div>
        </div>
      </header>

      <div className="border-b border-blue-100 bg-white p-2 lg:hidden">
        <div className="grid grid-cols-2 rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Ergebnisansicht wählen">
          <button
            id="mobile-combination-list-tab"
            type="button"
            role="tab"
            aria-selected={mobileResultsView === "list"}
            aria-controls="mobile-combination-list-panel"
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
              mobileResultsView === "list"
                ? "bg-white text-blue-800 shadow-sm"
                : "text-gray-600 hover:bg-white/70 hover:text-blue-700"
            )}
            onClick={() => setMobileResultsView("list")}
          >
            <Train className="h-4 w-4" />
            Liste
          </button>
          <button
            id="mobile-combination-matrix-tab"
            type="button"
            role="tab"
            aria-selected={mobileResultsView === "matrix"}
            aria-controls="mobile-combination-matrix-panel"
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
              mobileResultsView === "matrix"
                ? "bg-white text-blue-800 shadow-sm"
                : "text-gray-600 hover:bg-white/70 hover:text-blue-700"
            )}
            onClick={() => setMobileResultsView("matrix")}
          >
            <Table2 className="h-4 w-4" />
            Preismatrix
          </button>
        </div>
      </div>

      <div className={cn(mobileResultsView === "matrix" && "hidden lg:block")}>
      <div className="border-b border-gray-200 px-4 py-3 sm:px-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reisezeitraum</div>
        <div className="mt-0.5 text-sm font-semibold text-gray-900">Hin- und Rückfahrt verschieben</div>
      </div>
      <div className="px-4 pb-1 sm:px-5">
        <CombinationSearchTimeline
          combination={selectedCombination}
          searchStart={searchStart}
          searchEnd={searchEnd}
          outwardDates={outwardDates}
          returnDates={returnDates}
          isStreaming={isStreaming}
          pendingSelection={lazyCombinationRequest}
          onSelectCombination={handleTimelineSelection}
        />
      </div>
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
        <div className="text-xs font-semibold uppercase text-gray-600">Weitere Fahrten an diesen Reisetagen</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="flex min-h-12 items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setDayDetailsDirection("outward")}
            disabled={outwardRideCount === 0}
          >
            <Calendar className="h-4 w-4 shrink-0 text-blue-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-gray-900">Hinfahrt · {formatDate(selectedCombination.outwardDate)}</span>
              <span className="block text-[11px] text-gray-500">{outwardRideCount} {outwardRideCount === 1 ? "Verbindung" : "Verbindungen"} verfügbar</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
          <button
            type="button"
            className="flex min-h-12 items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setDayDetailsDirection("return")}
            disabled={returnRideCount === 0}
          >
            <Calendar className="h-4 w-4 shrink-0 text-blue-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-gray-900">Rückfahrt · {formatDate(selectedCombination.returnDate)}</span>
              <span className="block text-[11px] text-gray-500">{returnRideCount} {returnRideCount === 1 ? "Verbindung" : "Verbindungen"} verfügbar</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        </div>
      </div>
      </div>
    </section>

    <section
      id="mobile-combination-list-panel"
      ref={combinationListSectionRef}
      className={cn(
        "mt-4 scroll-mt-4 overflow-hidden border-y border-gray-200 bg-white sm:rounded-lg sm:border sm:shadow-sm",
        mobileResultsView === "matrix" && "hidden lg:block"
      )}
    >
      <div className="flex flex-col gap-3 border-b border-blue-200 bg-blue-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
            <Train className="h-4 w-4" /> Verbindungen ({displayedCombinationCount} von {visibleCombinations.length})
          </div>
          <div className="mt-0.5 text-xs text-blue-700">
            {renderPinnedCombination
              ? `Slider-Auswahl oben angeheftet · alle weiteren nach ${activeCombinationSortLabel} ${combinationSortDir === "asc" ? "aufsteigend" : "absteigend"} sortiert`
              : `Alle ${visibleCombinations.length} Verbindungen nach ${activeCombinationSortLabel} ${combinationSortDir === "asc" ? "aufsteigend" : "absteigend"} sortiert`}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 text-xs font-medium text-blue-700 lg:w-auto lg:items-end">
          {isStreaming && (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Wird laufend ergänzt
            </span>
          )}
          <JourneySortControls
            options={combinationSortOptions}
            sortKey={combinationSortKey}
            sortDir={combinationSortDir}
            onSort={handleCombinationSort}
            ariaLabel="Reisekombinationen sortieren"
            embedded
            className="w-full lg:w-auto"
          />
        </div>
      </div>

      <div
        ref={combinationListRef}
        className="space-y-3 bg-slate-100/80 p-2.5 sm:p-3"
      >
        {renderPinnedCombination && (
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity,margin] [transition-duration:550ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
              showPinnedCombination
                ? "mb-0 grid-rows-[1fr] opacity-100"
                : "-mb-3 grid-rows-[0fr] opacity-0"
            )}
            aria-hidden={!showPinnedCombination}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                key={pendingTimelineSelection
                  ? `${pendingTimelineSelection.outwardDate}|${pendingTimelineSelection.returnDate}|pending`
                  : `${selectedCombination.outwardDate}|${selectedCombination.returnDate}|complete`}
                className="animate-in fade-in-0 [animation-duration:400ms] ease-out motion-reduce:animate-none"
              >
                <SelectedCombinationListItem
                  combination={selectedCombination}
                  badgeState={selectedBadgeState}
                  priceBand={priceScale.getBand(selectedCombination.totalPrice)}
                  detailsOpen={expandedCombinationKeys.has(getCombinationKey(selectedCombination.outwardDate, selectedCombination.returnDate))}
                  manuallySelected
                  minNights={minNights}
                  maxNights={maxNights}
                  startStation={startStation}
                  zielStation={zielStation}
                  searchParams={searchParams}
                  outwardPriceHistory={getJourneyPriceHistory(
                    outwardResults[selectedCombination.outwardDate],
                    selectedCombination.outwardDeparture,
                    selectedCombination.outwardArrival
                  )}
                  returnPriceHistory={getJourneyPriceHistory(
                    returnResults[selectedCombination.returnDate],
                    selectedCombination.returnDeparture,
                    selectedCombination.returnArrival
                  )}
                  lazyCombinationRequest={pinnedTimelineRequest}
                  onSelect={() => {
                    dismissPinnedCombination()
                    onSelectCombination(selectedCombination.outwardDate, selectedCombination.returnDate)
                  }}
                  onToggleDetails={() => toggleCombinationDetails(getCombinationKey(selectedCombination.outwardDate, selectedCombination.returnDate))}
                />
              </div>
            </div>
          </div>
        )}
        {listedCombinations.map((combination) => {
          const combinationKey = getCombinationKey(combination.outwardDate, combination.returnDate)
          const badgeState = getCombinationBadgeState({
            combination,
            bestPrice: minPrice,
            shortestTravelTime: shortestTotalTravelTime,
            minNights,
            maxNights,
          })

          return (
            <CombinationResultListItem
              key={combinationKey}
              combination={combination}
              badgeState={badgeState}
              priceBand={priceScale.getBand(combination.totalPrice)}
              active={isSameCombination(combination, selectedCombination)}
              detailsOpen={expandedCombinationKeys.has(combinationKey)}
              manuallySelected={false}
              minNights={minNights}
              maxNights={maxNights}
              startStation={startStation}
              zielStation={zielStation}
              searchParams={searchParams}
              outwardPriceHistory={getJourneyPriceHistory(
                outwardResults[combination.outwardDate],
                combination.outwardDeparture,
                combination.outwardArrival
              )}
              returnPriceHistory={getJourneyPriceHistory(
                returnResults[combination.returnDate],
                combination.returnDeparture,
                combination.returnArrival
              )}
              resultRef={(element) => {
                if (element) combinationResultRefs.current.set(combinationKey, element)
                else combinationResultRefs.current.delete(combinationKey)
              }}
              onSelect={() => {
                dismissPinnedCombination()
                onSelectCombination(combination.outwardDate, combination.returnDate)
              }}
              onToggleDetails={() => toggleCombinationDetails(combinationKey)}
            />
          )
        })}
        {(showAllCombinations || visibleCombinations.length > displayedCombinationCount) && (
          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
              onClick={() => setShowAllCombinations((showAll) => !showAll)}
            >
              {showAllCombinations ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showAllCombinations
                ? "Weniger Verbindungen anzeigen"
                : `${visibleCombinations.length - displayedCombinationCount} weitere Verbindungen anzeigen`}
            </Button>
          </div>
        )}
      </div>

    </section>

    <div
        id="mobile-combination-matrix-panel"
        ref={inlineMatrixRef}
        className={cn(
          "relative w-full border-t border-gray-200 pt-4 lg:mt-8 lg:pt-8",
          mobileResultsView === "list" && "hidden lg:block",
          shouldOfferExpandedMatrix && "xl:h-[112dvh]"
        )}
    >
      <button
        type="button"
        className={cn(
          "left-1/2 z-50 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-blue-200 bg-white px-4 py-2 text-xs font-semibold text-blue-700 shadow-md transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:inline-flex",
          isInlineMatrixCaptured
            ? "fixed top-3"
            : "absolute top-0 -translate-y-1/2"
        )}
        onClick={isInlineMatrixCaptured ? scrollToCombinationList : scrollToMatrix}
        aria-label={isInlineMatrixCaptured ? "Zur Ergebnisliste springen" : "Zur Preismatrix springen"}
      >
        {isInlineMatrixCaptured ? (
          <>
            <ArrowUp className="h-4 w-4" />
            Ergebnisliste
          </>
        ) : (
          <>
            <Table2 className="h-4 w-4" />
            Zur Preismatrix
            <ArrowDown className="h-4 w-4" />
          </>
        )}
      </button>
      <div
        ref={inlineMatrixViewportRef}
        className={cn(
          "w-full border-y border-gray-200 bg-gray-50 transition-[width,height,margin-left] duration-500 ease-out sm:rounded-lg sm:border sm:shadow-sm motion-reduce:transition-none",
          shouldOfferExpandedMatrix && "xl:sticky xl:top-[2dvh]",
          isInlineMatrixCaptured && "xl:z-30 xl:flex xl:h-[96dvh] xl:flex-col"
        )}
        style={{
          width: isInlineMatrixFocused ? "98vw" : undefined,
          marginLeft: isInlineMatrixFocused ? "calc(50% - 49vw)" : undefined,
        }}
      >
        <aside className="order-first hidden shrink-0 border-b border-gray-200 bg-gray-50 p-2 lg:block" aria-label="Ausgewählte Verbindung">
          <SelectedCombinationListItem
            combination={selectedCombination}
            badgeState={selectedBadgeState}
            priceBand={priceScale.getBand(selectedCombination.totalPrice)}
            detailsOpen={expandedCombinationKeys.has(getCombinationKey(selectedCombination.outwardDate, selectedCombination.returnDate))}
            manuallySelected={pinSelectedCombination}
            dense
            minNights={minNights}
            maxNights={maxNights}
            startStation={startStation}
            zielStation={zielStation}
            searchParams={searchParams}
            outwardPriceHistory={getJourneyPriceHistory(
              outwardResults[selectedCombination.outwardDate],
              selectedCombination.outwardDeparture,
              selectedCombination.outwardArrival
            )}
            returnPriceHistory={getJourneyPriceHistory(
              returnResults[selectedCombination.returnDate],
              selectedCombination.returnDeparture,
              selectedCombination.returnArrival
            )}
            lazyCombinationRequest={pinSelectedCombination ? pinnedTimelineRequest : lazyCombinationRequest}
            onSelect={() => {
              dismissPinnedCombination()
              onSelectCombination(selectedCombination.outwardDate, selectedCombination.returnDate)
            }}
            onToggleDetails={() => toggleCombinationDetails(getCombinationKey(selectedCombination.outwardDate, selectedCombination.returnDate))}
          />
        </aside>
        <div className={cn(isInlineMatrixCaptured ? "min-h-0 flex-1 p-2" : "p-2 sm:p-3")}>
          <ComboMatrix
          outwardDates={outwardDates}
          returnDates={returnDates}
          outwardResults={outwardResults}
          returnResults={returnResults}
          minNights={minNights}
          maxNights={maxNights}
          isStreaming={isStreaming}
          lazyCombinationRequest={lazyCombinationRequest}
          revealedCombinationKeys={revealedMatrixCombinationKeys}
          isFullMatrixLoading={isFullMatrixLoading}
          fullMatrixLoadError={fullMatrixLoadError}
          selectedCombination={selectedCombination}
          onSelectCombination={handleMatrixSelection}
          onRequestAllPrices={onRequestFullMatrix ? handleRequestAllMatrixPrices : undefined}
          onResetMatrix={handleResetMatrix}
          focused={isInlineMatrixCaptured}
          />
        </div>
        <aside
          className="border-t border-blue-100 bg-blue-50/40 p-2.5 lg:hidden"
          aria-label="Ausgewählte Verbindung"
        >
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            Ausgewählte Verbindung
          </div>
          <SelectedCombinationListItem
            combination={selectedCombination}
            badgeState={selectedBadgeState}
            priceBand={priceScale.getBand(selectedCombination.totalPrice)}
            detailsOpen={expandedCombinationKeys.has(getCombinationKey(selectedCombination.outwardDate, selectedCombination.returnDate))}
            manuallySelected={pinSelectedCombination}
            dense
            minNights={minNights}
            maxNights={maxNights}
            startStation={startStation}
            zielStation={zielStation}
            searchParams={searchParams}
            outwardPriceHistory={getJourneyPriceHistory(
              outwardResults[selectedCombination.outwardDate],
              selectedCombination.outwardDeparture,
              selectedCombination.outwardArrival
            )}
            returnPriceHistory={getJourneyPriceHistory(
              returnResults[selectedCombination.returnDate],
              selectedCombination.returnDeparture,
              selectedCombination.returnArrival
            )}
            lazyCombinationRequest={pinSelectedCombination ? pinnedTimelineRequest : lazyCombinationRequest}
            onSelect={() => {
              dismissPinnedCombination()
              onSelectCombination(selectedCombination.outwardDate, selectedCombination.returnDate)
            }}
            onToggleDetails={() => toggleCombinationDetails(getCombinationKey(selectedCombination.outwardDate, selectedCombination.returnDate))}
          />
        </aside>
      </div>
    </div>

    <Dialog
      open={Boolean(dayDetailsDirection)}
      onOpenChange={(open) => {
        if (!open) setDayDetailsDirection(null)
      }}
    >
      <DialogContent className="grid h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[92vh] sm:w-[96vw] sm:max-w-6xl sm:rounded-lg sm:border">
        <DialogHeader className="border-b border-gray-200 px-4 pb-3 pr-12 pt-4 text-left sm:px-5 sm:pb-4 sm:pt-5">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Calendar className="h-5 w-5 text-blue-600" />
            {showingReturnDay ? "Alle Rückfahrten" : "Alle Hinfahrten"}
            {dayDetailsDate && <span className="font-normal text-gray-500">· {formatDate(dayDetailsDate)}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto bg-gray-50 sm:p-4">
          <DayDetailsPanel
            key={`${dayDetailsDirection || "closed"}-${dayDetailsDate || ""}`}
            date={dayDetailsDate}
            data={dayDetailsData}
            startStation={showingReturnDay ? zielStation : startStation}
            zielStation={showingReturnDay ? startStation : zielStation}
            searchParams={dayDetailsSearchParams}
          />
        </div>
      </DialogContent>
    </Dialog>

    </>
  )
}


function DirectionBookingButton({
  combination,
  direction,
  startStation,
  zielStation,
  searchParams,
}: {
  combination: TravelCombination
  direction: "outward" | "return"
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams: any
}) {
  if (!startStation || !zielStation) return null

  const isReturn = direction === "return"
  const departure = isReturn ? combination.returnDeparture : combination.outwardDeparture
  const from = isReturn ? zielStation : startStation
  const to = isReturn ? startStation : zielStation
  const link = createBookingLink(
    departure,
    from.name,
    to.name,
    from.id,
    to.id,
    searchParams.klasse || "KLASSE_2",
    searchParams.maximaleUmstiege || "",
    searchParams.alter || "ERWACHSENER",
    searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
    searchParams.ermaessigungKlasse || "KLASSENLOS",
    searchParams.umstiegszeit
  )

  return <JourneyBookingButton direction={direction} href={link} />
}

function DayRideList({
  title,
  date,
  data,
  fromStation,
  toStation,
  searchParams,
}: {
  title: string
  date: string
  data?: PriceData
  fromStation?: { name: string; id: string }
  toStation?: { name: string; id: string }
  searchParams: any
}) {
  type SortKey = "preis" | "abfahrt" | "ankunft" | "umstiege" | "dauer"

  const [showOnlyCheapest, setShowOnlyCheapest] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("preis")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const intervals = data?.allIntervals?.length
    ? data.allIntervals
    : data && data.preis > 0
      ? [{
          preis: data.preis,
          abfahrtsZeitpunkt: data.abfahrtsZeitpunkt,
          ankunftsZeitpunkt: data.ankunftsZeitpunkt,
          abfahrtsOrt: fromStation?.name || "",
          ankunftsOrt: toStation?.name || "",
          info: data.info,
        }]
      : []
  const minDuration = intervals.length > 0
    ? Math.min(...intervals.map((interval) => getDurationMinutes(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt)))
    : null

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((direction) => direction === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const sortedIntervals = [...intervals].sort((a, b) => {
    let left = 0
    let right = 0

    switch (sortKey) {
      case "abfahrt":
        left = new Date(a.abfahrtsZeitpunkt).getTime()
        right = new Date(b.abfahrtsZeitpunkt).getTime()
        break
      case "ankunft":
        left = new Date(a.ankunftsZeitpunkt).getTime()
        right = new Date(b.ankunftsZeitpunkt).getTime()
        break
      case "umstiege":
        left = a.umstiegsAnzahl || 0
        right = b.umstiegsAnzahl || 0
        break
      case "dauer":
        left = getDurationMinutes(a.abfahrtsZeitpunkt, a.ankunftsZeitpunkt)
        right = getDurationMinutes(b.abfahrtsZeitpunkt, b.ankunftsZeitpunkt)
        break
      case "preis":
      default:
        left = a.preis
        right = b.preis
        break
    }

    const diff = left - right
    if (diff !== 0) return sortDir === "asc" ? diff : -diff

    return getDurationMinutes(a.abfahrtsZeitpunkt, a.ankunftsZeitpunkt) -
      getDurationMinutes(b.abfahrtsZeitpunkt, b.ankunftsZeitpunkt)
  })

  const displayedIntervals = showOnlyCheapest
    ? (() => {
        const cheapestPerInterval = sortedIntervals.filter((interval) => interval.isCheapestPerInterval)
        return cheapestPerInterval.length > 0 ? cheapestPerInterval : sortedIntervals
      })()
    : sortedIntervals
  const intervalPriceScale = createPriceBandScale(intervals.map((interval) => interval.preis))

  const getIntervalPriceColor = (price: number) => {
    const style = PRICE_BAND_STYLES[intervalPriceScale.getBand(price)]
    return `${style.text} ${style.background} ${style.border} ${style.emphasis}`
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-white">
      <div className="border-b border-blue-100 bg-blue-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-blue-900">{title}</div>
            <div className="text-xs text-blue-700">{formatFullDate(date)}</div>
          </div>
          <span className="rounded bg-white px-2 py-1 text-xs font-medium text-blue-700">
            {intervals.length} Fahrten
          </span>
        </div>
      </div>

      {intervals.length === 0 ? (
        <div className="p-3 text-sm text-gray-500">Keine einzelnen Fahrten für diesen Tag verfügbar.</div>
      ) : (
        <ConnectionsTable
          intervals={intervals}
          displayedIntervals={displayedIntervals}
          hasMultipleIntervals={intervals.length > 1}
          minDuration={minDuration}
          data={data || { preis: 0, info: "", abfahrtsZeitpunkt: "", ankunftsZeitpunkt: "" }}
          recommendedTrip={null}
          startStation={fromStation}
          zielStation={toStation}
          searchParams={searchParams}
          sortKey={sortKey}
          sortDir={sortDir}
          handleSort={handleSort}
          getIntervalPriceColor={getIntervalPriceColor}
          calculateDuration={calculateDuration}
          getDurationMinutes={getDurationMinutes}
          recommendation={null}
          createBookingLink={createBookingLink}
          showOnlyCheapest={showOnlyCheapest}
          setShowOnlyCheapest={setShowOnlyCheapest}
        />
      )}
    </div>
  )
}


function InitialCombinationResultPlaceholder({
  outwardDate,
  returnDate,
  dense = false,
}: {
  outwardDate?: string
  returnDate?: string
  dense?: boolean
}) {
  const nights = outwardDate && returnDate ? getNights(outwardDate, returnDate) : undefined

  return (
    <article className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.10)]">
      <RoundTripJourneySummaryPlaceholder
        outwardDate={outwardDate}
        returnDate={returnDate}
        nights={nights}
        dense={dense}
      />
      <JourneyResultActionBar
        dense={dense}
        secondaryColumns={2}
        bookingActions={(
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <div className="h-8 rounded-md bg-blue-100 sm:w-28" aria-hidden="true" />
            <div className="h-8 rounded-md border border-blue-100 bg-white sm:w-28" aria-hidden="true" />
          </div>
        )}
        secondaryActions={(
          <>
            <div className="h-8 rounded-md border border-gray-200 bg-white sm:h-4 sm:w-28 sm:border-0 sm:bg-gray-100" aria-hidden="true" />
            <div className="h-8 rounded-md border border-gray-200 bg-white sm:h-4 sm:w-28 sm:border-0 sm:bg-gray-100" aria-hidden="true" />
          </>
        )}
      />
    </article>
  )
}

function TravelCombinationsPlaceholder({
  startStation,
  zielStation,
  searchStart,
  searchEnd,
  outwardDate,
  returnDate,
}: {
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchStart?: string
  searchEnd?: string
  outwardDate?: string
  returnDate?: string
}) {
  const searchDayCount = searchStart && searchEnd ? getNights(searchStart, searchEnd) + 1 : null

  return (
    <div className="flex flex-col gap-4" aria-label="Reisekombinationen werden vorbereitet" aria-busy="true">
      <section className="overflow-hidden border-y border-gray-200 bg-white sm:rounded-lg sm:border sm:shadow-sm">
        <header className="flex items-start justify-between gap-2 border-b border-blue-100 bg-blue-50/70 px-4 py-4 sm:items-center sm:gap-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Hin- und Rückfahrt</div>
            <h2 className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-base text-blue-950 sm:flex-nowrap sm:text-lg">
              <span className="min-w-0 truncate font-bold">{startStation?.name || "Start"}</span>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-600" aria-hidden="true">
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 truncate font-bold">{zielStation?.name || "Ziel"}</span>
            </h2>
            <p className="mt-1 text-xs text-blue-700">Reisekombinationen werden berechnet</p>
          </div>
          <div className="w-32 shrink-0 self-start rounded-lg border border-blue-100 bg-white/60 px-2 py-1.5 sm:w-44 sm:self-center sm:px-4 sm:py-2" aria-hidden="true">
            <div className="h-3 w-24 animate-pulse rounded bg-blue-100 sm:ml-auto sm:w-32" />
            <div className="mt-2 flex items-center justify-end gap-1">
              <div className="h-3 w-4 animate-pulse rounded bg-blue-100" />
              <div className="h-7 w-20 animate-pulse rounded bg-blue-100" />
            </div>
          </div>
        </header>

        <div className="border-b border-blue-100 bg-white p-2 lg:hidden">
          <div className="grid grid-cols-2 rounded-lg bg-gray-100 p-1" aria-hidden="true">
            <div className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-3 text-sm font-semibold text-blue-800 shadow-sm">
              <Train className="h-4 w-4" /> Liste
            </div>
            <div className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold text-gray-600">
              <Table2 className="h-4 w-4" /> Preismatrix
            </div>
          </div>
        </div>

        <div className="border-b border-gray-200 px-4 py-3 sm:px-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reisezeitraum</div>
          <div className="mt-0.5 text-sm font-semibold text-gray-900">Hin- und Rückfahrt verschieben</div>
        </div>
        <div className="px-4 pb-1 sm:px-5">
          <div className="pt-3" aria-hidden="true">
            <div className="flex justify-end text-xs text-blue-700">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 border border-gray-200 bg-gray-100" /> Wochenende
              </span>
              {searchDayCount !== null && <span className="ml-3">{searchDayCount} Reisetage</span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:hidden">
              <div>
                <div className="font-medium text-gray-500">Hinfahrt</div>
                <div className="font-semibold text-blue-800">{outwardDate ? formatDate(outwardDate) : "–"}</div>
              </div>
              <div className="text-right">
                <div className="font-medium text-gray-500">Rückfahrt</div>
                <div className="font-semibold text-blue-800">{returnDate ? formatDate(returnDate) : "–"}</div>
              </div>
            </div>
            <div className="relative mx-1 mt-4 h-28 sm:mx-2 sm:h-32">
              <div className="absolute left-0 right-0 top-5 h-1 rounded bg-blue-100 sm:top-12" />
              <div className="absolute left-[18%] right-[24%] top-5 h-1 rounded bg-blue-300 sm:top-12" />
              <span className="absolute left-[18%] top-1 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full sm:top-8">
                <span className="h-5 w-5 rounded-full border-2 border-white bg-blue-300 shadow-sm" />
              </span>
              <span className="absolute right-[24%] top-1 flex h-8 w-8 translate-x-1/2 items-center justify-center rounded-full sm:top-8">
                <span className="h-5 w-5 rounded-full border-2 border-blue-300 bg-white shadow-sm" />
              </span>
              <div className="absolute left-1/2 top-[3rem] h-3 w-16 -translate-x-1/2 animate-pulse rounded bg-gray-200 sm:top-[4.9rem]" />
              <div className="absolute bottom-0 left-0">
                <div className="text-[10px] uppercase text-gray-500">Suchbeginn</div>
                <div className="text-xs font-semibold text-gray-800 sm:text-sm">{searchStart ? formatDate(searchStart) : "–"}</div>
              </div>
              <div className="absolute bottom-0 right-0 text-right">
                <div className="text-[10px] uppercase text-gray-500">Suchende</div>
                <div className="text-xs font-semibold text-gray-800 sm:text-sm">{searchEnd ? formatDate(searchEnd) : "–"}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
          <div className="text-xs font-semibold uppercase text-gray-600">Weitere Fahrten an diesen Reisetagen</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {["Hinfahrt", "Rückfahrt"].map((label) => (
              <div key={label} className="flex min-h-12 items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2" aria-hidden="true">
                <Calendar className="h-4 w-4 shrink-0 text-blue-300" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block text-xs font-semibold text-gray-900">{label}</span>
                  <span className="block h-2.5 w-36 max-w-full rounded bg-gray-100" />
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden border-y border-gray-200 bg-white sm:rounded-lg sm:border sm:shadow-sm">
        <div className="flex flex-col gap-3 border-b border-blue-200 bg-blue-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
              <Train className="h-4 w-4" /> Verbindungen
            </div>
            <div className="mt-0.5 text-xs text-blue-700">Alle Verbindungen nach Gesamtpreis aufsteigend sortiert</div>
          </div>
          <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Wird laufend ergänzt
            </span>
            <div className="flex h-9 w-full animate-pulse items-center gap-2 rounded-md border border-blue-200 bg-white px-2 lg:w-72" aria-hidden="true">
              <div className="h-3 w-12 rounded bg-blue-100" />
              <div className="h-3 flex-1 rounded bg-gray-100" />
              <div className="h-5 w-px bg-gray-200" />
              <div className="h-4 w-16 rounded bg-blue-100" />
            </div>
          </div>
        </div>
        <div className="space-y-3 bg-slate-100/80 p-2.5 sm:p-3">
          {[0, 1].map((item) => (
            <InitialCombinationResultPlaceholder
              key={item}
              outwardDate={outwardDate}
              returnDate={returnDate}
            />
          ))}
        </div>
      </section>

      <section className="hidden overflow-hidden border-y border-gray-200 bg-gray-50 pt-4 sm:rounded-lg sm:border sm:shadow-sm lg:block" aria-hidden="true">
        <div className="border-b border-gray-200 px-4 pb-3 text-sm font-semibold text-gray-800">Preismatrix</div>
        <div className="border-b border-gray-200 bg-gray-50 p-2">
          <InitialCombinationResultPlaceholder
            outwardDate={outwardDate}
            returnDate={returnDate}
            dense
          />
        </div>
        <div className="grid grid-cols-[8rem_repeat(5,minmax(4rem,1fr))] gap-px bg-gray-200 p-px">
          {Array.from({ length: 24 }, (_, index) => (
            <div key={index} className={cn("h-12 animate-pulse bg-white p-2", index < 6 && "bg-blue-50")}>
              <div className="mx-auto mt-2 h-3 w-3/5 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function TravelCombinations({
  combinations,
  outwardResults,
  returnResults,
  expectedOutwardDays,
  expectedReturnDays,
  startStation,
  zielStation,
  searchParams,
  isStreaming,
  sessionId,
  onCancelSearch,
  onRestartSearch,
  searchWasCancelled,
  lazyCombinationRequest,
  onRequestCombination,
  onResolveLazyCombination,
  isFullMatrixLoading,
  fullMatrixLoadError,
  onRequestFullMatrix,
  onResetFullMatrix,
}: TravelCombinationsProps) {
  const hasReturnSearch = searchParams.rueckfahrt === "1"
  const [selectedCombination, setSelectedCombination] = useState<TravelCombination | null>(null)
  const selectionScope = [
    searchParams.start,
    searchParams.ziel,
    searchParams.reisezeitraumAb,
    searchParams.reisezeitraumBis,
    searchParams.wochentage,
    searchParams.returnWochentage,
    searchParams.minNaechte,
    searchParams.maxNaechte,
  ].join("|")

  useEffect(() => {
    setSelectedCombination(null)
  }, [selectionScope])

  const outwardDates = generateDateKeys(searchParams.reisezeitraumAb, searchParams.reisezeitraumBis, searchParams.wochentage)
  const returnDates = generateDateKeys(
    searchParams.reisezeitraumAb,
    searchParams.reisezeitraumBis,
    searchParams.returnWochentage || searchParams.wochentage
  )
  const minNights = parsePositiveInt(searchParams.minNaechte, 1) || 1
  const maxNights = parsePositiveInt(searchParams.maxNaechte)
  const initialSearchDates = getFeasibleReturnSearchDates({
    outwardDates,
    returnDates,
    minNights,
    maxNights,
  })
  const completedOutward = initialSearchDates.outwardDates.filter((date) =>
    Object.prototype.hasOwnProperty.call(outwardResults, date)
  ).length
  const completedReturn = initialSearchDates.returnDates.filter((date) =>
    Object.prototype.hasOwnProperty.call(returnResults, date)
  ).length
  const totalDays = expectedOutwardDays + expectedReturnDays
  const completedDays = completedOutward + completedReturn

  useEffect(() => {
    if (isStreaming && completedDays === 0) {
      setSelectedCombination(null)
    }
  }, [completedDays, isStreaming])

  const queueStatus = useSearchQueueStatus({
    sessionId,
    isActive: Boolean(isStreaming && completedDays < totalDays),
    remainingRequests: Math.max(0, totalDays - completedDays),
    searchType: "bestpreissuche",
  })

  const suppliedCombinationMap = new Map(
    combinations.map((combination) => [
      getCombinationKey(combination.outwardDate, combination.returnDate),
      combination,
    ])
  )
  const buildCombinationFromDates = (
    outwardDate: string,
    returnDate: string,
    allowOutsideStayFilter = false
  ): TravelCombination | null => {
    const existing = suppliedCombinationMap.get(getCombinationKey(outwardDate, returnDate))
    if (existing) return existing

    const outwardData = outwardResults[outwardDate]
    const returnData = returnResults[returnDate]
    const nights = getNights(outwardDate, returnDate)
    if (!outwardData || !returnData || outwardData.preis <= 0 || returnData.preis <= 0) return null
    if (nights < 1) return null
    if (
      !allowOutsideStayFilter &&
      (nights < minNights || (typeof maxNights === "number" && nights > maxNights))
    ) return null

    const outwardJourney = getJourneyTimes(outwardData)
    const returnJourney = getJourneyTimes(returnData)

    return {
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
    }
  }

  const rankedCombinations = outwardDates
    .flatMap((outwardDate) =>
      returnDates.map((returnDate) => buildCombinationFromDates(outwardDate, returnDate))
    )
    .filter((combination): combination is TravelCombination => combination !== null)
    .sort((left, right) => left.totalPrice - right.totalPrice || left.nights - right.nights)
  const best = rankedCombinations[0]
  const primaryCombination = selectedCombination || best
  const searchDates = [
    searchParams.reisezeitraumAb,
    searchParams.reisezeitraumBis,
    ...outwardDates,
    ...returnDates,
  ].filter((date): date is string => Boolean(date)).sort()
  const searchStart = searchParams.reisezeitraumAb || searchDates[0] || primaryCombination?.outwardDate || ""
  const searchEnd = searchDates[searchDates.length - 1] || primaryCombination?.returnDate || searchStart
  const placeholderOutwardDate = initialSearchDates.outwardDates[0]
  const placeholderReturnDate = initialSearchDates.returnDates.find((date) => {
    if (!placeholderOutwardDate) return false
    const nights = getNights(placeholderOutwardDate, date)
    return nights >= minNights && (typeof maxNights !== "number" || nights <= maxNights)
  }) || initialSearchDates.returnDates[0]

  const handleSelectCombination = (outwardDate: string, returnDate: string) => {
    const nextCombination = buildCombinationFromDates(outwardDate, returnDate, true)
    if (nextCombination) {
      setSelectedCombination(nextCombination)
      onResolveLazyCombination?.()
    } else if (getNights(outwardDate, returnDate) >= 1) {
      void onRequestCombination?.(outwardDate, returnDate)
    }
  }

  const handleSelectTimelineCombination = (outwardDate: string, returnDate: string) => {
    const nextCombination = buildCombinationFromDates(outwardDate, returnDate, true)
    if (nextCombination) {
      setSelectedCombination(nextCombination)
      onResolveLazyCombination?.()
    } else if (getNights(outwardDate, returnDate) >= 1) {
      void onRequestCombination?.(outwardDate, returnDate)
    }
  }

  useEffect(() => {
    if (lazyCombinationRequest?.status !== "complete") return
    const nextCombination = buildCombinationFromDates(
      lazyCombinationRequest.outwardDate,
      lazyCombinationRequest.returnDate,
      true
    )
    if (!nextCombination) return

    setSelectedCombination(nextCombination)
    onResolveLazyCombination?.()
  }, [lazyCombinationRequest, outwardResults, returnResults])

  if (!hasReturnSearch) return null

  return (
    <div className="space-y-4">
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

      {primaryCombination && (
        <div>
          <CombinationComparisonPanel
            combinations={rankedCombinations}
            selectedCombination={primaryCombination}
            searchStart={searchStart}
            searchEnd={searchEnd}
            outwardDates={outwardDates}
            returnDates={returnDates}
            outwardResults={outwardResults}
            returnResults={returnResults}
            minNights={minNights}
            maxNights={maxNights}
            isStreaming={isStreaming}
            startStation={startStation}
            zielStation={zielStation}
            searchParams={searchParams}
            lazyCombinationRequest={lazyCombinationRequest}
            isFullMatrixLoading={isFullMatrixLoading}
            fullMatrixLoadError={fullMatrixLoadError}
            onRequestFullMatrix={onRequestFullMatrix}
            onResetFullMatrix={onResetFullMatrix}
            onSelectCombination={handleSelectCombination}
            onSelectTimelineCombination={handleSelectTimelineCombination}
          />
        </div>
      )}

      {isStreaming && rankedCombinations.length === 0 && (
        <TravelCombinationsPlaceholder
          startStation={startStation}
          zielStation={zielStation}
          searchStart={searchStart}
          searchEnd={searchEnd}
          outwardDate={placeholderOutwardDate}
          returnDate={placeholderReturnDate}
        />
      )}

      {!isStreaming && rankedCombinations.length === 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
          Keine passende Hin- und Rückfahrt-Kombination für die gewählte Aufenthaltsdauer gefunden.
        </div>
      )}

    </div>
  )
}
