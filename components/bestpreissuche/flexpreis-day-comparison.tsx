"use client"

import { useId, useState } from "react"
import { ChevronDown, Info, Loader2, Train, Unlock } from "lucide-react"
import { OneWayJourneySummary, OneWayJourneyDetails, JourneyBookingButton, JourneyBookingButtonGroup, JourneyDisclosureButton, JourneyResultActionBar } from "@/components/search/journey-result"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { flexpreisStatusLabel, getFlexpreisProductLabel, getFlexpreisRouteLabels, type FlexpreisBasis, type FlexpreisComparison, type FlexpreisDayData, type FlexpreisQuote } from "@/lib/search/flexpreis-comparison"
import { FlexpreisBasisSelector } from "./flexpreis-basis-selector"
import { createPriceBandScale, getPriceBandClasses } from "@/lib/train-search/price-bands"

function QuoteRow({ quote, routeLabel, comparison = false, basis, origin, destination, priceTone = "border-gray-200 bg-gray-50 text-gray-950" }: {
  quote?: FlexpreisQuote; routeLabel: string; comparison?: boolean; basis?: FlexpreisBasis; origin?: string; destination?: string
  priceTone?: string
}) {
  const [expanded, setExpanded] = useState<"journey" | "offer" | null>(null)
  const detailsId = useId()
  const toggle = (part: "journey" | "offer") => setExpanded(current => current === part ? null : part)
  const isPending = !quote
  const route = quote?.route
  const productClass = quote?.productClass ?? basis?.productClass
  const journey = {
    date: route?.representativeDeparture.slice(0, 10) ?? "", price: quote ? quote.amountCents / 100 : 0,
    departure: route?.representativeDeparture ?? "", arrival: route?.representativeArrival ?? "",
    origin: route?.origin.name ?? origin, destination: route?.destination.name ?? destination,
    transfers: route?.transfers, legs: quote?.legs,
  }
  const hasJourneyDetails = isPending || Boolean(quote?.legs.length)
  const viaLabel = productClass ? routeLabel.replace(`${getFlexpreisProductLabel(productClass)} · `, "") : routeLabel
  const badges = <>
    <Badge className="rounded-full border border-blue-200 bg-blue-50 font-medium text-blue-800 shadow-none">Flexpreis</Badge>
    {productClass && <Badge className="rounded-full border border-gray-200 bg-gray-50 font-medium text-gray-700 shadow-none">{getFlexpreisProductLabel(productClass)}</Badge>}
  </>
  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {isPending && <span className="sr-only" role="status">Flexpreis wird geprüft …</span>}
      <OneWayJourneySummary
        journey={journey}
        isLoading={isPending}
        leadingContent={<span className="text-xs font-semibold text-blue-800">{comparison ? "Vergleichsverbindung" : "Weitere geprüfte Verbindung"}</span>}
        mobileBadges={badges} desktopBadges={badges}
        priceTone={`${priceTone} [&>span]:inline-block [&>span]:min-w-[7ch]`}
        priceInMobileHeader
        onTransfersClick={!isPending && hasJourneyDetails ? () => toggle("journey") : undefined}
        transfersExpanded={expanded === "journey"}
        transfersControlsId={`${detailsId}-journey`}
      />
      <div className="px-3 pb-3 text-xs leading-5 text-gray-600 sm:px-4">
        <p className="text-sm font-medium text-gray-800">{isPending ? viaLabel || <span aria-hidden="true" className="inline-block w-64 max-w-full animate-pulse rounded bg-gray-200 text-transparent motion-reduce:animate-none">–</span> : route?.viaStations.length ? viaLabel : "Keine Zwischenhalte übermittelt"}</p>
      </div>
      <JourneyResultActionBar
        inlineBookingOnMobile
        secondaryColumns={hasJourneyDetails ? 2 : 1}
        bookingActions={isPending || quote?.bookingUrl ? <JourneyBookingButtonGroup compactOnMobile>
          <JourneyBookingButton direction="one-way" href={quote?.bookingUrl} disabled={isPending} compactOnMobile />
        </JourneyBookingButtonGroup> : undefined}
        secondaryActions={<>
          {hasJourneyDetails && <JourneyDisclosureButton
            icon={<Train className="h-3.5 w-3.5" />} label="Fahrtverlauf anzeigen" expandedLabel="Fahrtverlauf schließen" mobileLabel="Verlauf"
            expanded={expanded === "journey"} onClick={() => toggle("journey")} controlsId={`${detailsId}-journey`}
            disabled={isPending}
          />}
          <JourneyDisclosureButton
            icon={<Info className="h-3.5 w-3.5" />} label="Angebotsdetails anzeigen" expandedLabel="Angebotsdetails schließen" mobileLabel="Angebot"
            expanded={expanded === "offer"} onClick={() => toggle("offer")} controlsId={`${detailsId}-offer`}
            disabled={isPending}
          />
        </>}
      />
      {!isPending && expanded === "journey" && <OneWayJourneyDetails journey={journey} id={`${detailsId}-journey`} />}
      {quote && route && expanded === "offer" && <div id={`${detailsId}-offer`} className="space-y-2 border-t border-gray-200 bg-gray-50 px-3 py-3 text-xs leading-5 text-gray-600 sm:px-4">
        <h4 className="font-semibold text-gray-900">Angebotsdetails</h4>
        <p>{route.viaStations.length ? `Zwischenhalte der Verbindung: ${route.viaStations.map(s => s.name).join(" · ")}` : "Keine Zwischenhalte übermittelt"}</p>
        <p>Abgefragt: {new Date(quote.recordedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} Uhr</p>
        {quote.conditions.length > 0 && <p>{quote.conditions.join(" · ")}</p>}
        <p>Der Buchungslink öffnet die Bahn-Suche. Maßgeblich sind das dortige Angebot und die Streckengültigkeit auf dem Ticket.</p>
      </div>}
    </article>
  )
}

