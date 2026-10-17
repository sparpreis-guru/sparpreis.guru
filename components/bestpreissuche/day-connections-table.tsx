import { useState } from "react"
import {
  Euro,
  Info,
  Minus,
  Star,
  Train,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { DirectJourneyBadge, JourneyBookingButton, JourneyBookingButtonGroup, JourneyDisclosureButton, JourneyResultActionBar, OneWayJourneyDetails, OneWayJourneySummary } from "@/components/search/journey-result"
import { JourneySortControls } from "@/components/search/journey-sort-controls"
import { PriceHistoryChart } from "./price-history-chart"

const SORT_OPTIONS = [
  ["preis", "Preis"],
  ["abfahrt", "Abfahrt"],
  ["ankunft", "Ankunft"],
  ["dauer", "Fahrzeit"],
  ["umstiege", "Umstiege"],
] as const

export function ConnectionsTable({
  embedded = false,
  intervals,
  displayedIntervals,
  hasMultipleIntervals,
  minDuration,
  data,
  recommendedTrip,
  startStation,
  zielStation,
  searchParams,
  sortKey,
  sortDir,
  handleSort,
  getIntervalPriceColor,
  getDurationMinutes,
  createBookingLink,
  recommendation,
  showOnlyCheapest,
  setShowOnlyCheapest,
}: any) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const activeSortLabel = SORT_OPTIONS.find(([key]) => key === sortKey)?.[1] || "Preis"
  const isFlexpreisComparison = searchParams?.tarif === "FLEXPREIS"

  const toggleExclusive = (openKey: string, closeKey: string) => {
    setExpandedItems((current) => {
      const next = new Set(current)
      if (next.has(openKey)) next.delete(openKey)
      else {
        next.add(openKey)
        next.delete(closeKey)
      }
      return next
    })
  }

  return (
    <section className={embedded && !isFlexpreisComparison ? "overflow-hidden bg-white" : "overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"} aria-label={isFlexpreisComparison ? "Bestpreise der Verbindungssuche" : "Verbindungen"}>
      <header className={`border-b px-4 py-3 ${isFlexpreisComparison ? "border-gray-200 bg-slate-50" : "border-blue-200 bg-blue-50"}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className={`flex items-center gap-2 font-semibold ${isFlexpreisComparison ? "text-base text-gray-900" : "text-sm text-blue-900"}`}>
              <Train className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isFlexpreisComparison ? "Bestpreise" : "Verbindungen"} ({showOnlyCheapest ? `${displayedIntervals.length} von ${intervals.length}` : intervals.length})
            </h3>
            {isFlexpreisComparison && <p className="mt-0.5 text-xs text-gray-600">Günstigste gefundene Tickets · Tarif und Zugbindung bei der Bahn prüfen</p>}
            <p className={`mt-0.5 text-xs ${isFlexpreisComparison ? "text-gray-600" : "text-blue-700"}`}>
              Nach {activeSortLabel} {sortDir === "asc" ? "aufsteigend" : "absteigend"} sortiert
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 text-xs text-blue-800 lg:w-auto lg:flex-row lg:items-center lg:gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-2">
                  <Switch checked={showOnlyCheapest} onCheckedChange={setShowOnlyCheapest} />
                  Nur günstigste je Zeitfenster
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-600" aria-label="Info zu Zeitfenstern">
                      <Info className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="max-w-xs text-sm text-gray-700">
                    <div className="mb-1 font-semibold text-blue-800">Bestpreis-Zeitfenster</div>
                    <p>Die Bahn gruppiert Verbindungen in feste Zeitfenster. Hier wird pro Zeitfenster nur die günstigste Fahrt angezeigt.</p>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            {hasMultipleIntervals && (
              <JourneySortControls
                options={SORT_OPTIONS.map(([key, label]) => ({ key, label }))}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                ariaLabel="Verbindungen sortieren"
                embedded
                className="w-full lg:w-auto"
              />
            )}
          </div>
        </div>
      </header>

      <div className="space-y-3 bg-slate-100/80 p-2.5 sm:p-3">
        {displayedIntervals.map((interval: any, index: number) => {
          const isFastest = minDuration !== null && getDurationMinutes(interval.abfahrtsZeitpunkt, interval.ankunftsZeitpunkt) === minDuration
          const isBestPrice = interval.preis === data.preis
          const isRecommended = Boolean(
            recommendedTrip &&
            interval.abfahrtsZeitpunkt === recommendedTrip.abfahrtsZeitpunkt &&
            interval.ankunftsZeitpunkt === recommendedTrip.ankunftsZeitpunkt &&
            interval.preis === recommendedTrip.preis
          )
          const bookingLink = startStation && zielStation
            ? createBookingLink(
                interval.abfahrtsZeitpunkt,
                startStation.name,
                zielStation.name,
                startStation.id,
                zielStation.id,
                searchParams.klasse || "KLASSE_2",
                searchParams.maximaleUmstiege || "",
                searchParams.alter || "ERWACHSENER",
                searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
                searchParams.ermaessigungKlasse || "KLASSENLOS",
                searchParams.umstiegszeit
              )
            : null
          const journey = {
            date: interval.abfahrtsZeitpunkt,
            price: interval.preis,
            departure: interval.abfahrtsZeitpunkt,
            arrival: interval.ankunftsZeitpunkt,
            origin: interval.abfahrtsOrt || startStation?.name,
            destination: interval.ankunftsOrt || zielStation?.name,
            transfers: interval.umstiegsAnzahl,
            legs: interval.abschnitte,
          }
          const rowKey = `${interval.abfahrtsZeitpunkt}-${interval.ankunftsZeitpunkt}-${interval.preis}-${index}`
          const historyKey = `${rowKey}-history`
          const journeyDetailsId = `journey-details-${encodeURIComponent(rowKey)}`
          const journeyOpen = expandedItems.has(rowKey)
          const historyOpen = expandedItems.has(historyKey)
          const hasHistory = interval.priceHistory?.length > 1
          const hasMetadataBadges =
            isBestPrice || isRecommended || isFastest || interval.umstiegsAnzahl === 0
          const mobileMetadataBadges = isBestPrice || isRecommended ? (
            <>
              {isBestPrice && (
                <Badge className="rounded-full border border-green-400 bg-green-100 font-semibold text-green-800 shadow-sm">
                  <Euro className="mr-1 h-3 w-3" /> Bestpreis
                </Badge>
              )}
              {isRecommended && <RecommendationBadge explanation={recommendation?.explanation?.reason} />}
            </>
          ) : undefined
          const metadataBadges = hasMetadataBadges ? (
            <>
              {isBestPrice && (
                <Badge className="rounded-full border border-green-400 bg-green-100 font-semibold text-green-800 shadow-sm">
                  <Euro className="mr-1 h-3 w-3" /> Bestpreis
                </Badge>
              )}
              {isRecommended && <RecommendationBadge explanation={recommendation?.explanation?.reason} />}
              {isFastest && (
                <Badge className="rounded-full border border-purple-200 bg-purple-50 font-semibold text-purple-700 shadow-none">
                  <TrendingUp className="mr-1 h-3 w-3" /> Schnellste
                </Badge>
              )}
              {interval.umstiegsAnzahl === 0 && (
                <DirectJourneyBadge />
              )}
            </>
          ) : undefined
          return (
            <article
              key={rowKey}
              className={`overflow-hidden rounded-lg border shadow-[0_1px_4px_rgba(15,23,42,0.10)] transition hover:shadow-md ${isBestPrice ? "border-green-400 bg-green-100/60" : "border-gray-300 bg-white"}`}
            >
              <OneWayJourneySummary
                journey={journey}
                mobileBadges={mobileMetadataBadges}
                desktopBadges={metadataBadges}
                priceTone={getIntervalPriceColor(interval.preis)}
                priceInMobileHeader
                highlightDuration={isFastest}
                onTransfersClick={interval.abschnitte?.length > 0 ? () => toggleExclusive(rowKey, historyKey) : undefined}
                transfersExpanded={journeyOpen}
                transfersControlsId={journeyDetailsId}
              />

              <JourneyResultActionBar
                inlineBookingOnMobile
                secondaryColumns={interval.abschnitte?.length > 0 && hasHistory ? 2 : 1}
                bookingActions={bookingLink ? (
                  <JourneyBookingButtonGroup compactOnMobile>
                    <JourneyBookingButton direction="one-way" href={bookingLink} compactOnMobile />
                  </JourneyBookingButtonGroup>
                ) : undefined}
                secondaryActions={(
                  <>
                  {interval.abschnitte?.length > 0 && (
                    <JourneyDisclosureButton
                      icon={<Train className="h-3.5 w-3.5" />}
                      label="Fahrtverlauf anzeigen"
                      expandedLabel="Fahrtverlauf schließen"
                      mobileLabel="Verlauf"
                      expanded={journeyOpen}
                      onClick={() => toggleExclusive(rowKey, historyKey)}
                    />
                  )}
                  {hasHistory && (
                    <JourneyDisclosureButton
                      icon={getTrendIcon(interval.priceHistory)}
                      label="Preisentwicklung anzeigen"
                      expandedLabel="Preisentwicklung schließen"
                      mobileLabel="Preise"
                      expanded={historyOpen}
                      onClick={() => toggleExclusive(historyKey, rowKey)}
                    />
                  )}
                  </>
                )}
              />

              {historyOpen && hasHistory && (
                <div className="border-t border-gray-200 bg-white p-3 sm:p-4">
                  <PriceHistoryChart history={interval.priceHistory} title="Preisentwicklung dieser Verbindung" />
                </div>
              )}
              {journeyOpen && <OneWayJourneyDetails journey={journey} id={journeyDetailsId} />}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function RecommendationBadge({ explanation }: { explanation?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge className="cursor-help rounded-full border border-amber-400 bg-amber-100 font-semibold text-amber-800 shadow-sm">
          <Star className="mr-1 h-3 w-3" /> Empfohlen
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-sm">
        <RecommendationExplanation explanation={explanation} />
      </PopoverContent>
    </Popover>
  )
}

function RecommendationExplanation({ explanation }: { explanation?: string }) {
  return (
    <>
      <div className="mb-2 font-semibold text-amber-800">Intelligente Empfehlung</div>
      <p className="text-xs text-gray-600">Berücksichtigt Preis, Reisezeit und Anzahl der Umstiege.</p>
      {explanation && <div className="mt-2 rounded bg-amber-100 p-2 text-xs font-medium">{explanation}</div>}
    </>
  )
}

function getTrendIcon(history?: { preis: number }[]) {
  if (!history || history.length < 2) return <Minus className="h-3 w-3 text-gray-400" />
  const firstPrice = history[0].preis
  const lastPrice = history[history.length - 1].preis
  if (lastPrice > firstPrice) return <TrendingUp className="h-3 w-3 text-red-500" />
  if (lastPrice < firstPrice) return <TrendingDown className="h-3 w-3 text-green-500" />
  return <Minus className="h-3 w-3 text-gray-400" />
}
