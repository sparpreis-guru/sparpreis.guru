"use client"

import React, { useState, useRef } from "react"
import { flushSync } from "react-dom" // Import flushSync
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react"
import { recommendOne } from "@/lib/train-search/recommendation-engine"
import { AnimatePresence, motion } from "framer-motion"
import {
  createBookingLink,
  getDurationMinutes
} from "@/lib/train-search/day-details-utils"
import { ConnectionsTable } from "./day-connections-table"
import { PriceHistoryChart, type PriceHistoryEntry } from "./price-history-chart"
import { logWarn } from "@/lib/shared/logger"
import { createPriceBandScale, PRICE_BAND_STYLES } from "@/lib/train-search/price-bands"
import { OneWayJourneySummaryPlaceholder } from "@/components/search/journey-result"

const LOG_SCOPE = "bestpreissuche.day-details"

interface IntervalData {
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
  priceHistory?: PriceHistoryEntry[]
  allIntervals?: IntervalData[]
}

interface DayDetailsPanelProps {
  date: string | null
  data: PriceData | null
  startStation?: { name: string; id: string }
  zielStation?: { name: string; id: string }
  searchParams?: any
  onNavigateDay?: (direction: number) => void
  dayKeys?: string[]
  isLoading?: boolean
}

const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]

// Variants für die Slide-Animation definieren
const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 40 : -40,
    opacity: 0,
  }),
}