export function FlexpreisDayComparison({ data, onCheckMore, isPending = false, isChecking = false, error,
  comparison: routeComparison, comparisonPrices = [], onBasisChange, isBasisLoading = false, origin, destination }: {
  data?: FlexpreisDayData; onCheckMore?: () => void; isPending?: boolean; isChecking?: boolean; error?: string
  comparison?: FlexpreisComparison; onBasisChange?: (id: string) => void; isBasisLoading?: boolean
  comparisonPrices?: number[]
  origin?: string; destination?: string
}) {
  const comparison = data?.comparisonQuote
  const others = data?.quotes.filter(q => q.connectionKey !== comparison?.connectionKey) || []
  // Use the calendar's period-wide scale, including for additionally checked offers.
  const priceScale = createPriceBandScale(comparisonPrices)
  const getQuotePriceTone = (quote: FlexpreisQuote) => priceScale.min > 0
    ? getPriceBandClasses(priceScale.getBand(quote.amountCents / 100))
    : "border-gray-200 bg-gray-50 text-gray-950"
  const labels = getFlexpreisRouteLabels([...(comparison ? [comparison.route] : []), ...others.map(q => q.route)])
  return (
    <section className="overflow-hidden rounded-lg border border-blue-200 bg-white" aria-label="Flexpreise">
      <header className="border-b border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="flex items-center gap-2 text-base font-semibold text-blue-900">
            <Unlock className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />Flexpreise
          </h3>
          <Badge variant="secondary" className="font-medium">Ohne Zugbindung</Badge>
        </div>
      </header>
      {routeComparison && <FlexpreisBasisSelector showExplanation={false} comparison={routeComparison} onChange={onBasisChange} isLoading={isBasisLoading} />}
      <div className="space-y-3 bg-slate-100/80 p-2.5 sm:p-3" aria-busy={isPending || isChecking}>
        {comparison ? <QuoteRow quote={comparison} routeLabel={labels.get(comparison.route.key)!} comparison priceTone={getQuotePriceTone(comparison)} /> :
          isPending ? <QuoteRow comparison basis={routeComparison?.basis} routeLabel={routeComparison?.basis?.label ?? ""} origin={origin} destination={destination} /> : <p className="text-sm text-gray-700" role="status">{data?.status === "pending" ? "Flexpreis nicht abschließend geprüft." : flexpreisStatusLabel(data?.status)}</p>}
        {others.length > 0 && <>
          <h4 className="pt-2 text-sm font-semibold text-gray-800">Weitere geprüfte Flexpreise</h4>
          {others.map(quote => <QuoteRow key={quote.connectionKey} quote={quote} routeLabel={labels.get(quote.route.key)!} priceTone={getQuotePriceTone(quote)} />)}
        </>}
        {onCheckMore && <Button type="button" variant="outline" size="sm" onClick={onCheckMore} disabled={isChecking || isPending || isBasisLoading}>
          {isChecking && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {isChecking ? "Flexpreise werden geprüft …" : data?.alternativesStatus === "complete" ? "Geprüfte Flexpreise aktualisieren" : "Weitere Flexpreise prüfen"}
        </Button>}
        {(error || data?.alternativesStatus === "partial") && <p className="text-xs text-amber-800" role="alert">
          {error || "Ein Teil der Abfragen ist fehlgeschlagen. Bereits gefundene Preise bleiben sichtbar; du kannst die Prüfung erneut starten."}
        </p>}
      </div>
      <details className="group border-t border-gray-200">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 [&::-webkit-details-marker]:hidden">
          <Info className="h-4 w-4 text-gray-500" aria-hidden="true" />
          <span className="flex-1">Hinweise zur Flexpreis-Ermittlung</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <dl className="grid gap-x-4 gap-y-1 border-t border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-y-2">
          <dt className="font-semibold text-gray-800">Streckengültigkeit</dt>
          <dd className="mb-2 sm:mb-0">Die Zwischenhalte zeigen die geprüfte Verbindung, nicht die VIA-Angabe des Tickets. Welche anderen Strecken du damit nutzen darfst, lässt sich daraus nicht sicher ableiten.</dd>
          <dt className="font-semibold text-gray-800">Fahrt buchen</dt>
          <dd>Der Link öffnet die Bahn-Suche zur Abfahrtszeit. Dort wählst du die Verbindung und den Flexpreis. Es gelten der dort angezeigte Preis und die Ticketbedingungen.</dd>
        </dl>
      </details>
    </section>
  )
}
