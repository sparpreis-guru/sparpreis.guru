"use client"

import { useEffect, useId, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  AlertCircle,
  MapPin,
  Train,
  Loader2,
} from "lucide-react"
import { createBookingLink } from "@/lib/train-search/day-details-utils"
import type { JourneyLeg } from "@/components/bestpreissuche/journey-timeline"
import { SearchProgressPanel } from "@/components/search/search-progress-panel"
import { SearchErrorNotice } from "@/components/search/search-error-notice"
import type { SearchFailure } from "@/lib/search/search-errors"
import {
  DirectJourneyBadge,
  JourneyBookingButton,
  JourneyBookingButtonGroup,
  JourneyDisclosureButton,
  JourneyResultActionBar,
  OneWayJourneyDetails,
  OneWayJourneySummary,
  OneWayJourneySummaryPlaceholder,
  RoundTripJourneyDetails,
  RoundTripJourneySummary,
  RoundTripJourneySummaryPlaceholder,
} from "@/components/search/journey-result"
import {
  JourneySortControls,
  type JourneySortDirection,
  type JourneySortOption,
} from "@/components/search/journey-sort-controls"
import { useSearchQueueStatus } from "@/hooks/use-search-queue-status"
import {
  createPriceBandScale,
  getPriceBandClasses,
  type PriceBand,
} from "@/lib/train-search/price-bands"