export function DayDetailsPanel({
  date,
  data,
  startStation,
  zielStation,
  searchParams,
  onNavigateDay,
  dayKeys = [],
  isLoading = false,
}: DayDetailsPanelProps) {
  const [showOnlyCheapest, setShowOnlyCheapest] = useState(false)
  const [sortKey, setSortKey] = useState<'preis' | 'abfahrt' | 'ankunft' | 'umstiege' | 'dauer'>('preis')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Einfacher State für die Richtung reicht aus, wenn custom Prop genutzt wird
  const [direction, setDirection] = useState(0)

  // Swipe-Handling für die Navigation innerhalb der eingebetteten Tagesansicht
  const touchStartX = useRef<number | null>(null)
  const previousDate = useRef<string | null>(null)

  // Navigations-Handler
  const handleNavigate = (newDirection: number) => {
    if (!onNavigateDay) return
    // flushSync erzwingt ein sofortiges Update des DOMs/States vor dem Callback
    flushSync(() => {
      setDirection(newDirection)
    })
    onNavigateDay(newDirection)
  }

  // Keyboard-Handling direkt an der fokussierbaren Tagesansicht
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation() // Stoppt React Event Bubbling
      e.nativeEvent.stopImmediatePropagation() // Stoppt natives Bubbling zum Document
      handleNavigate(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      handleNavigate(1)
    }
  }

  // Track animation direction based on date changes (Fallback für externe Änderungen)
  React.useEffect(() => {
    if (!date || !dayKeys.length || !previousDate.current) {
      previousDate.current = date
      return
    }

    const currentIdx = dayKeys.indexOf(date)
    const prevIdx = dayKeys.indexOf(previousDate.current)

    if (currentIdx !== -1 && prevIdx !== -1 && currentIdx !== prevIdx) {
      setDirection(currentIdx > prevIdx ? 1 : -1)
    }

    previousDate.current = date
  }, [date, dayKeys])

  // Define SortKey type for table sorting
  type SortKey = 'preis' | 'abfahrt' | 'ankunft' | 'umstiege' | 'dauer'

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(deltaX) > 100) {
      handleNavigate(deltaX < 0 ? 1 : -1)
    }
    touchStartX.current = null
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function sortIntervals(list: IntervalData[]): IntervalData[] {
    return [...list].sort((a, b) => {
      let valA: number = 0
      let valB: number = 0
      switch (sortKey) {
        case 'abfahrt':
          valA = new Date(a.abfahrtsZeitpunkt).getTime(); valB = new Date(b.abfahrtsZeitpunkt).getTime(); break
        case 'ankunft':
          valA = new Date(a.ankunftsZeitpunkt).getTime(); valB = new Date(b.ankunftsZeitpunkt).getTime(); break
        case 'umstiege':
          valA = a.umstiegsAnzahl || 0; valB = b.umstiegsAnzahl || 0; break
        case 'dauer':
          valA = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime();
          valB = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime();
          break
        case 'preis':
        default:
          // Erst nach Preis, dann nach Reisedauer sortieren
          const priceDiff = sortDir === 'asc' ? a.preis - b.preis : b.preis - a.preis
          if (priceDiff !== 0) return priceDiff

          // Bei gleichem Preis: nach Reisedauer sortieren (kürzere Dauer zuerst)
          const durationA = new Date(a.ankunftsZeitpunkt).getTime() - new Date(a.abfahrtsZeitpunkt).getTime()
          const durationB = new Date(b.ankunftsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
          return durationA - durationB
      }
      return sortDir === 'asc' ? valA - valB : valB - valA
    })
  }

  if ((!date || !data) && isLoading) {
    return <DayDetailsPanelSkeleton />
  }

  if (!date || !data) {
    return (
      <section id="day-connections" className="rounded-lg border border-dashed border-blue-200 bg-blue-50/50 px-4 py-6 text-center">
        <Calendar className="mx-auto h-5 w-5 text-blue-500" />
        <h2 className="mt-2 text-sm font-semibold text-blue-950">Verbindungen für einen Reisetag</h2>
        <p className="mt-1 text-xs text-blue-700">Wähle im Kalender einen Tag mit Preis aus.</p>
      </section>
    )
  }

  const dateObj = new Date(date)
  const formattedDate = dateObj.toLocaleDateString("de-DE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const compactCurrentDate = dateObj.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  })
  const currentDayIndex = dayKeys.indexOf(date)
  const previousDay = currentDayIndex > 0 ? dayKeys[currentDayIndex - 1] : null
  const nextDay = currentDayIndex >= 0 && currentDayIndex < dayKeys.length - 1
    ? dayKeys[currentDayIndex + 1]
    : null
  const formatPagerDate = (value: string, compact = false) => new Date(value).toLocaleDateString("de-DE", compact
    ? { day: "2-digit", month: "2-digit" }
    : { weekday: "short", day: "2-digit", month: "2-digit" })

  const intervals = data.allIntervals || []

  // Filter intervals based on toggle state
  const displayedIntervals = showOnlyCheapest
    ? (() => {
        // Filter by isCheapestPerInterval flag (günstigste pro Zeitfenster)
        const markedCheapest = intervals.filter(interval => interval.isCheapestPerInterval === true)
        // If no intervals are marked as cheapest, fall back to showing all intervals
        // (this maintains backward compatibility if the backend doesn't set the flag)
        if (markedCheapest.length === 0 && intervals.length > 0) {
          logWarn(LOG_SCOPE, "No cheapest-per-slot markers found; showing all intervals", {
            travelDate: date,
            intervalCount: intervals.length,
          })
          return sortIntervals(intervals)
        }
        return sortIntervals(markedCheapest)
      })()
    : sortIntervals(intervals)

  // Check if this is a weekend
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6

  // Check if there are multiple intervals
  const hasMultipleIntervals = intervals.length > 1
  // Kürzeste Reisedauer aller Verbindungen (in Minuten)
  const minDuration = intervals.length > 0 ? Math.min(...intervals.map(i => getDurationMinutes(i.abfahrtsZeitpunkt, i.ankunftsZeitpunkt))) : null

  // Empfehlungsalgorithmus - IMMER eine Empfehlung, auch bei nur einer Verbindung
  const recommendation = intervals.length > 0 ? recommendOne(intervals) : null
  const recommendedTrip = recommendation?.trip
  const intervalPriceScale = createPriceBandScale(intervals.map((interval) => interval.preis))

  const getIntervalPriceColor = (price: number) => {
    const style = PRICE_BAND_STYLES[intervalPriceScale.getBand(price)]
    return `${style.text} ${style.background} ${style.border} ${style.emphasis}`
  }

  // Empfohlene Fahrt immer oben einfügen, falls nicht enthalten
  let displayedIntervalsWithRecommendation = displayedIntervals
  if (recommendedTrip) {
    const alreadyIncluded = displayedIntervals.some(
      i => i.abfahrtsZeitpunkt === recommendedTrip.abfahrtsZeitpunkt &&
           i.ankunftsZeitpunkt === recommendedTrip.ankunftsZeitpunkt &&
           i.preis === recommendedTrip.preis
    )
    if (!alreadyIncluded) {
      displayedIntervalsWithRecommendation = [recommendedTrip, ...displayedIntervals]
    }
  }

  return (
    <section
      id="day-connections"
      className="rounded-lg border border-gray-200 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={`Verbindungen am ${formattedDate}`}
    >
      <header className="sticky top-0 z-30 rounded-t-lg border-b border-blue-200 bg-blue-50/95 px-2 py-2 shadow-sm backdrop-blur sm:px-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,1.35fr)_minmax(0,1fr)] items-center gap-1 sm:gap-2">
          <div className="flex min-w-0 justify-start">
            {previousDay ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleNavigate(-1)}
              disabled={!onNavigateDay}
              className="h-9 min-w-0 justify-start rounded-md border-blue-200 bg-white px-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 active:translate-y-px sm:px-2 sm:text-sm"
              title={`Vorheriger Tag: ${new Date(previousDay).toLocaleDateString("de-DE", { dateStyle: "full" })}`}
              aria-label={`Vorheriger Tag: ${new Date(previousDay).toLocaleDateString("de-DE", { dateStyle: "full" })}`}
            >
              <ChevronLeft className="h-4 w-4 shrink-0" />
              <span className="truncate sm:hidden">{formatPagerDate(previousDay, true)}</span>
              <span className="hidden truncate sm:inline">{formatPagerDate(previousDay)}</span>
            </Button>
            ) : <span className="h-9 w-9" aria-hidden="true" />}
          </div>

          <h2 className="flex min-w-0 items-center justify-center gap-1.5 text-center text-sm font-semibold text-blue-950 sm:text-base lg:text-lg">
            <Calendar className="hidden h-4 w-4 shrink-0 text-blue-600 sm:block lg:h-5 lg:w-5" />
            <span className="hidden truncate sm:inline">{formattedDate}</span>
            <span className="truncate sm:hidden">{compactCurrentDate}</span>
            {isWeekend && <Badge variant="secondary" className="hidden xl:inline-flex">Wochenende</Badge>}
          </h2>

          <div className="flex min-w-0 justify-end">
            {nextDay ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleNavigate(1)}
              disabled={!onNavigateDay}
              className="h-9 min-w-0 justify-end rounded-md border-blue-200 bg-white px-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 active:translate-y-px sm:px-2 sm:text-sm"
              title={`Folgender Tag: ${new Date(nextDay).toLocaleDateString("de-DE", { dateStyle: "full" })}`}
              aria-label={`Folgender Tag: ${new Date(nextDay).toLocaleDateString("de-DE", { dateStyle: "full" })}`}
            >
              <span className="truncate sm:hidden">{formatPagerDate(nextDay, true)}</span>
              <span className="hidden truncate sm:inline">{formatPagerDate(nextDay)}</span>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </Button>
            ) : <span className="h-9 w-9" aria-hidden="true" />}
          </div>
        </div>
      </header>

      {data.priceHistory && data.priceHistory.length > 1 && (
        <div key={date} className="border-b border-gray-200 bg-white p-3 sm:p-4">
          <PriceHistoryChart history={data.priceHistory} title="Preisentwicklung für diesen Tag" />
        </div>
      )}

      <div className="relative">
        <div className="relative min-h-[200px] overflow-hidden rounded-b-lg">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={date}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="w-full"
            >
                <ConnectionsTable
                  embedded
                  intervals={intervals}
                  displayedIntervals={displayedIntervalsWithRecommendation}
                  hasMultipleIntervals={hasMultipleIntervals}
                  minDuration={minDuration}
                  data={data}
                  recommendedTrip={recommendedTrip}
                  startStation={startStation}
                  zielStation={zielStation}
                  searchParams={searchParams}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  handleSort={handleSort}
                  getIntervalPriceColor={getIntervalPriceColor}
                  getDurationMinutes={getDurationMinutes}
                  recommendation={recommendation}
                  createBookingLink={createBookingLink}
                  showOnlyCheapest={showOnlyCheapest}
                  setShowOnlyCheapest={setShowOnlyCheapest}
                />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

function DayDetailsPanelSkeleton() {
  return (
    <section
      id="day-connections"
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
      aria-label="Verbindungen für den ersten Reisetag werden geladen"
      aria-busy="true"
    >
      <header className="border-b border-blue-200 bg-blue-50/95 px-2 py-2 sm:px-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,1.35fr)_minmax(0,1fr)] items-center gap-1 sm:gap-2">
          <span className="h-9 w-9" aria-hidden="true" />
          <div className="mx-auto h-5 w-28 animate-pulse rounded bg-blue-100 sm:w-40" aria-hidden="true" />
          <span className="ml-auto h-9 w-9" aria-hidden="true" />
        </div>
      </header>

      <div className="border-b border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="animate-pulse space-y-1.5" aria-hidden="true">
            <div className="h-4 w-32 rounded bg-blue-100" />
            <div className="h-3 w-24 rounded bg-blue-100" />
          </div>
          <div className="flex animate-pulse items-center gap-2" aria-hidden="true">
            <div className="h-5 w-9 rounded-full bg-blue-100" />
            <div className="h-3 w-40 max-w-[60vw] rounded bg-blue-100" />
          </div>
        </div>
      </div>

      <div className="bg-slate-100/80 p-2.5 sm:p-3">
        <article className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.10)]">
          <OneWayJourneySummaryPlaceholder showBadges priceInMobileHeader />
          <div className="flex min-h-11 items-center justify-end gap-2 border-t border-gray-200 bg-white px-3 py-2 sm:px-4" aria-hidden="true">
            <div className="h-8 w-24 animate-pulse rounded-md bg-gray-100" />
            <div className="h-8 w-28 animate-pulse rounded-md bg-blue-100" />
          </div>
        </article>
      </div>
    </section>
  )
}