const DynamicLeaflet = dynamic(
  () =>
    import("@/components/urlaubsfinder/urlaubsfinder-leaflet-map").then((mod) => ({
      default: mod.UrlauberfinderLeafletMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full flex items-center justify-center text-gray-400 text-sm bg-gray-50"
        style={{ height: 420 }}
      >
        Karte wird geladen...
      </div>
    ),
  }
)

interface DestinationResult {
  destination: string
  destinationId: string
  homeStationId: string
  homeStationName: string
  outwardDate: string
  outwardPrice: number
  outwardDeparture: string
  outwardArrival: string
  outwardTransfers?: number
  outwardLegs?: JourneyLeg[]
  returnDate?: string
  returnPrice?: number
  returnDeparture?: string
  returnArrival?: string
  returnTransfers?: number
  returnLegs?: JourneyLeg[]
  totalPrice: number
  lat?: number
  lon?: number
}

interface UnavailableDestination {
  destination: string
  reason: string
  error?: SearchFailure
  outwardPrice?: number
  returnPrice?: number
}

interface SearchParams {
  klasse: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  maximaleUmstiege?: string
}

interface UrlauberfinderResultsProps {
  results: DestinationResult[]
  unavailableResults?: UnavailableDestination[]
  isLoading: boolean
  homeStation: string
  homeCoords?: { lat: number; lon: number }
  progress?: {
    processed: number
    total: number
    destination: string
    processedRequests?: number
    totalRequests?: number
  } | null
  sessionId?: string | null
  plannedDestinations?: number
  requestsPerDestination?: number
  searchParams?: SearchParams | null
  searchWasCancelled?: boolean
  onCancel?: () => void
  onRestart?: () => void
}

type DestinationSortKey =
  | "price"
  | "destination"
  | "outward"
  | "arrival"
  | "duration"
  | "transfers"
  | "return"

const ONE_WAY_SORT_OPTIONS: readonly JourneySortOption<DestinationSortKey>[] = [
  { key: "price", label: "Preis" },
  { key: "destination", label: "Reiseziel" },
  { key: "outward", label: "Abfahrt" },
  { key: "arrival", label: "Ankunft" },
  { key: "duration", label: "Fahrzeit" },
  { key: "transfers", label: "Umstiege" },
]

const ROUND_TRIP_SORT_OPTIONS: readonly JourneySortOption<DestinationSortKey>[] = [
  { key: "price", label: "Gesamtpreis" },
  { key: "destination", label: "Reiseziel" },
  { key: "outward", label: "Hinfahrt" },
  { key: "return", label: "Rückfahrt" },
  { key: "duration", label: "Fahrzeit" },
  { key: "transfers", label: "Umstiege gesamt" },
]

function getJourneyDuration(departure?: string, arrival?: string) {
  if (!departure || !arrival) return Number.POSITIVE_INFINITY
  return new Date(arrival).getTime() - new Date(departure).getTime()
}

function getTotalJourneyDuration(result: DestinationResult) {
  const outwardDuration = getJourneyDuration(result.outwardDeparture, result.outwardArrival)
  if (!result.returnDeparture || !result.returnArrival) return outwardDuration
  return outwardDuration + getJourneyDuration(result.returnDeparture, result.returnArrival)
}

function ResultCard({
  result,
  priceBand,
  searchParams,
  homeStation,
  stationWidthReference,
  isExpanded,
  onToggle,
}: {
  result: DestinationResult
  priceBand: PriceBand
  searchParams: SearchParams | null | undefined
  homeStation: string
  stationWidthReference?: { origin?: string; destination?: string }
  isExpanded: boolean
  onToggle: () => void
}) {
  const priceTone = getPriceBandClasses(priceBand)
  const isRoundTrip = Boolean(result.returnDate && result.returnDeparture)
  const isDirect = result.outwardTransfers === 0 && (!isRoundTrip || result.returnTransfers === 0)
  const hasJourneyDetails = Boolean(result.outwardLegs?.length || result.returnLegs?.length)
  const journeyDetailsId = `journey-details-${useId()}`

  const outBooking = searchParams
    ? createBookingLink(
        result.outwardDeparture,
        homeStation || result.homeStationName,
        result.destination,
        result.homeStationId,
        result.destinationId,
        searchParams.klasse,
        searchParams.maximaleUmstiege ?? "",
        searchParams.alter,
        searchParams.ermaessigungArt,
        searchParams.ermaessigungKlasse
      )
    : "#"

  const retBooking =
    searchParams && result.returnDeparture
      ? createBookingLink(
          result.returnDeparture,
          result.destination,
          homeStation || result.homeStationName,
          result.destinationId,
          result.homeStationId,
          searchParams.klasse,
          searchParams.maximaleUmstiege ?? "",
          searchParams.alter,
          searchParams.ermaessigungArt,
          searchParams.ermaessigungKlasse
        )
      : "#"

  function handleToggle() {
    onToggle()
  }

  const nights = result.returnDate
    ? Math.max(1, Math.round((new Date(result.returnDate).getTime() - new Date(result.outwardDate).getTime()) / 86_400_000))
    : undefined
  const roundTripJourney = {
    outwardDate: result.outwardDate,
    returnDate: result.returnDate,
    nights,
    outwardPrice: result.outwardPrice,
    returnPrice: result.returnPrice,
    totalPrice: result.totalPrice,
    outwardDeparture: result.outwardDeparture,
    outwardArrival: result.outwardArrival,
    returnDeparture: result.returnDeparture,
    returnArrival: result.returnArrival,
    outwardOrigin: homeStation || result.homeStationName,
    outwardDestination: result.destination,
    returnOrigin: result.destination,
    returnDestination: homeStation || result.homeStationName,
    outwardTransfers: result.outwardTransfers,
    returnTransfers: result.returnTransfers,
    outwardLegs: result.outwardLegs,
    returnLegs: result.returnLegs,
  }
  const oneWayJourney = {
    date: result.outwardDate,
    price: result.totalPrice,
    departure: result.outwardDeparture,
    arrival: result.outwardArrival,
    origin: homeStation || result.homeStationName,
    destination: result.destination,
    transfers: result.outwardTransfers,
    legs: result.outwardLegs,
  }
  const metadataBadges = isDirect && !isRoundTrip
    ? <DirectJourneyBadge />
    : undefined
  const destinationHeader = (
    <div className="max-w-full">
      <strong className="min-w-0 max-w-full truncate text-sm font-bold text-gray-950 sm:text-base" title={result.destination}>
        {result.destination}
      </strong>
    </div>
  )

  return (
    <article
      id={`result-card-${encodeURIComponent(result.destination)}`}
      className={`overflow-hidden rounded-lg border text-sm shadow-[0_1px_4px_rgba(15,23,42,0.10)] transition hover:shadow-md ${priceBand === "best" ? "border-green-400 bg-green-100/60" : "border-gray-300 bg-white"} ${isExpanded ? "ring-2 ring-blue-300 ring-offset-1" : ""}`}
    >
      {isRoundTrip ? (
        <RoundTripJourneySummary
          journey={roundTripJourney}
          leadingContent={destinationHeader}
          priceTone={priceTone}
          stackHeaderOnMobile
          onTransfersClick={hasJourneyDetails ? handleToggle : undefined}
          transfersExpanded={isExpanded}
          transfersControlsId={journeyDetailsId}
          stationWidthReference={stationWidthReference}
        />
      ) : (
        <OneWayJourneySummary
          journey={oneWayJourney}
          leadingContent={destinationHeader}
          desktopBadges={metadataBadges}
          priceTone={priceTone}
          showDate
          priceInMobileHeader
          onTransfersClick={hasJourneyDetails ? handleToggle : undefined}
          transfersExpanded={isExpanded}
          transfersControlsId={journeyDetailsId}
          stationWidthReference={stationWidthReference}
        />
      )}

      <JourneyResultActionBar
        inlineBookingOnMobile={!isRoundTrip}
        bookingActions={searchParams ? (
            <JourneyBookingButtonGroup compactOnMobile={!isRoundTrip}>
                <JourneyBookingButton direction={isRoundTrip ? "outward" : "one-way"} href={outBooking} compactOnMobile={!isRoundTrip} />
                {result.returnDeparture && (
                  <JourneyBookingButton direction="return" href={retBooking} />
                )}
            </JourneyBookingButtonGroup>
        ) : undefined}
        secondaryActions={hasJourneyDetails ? (
          <JourneyDisclosureButton
            icon={<Train className="h-3.5 w-3.5" />}
            label="Fahrtverlauf anzeigen"
            expandedLabel="Fahrtverlauf schließen"
            mobileLabel="Fahrtverlauf"
            expanded={isExpanded}
            onClick={handleToggle}
          />
        ) : undefined}
      />

      {isExpanded && (
        isRoundTrip
          ? <RoundTripJourneyDetails journey={roundTripJourney} id={journeyDetailsId} />
          : <OneWayJourneyDetails journey={oneWayJourney} id={journeyDetailsId} />
      )}
    </article>
  )
}

function ResultCardPlaceholder({ isRoundTrip }: { isRoundTrip: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.10)]" aria-hidden="true">
      {isRoundTrip ? <RoundTripJourneySummaryPlaceholder stackHeaderOnMobile /> : <OneWayJourneySummaryPlaceholder showDate showBadges priceInMobileHeader />}
      <JourneyResultActionBar
        inlineBookingOnMobile={!isRoundTrip}
        bookingActions={(
          <div className={`grid gap-2 sm:flex sm:w-auto ${isRoundTrip ? "w-full grid-cols-2" : "w-auto grid-cols-1"}`}>
            <div className="h-8 rounded-md bg-blue-100 sm:w-28" />
            {isRoundTrip && <div className="h-8 rounded-md border border-blue-100 bg-white sm:w-28" />}
          </div>
        )}
        secondaryActions={<div className="h-4 w-32 rounded bg-gray-100" />}
      />
    </div>
  )
}

export function UrlauberfinderResults({
  results,
  unavailableResults = [],
  isLoading,
  homeStation,
  homeCoords,
  progress,
  sessionId,
  plannedDestinations = 0,
  requestsPerDestination = 1,
  searchParams,
  searchWasCancelled,
  onCancel,
  onRestart,
}: UrlauberfinderResultsProps) {
  const [mapSelected, setMapSelected] = useState<DestinationResult | null>(null)
  const [expandedDestination, setExpandedDestination] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<DestinationSortKey>("price")
  const [sortDir, setSortDir] = useState<JourneySortDirection>("asc")

  const priceScale = createPriceBandScale(results.map((result) => result.totalPrice))
  const hasResults = results.length > 0
  const minimumPrice = hasResults
    ? Math.min(...results.map((result) => result.totalPrice))
    : null
  const hasUnavailable = unavailableResults.length > 0
  const searchFailures = unavailableResults.flatMap(result => result.error ? [result.error] : [])
  const hasMapData = results.some((r) => r.lat && r.lon)
  const remainingDestinations = progress
    ? Math.max(0, progress.total - progress.processed)
    : Math.max(1, plannedDestinations - results.length - unavailableResults.length)
  const remainingRequests = progress?.processedRequests !== undefined && progress.totalRequests !== undefined
    ? Math.max(0, progress.totalRequests - progress.processedRequests)
    : remainingDestinations * requestsPerDestination
  const resultPlaceholderCount = isLoading ? Math.max(1, Math.min(3, remainingDestinations)) : 0
  const isRoundTripSearch = requestsPerDestination > 1 || results.some((result) => Boolean(result.returnDate))
  const sortOptions = isRoundTripSearch ? ROUND_TRIP_SORT_OPTIONS : ONE_WAY_SORT_OPTIONS
  const activeSortLabel = sortOptions.find((option) => option.key === sortKey)?.label ?? "Preis"
  const sortedResults = useMemo(() => {
    return [...results].sort((left, right) => {
      let difference = 0

      switch (sortKey) {
        case "destination":
          difference = left.destination.localeCompare(right.destination, "de")
          break
        case "outward":
          difference = new Date(left.outwardDeparture || left.outwardDate).getTime() -
            new Date(right.outwardDeparture || right.outwardDate).getTime()
          break
        case "arrival":
          difference = new Date(left.outwardArrival).getTime() - new Date(right.outwardArrival).getTime()
          break
        case "duration":
          difference = getTotalJourneyDuration(left) - getTotalJourneyDuration(right)
          break
        case "transfers":
          difference = ((left.outwardTransfers ?? 0) + (left.returnTransfers ?? 0)) -
            ((right.outwardTransfers ?? 0) + (right.returnTransfers ?? 0))
          break
        case "return":
          difference = new Date(left.returnDeparture || left.returnDate || 0).getTime() -
            new Date(right.returnDeparture || right.returnDate || 0).getTime()
          break
        case "price":
          difference = left.totalPrice - right.totalPrice
          break
      }

      if (difference !== 0) return sortDir === "asc" ? difference : -difference

      const priceDifference = left.totalPrice - right.totalPrice
      if (priceDifference !== 0) return priceDifference
      return getJourneyDuration(left.outwardDeparture, left.outwardArrival) -
        getJourneyDuration(right.outwardDeparture, right.outwardArrival)
    })
  }, [results, sortDir, sortKey])
  const widestDestination = useMemo(() => (
    results.reduce<string | undefined>((widest, result) => (
      !widest || result.destination.length > widest.length ? result.destination : widest
    ), undefined)
  ), [results])
  const homeStationReference = homeStation || results[0]?.homeStationName
  const widestStationReference = [homeStationReference, widestDestination]
    .filter((station): station is string => Boolean(station))
    .reduce<string | undefined>((widest, station) => (
      !widest || station.length > widest.length ? station : widest
    ), undefined)
  const stationWidthReference = {
    origin: widestStationReference,
    destination: widestStationReference,
  }
  const queueStatus = useSearchQueueStatus({
    sessionId,
    isActive: isLoading,
    remainingRateLimitedRequests: remainingRequests,
    searchType: "urlaubsfinder",
  })

  useEffect(() => {
    if (!mapSelected) return
    const cardId = `result-card-${encodeURIComponent(mapSelected.destination)}`
    const card = document.getElementById(cardId)
    if (!card) return

    setExpandedDestination(mapSelected.destination)
    card.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [mapSelected])

  useEffect(() => {
    if (!sortOptions.some((option) => option.key === sortKey)) {
      setSortKey("price")
      setSortDir("asc")
    }
  }, [sortKey, sortOptions])

  function handleSort(key: DestinationSortKey) {
    if (sortKey === key) {
      setSortDir((direction) => direction === "asc" ? "desc" : "asc")
      return
    }
    setSortKey(key)
    setSortDir("asc")
  }

  return (
    <div className={`space-y-4 ${isLoading ? "min-h-[100dvh]" : ""}`}>
      <SearchProgressPanel
        isActive={isLoading}
        completedItems={progress?.processed ?? results.length + unavailableResults.length}
        totalItems={progress?.total ?? plannedDestinations}
        queueStatus={queueStatus}
        progressUnit="Reisezielen"
        completedUnit="Reiseziele"
        isCancelled={searchWasCancelled}
        onCancel={onCancel}
        onRestart={onRestart}
        detail={hasResults ? `${results.length} Ziel${results.length !== 1 ? "e" : ""} gefunden` : undefined}
      />

      {!isLoading && !searchWasCancelled && searchFailures.length > 0 && (
        <SearchErrorNotice failures={searchFailures} hasResults={hasResults} />
      )}
      {!isLoading && !hasResults && !hasUnavailable && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <AlertCircle className="w-9 h-9 text-amber-400 mx-auto mb-3" />
          <p className="font-semibold text-gray-800 mb-1">Keine Ergebnisse</p>
          <p className="text-sm text-gray-500">
            Für die gewählten Kriterien wurden keine Verbindungen gefunden.
            Versuche andere Daten oder Ziele.
          </p>
        </div>
      )}

      {(isLoading || hasMapData) && (
        <div className="bg-blue-50 p-4 sm:rounded-lg">
          <div className="mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-blue-800">Karte</span>
            <span className="ml-auto text-xs text-blue-700">
              {results.length} Ziel{results.length !== 1 ? "e" : ""}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
            <DynamicLeaflet
              destinations={results}
              homeStation={homeStation}
              homeCoords={homeCoords}
              selectedResult={mapSelected}
              onSelectResult={(result: DestinationResult) => setMapSelected({ ...result })}
            />
          </div>
        </div>
      )}

      {(hasResults || isLoading) && (
        <section className="overflow-hidden border-y border-gray-200 bg-white sm:rounded-lg sm:border sm:shadow-sm">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 border-b border-blue-200 bg-blue-50 px-4 py-4 sm:gap-x-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Urlaubsfinder</div>
              <h3 className="mt-1 flex min-w-0 items-center gap-1.5 text-base font-bold text-blue-950 sm:text-lg">
                <MapPin className="h-4 w-4 shrink-0 text-blue-700" />
                <span className="truncate">Ab {homeStation || "Startbahnhof"}</span>
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-blue-700">
                <span>{results.length} {results.length === 1 ? "Reiseziel" : "Reiseziele"}</span>
                <span>·</span>
                <span>Nach {activeSortLabel} {sortDir === "asc" ? "aufsteigend" : "absteigend"}</span>
                {isLoading && (
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Wird ergänzt
                  </span>
                )}
              </div>
            </div>
            {minimumPrice !== null && (
              <div className="shrink-0 self-start rounded-lg border border-green-200 bg-green-50 px-2 py-1.5 text-green-800 shadow-sm sm:px-4 sm:py-2 sm:text-right lg:col-start-3 lg:row-start-1 lg:self-center">
                <div className="text-[10px] font-medium text-green-700 sm:text-xs">
                  {isRoundTripSearch ? "Günstigster Gesamtpreis" : "Günstigster Preis"}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1 sm:justify-end">
                  <span className="text-xs font-semibold sm:text-sm">ab</span>
                  <span className="text-xl font-bold tabular-nums sm:text-2xl">
                    {minimumPrice.toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} €
                  </span>
                </div>
              </div>
            )}
            <JourneySortControls
              options={sortOptions}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              ariaLabel={isRoundTripSearch ? "Reiseziele mit Hin- und Rückfahrt sortieren" : "Reiseziele sortieren"}
              embedded
              className="col-span-2 mt-1 w-full border-t border-blue-200 pt-3 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:w-auto lg:border-t-0 lg:pt-0"
            />
          </header>

          <div className="space-y-3 bg-slate-100/80 p-2.5 sm:p-3">
            {sortedResults.map((result) => (
              <ResultCard
                key={result.destination}
                result={result}
                priceBand={priceScale.getBand(result.totalPrice)}
                searchParams={searchParams}
                homeStation={homeStation}
                stationWidthReference={stationWidthReference}
                isExpanded={expandedDestination === result.destination}
                onToggle={() =>
                  setExpandedDestination((prev) =>
                    prev === result.destination ? null : result.destination
                  )
                }
              />
            ))}
            {Array.from({ length: resultPlaceholderCount }, (_, index) => (
              <ResultCardPlaceholder
                key={`result-placeholder-${index}`}
                isRoundTrip={isRoundTripSearch}
              />
            ))}
          </div>
        </section>
      )}

      {hasUnavailable && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-100 flex items-center gap-2 bg-amber-50">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span className="font-semibold text-sm text-amber-900">
              Nicht verfügbare Ziele
            </span>
            <span className="ml-auto text-xs text-amber-700">
              {unavailableResults.length}
            </span>
          </div>
          <div className="p-3 space-y-2">
            {unavailableResults.map((item) => (
              <div
                key={item.destination}
                className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 truncate">
                      {item.destination.replace(" Hbf", "")}
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5">{item.reason}</p>
                  </div>
                  <div className="text-right text-[11px] text-amber-900">
                    {item.outwardPrice !== undefined && (
                      <p>Hin: {item.outwardPrice.toFixed(2)} €</p>
                    )}
                    {item.returnPrice !== undefined && (
                      <p>Rück: {item.returnPrice.toFixed(2)} €</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
