import { Children, type ReactNode } from "react"
import { ArrowRight, ChevronDown, ChevronUp, Clock, Moon, Shuffle, Train, TrainFront, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/shared/format-price"
import { calculateDuration, getDurationMinutes } from "@/lib/train-search/day-details-utils"
import {
  JourneyTimelineHorizontal,
  JourneyTimelineVertical,
  type JourneyLeg,
} from "@/components/bestpreissuche/journey-timeline"
import { VehicleTypesSummary } from "@/components/bestpreissuche/vehicle-types-summary"

export interface RoundTripJourneyData {
  outwardDate: string
  returnDate?: string
  nights?: number
  outwardPrice: number
  returnPrice?: number
  totalPrice: number
  outwardDeparture: string
  outwardArrival: string
  returnDeparture?: string
  returnArrival?: string
  outwardOrigin?: string
  outwardDestination?: string
  returnOrigin?: string
  returnDestination?: string
  outwardTransfers?: number
  returnTransfers?: number
  outwardLegs?: JourneyLeg[]
  returnLegs?: JourneyLeg[]
}

export interface OneWayJourneyData {
  date: string
  price: number
  departure: string
  arrival: string
  origin?: string
  destination?: string
  transfers?: number
  legs?: JourneyLeg[]
}

export function DirectJourneyBadge({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  return (
    <Badge className={cn(
      "inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 font-semibold text-blue-700 shadow-none",
      compact ? "px-1.5 text-[10px]" : "px-2 text-[11px]",
      className
    )}>
      <Train className="h-3 w-3" />
      Direkt
    </Badge>
  )
}

export function JourneyBookingButton({
  direction,
  href,
  onClick,
  compactOnMobile = false,
  className,
  ariaLabel,
  label: customLabel,
  mobileLabel = "Buchen",
}: {
  direction: "one-way" | "outward" | "return"
  href?: string
  onClick?: () => void
  compactOnMobile?: boolean
  className?: string
  ariaLabel?: string
  label?: string
  mobileLabel?: string
}) {
  const label = customLabel || (direction === "one-way"
    ? "Fahrt buchen"
    : direction === "outward"
      ? "Hinfahrt buchen"
      : "Rückfahrt buchen")
  const buttonClasses = cn(
    "h-8 px-2 text-xs",
    direction !== "return"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "border-blue-200 bg-white text-blue-700 hover:bg-blue-50",
    className
  )
  const content = (
    <>
      <Train className="h-3.5 w-3.5" />
      {compactOnMobile ? (
        <>
          <span className="sm:hidden">{mobileLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : label}
    </>
  )

  if (href) {
    return (
      <Button asChild size="sm" variant={direction === "return" ? "outline" : "default"} className={buttonClasses}>
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel || label} title={label}>{content}</a>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={direction === "return" ? "outline" : "default"}
      className={buttonClasses}
      onClick={onClick}
      title={label}
      aria-label={ariaLabel || label}
    >
      {content}
    </Button>
  )
}

export function JourneyBookingButtonGroup({
  children,
  label,
  compactOnMobile = false,
}: {
  children: ReactNode
  label?: string
  compactOnMobile?: boolean
}) {
  const actions = Children.toArray(children)

  return (
    <div className={cn(
      "grid gap-2 sm:flex sm:w-auto sm:items-center",
      compactOnMobile ? "w-auto" : "w-full",
      actions.length > 1 ? "grid-cols-2" : "grid-cols-1"
    )}>
      {label && <span className="hidden text-xs font-semibold text-blue-700 sm:inline">{label}</span>}
      {actions.map((child, index) => (
        <div key={index} className="min-w-0 [&>*]:w-full">{child}</div>
      ))}
    </div>
  )
}

export function JourneyResultActionBar({
  bookingActions,
  secondaryActions,
  layout = "default",
  dense = false,
  secondaryColumns = 1,
  inlineBookingOnMobile = false,
}: {
  bookingActions?: ReactNode
  secondaryActions?: ReactNode
  layout?: "default" | "table"
  dense?: boolean
  secondaryColumns?: 1 | 2
  inlineBookingOnMobile?: boolean
}) {
  const tableLayout = layout === "table"

  return (
    <div className={cn(
      "gap-2 border-t border-gray-100 bg-gray-50/70 px-3",
      tableLayout
        ? "flex flex-col py-2 md:grid md:grid-cols-[minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(10rem,1.5fr)_minmax(7rem,0.85fr)_minmax(7rem,0.85fr)] md:items-center md:gap-4 md:px-4"
        : cn(
            inlineBookingOnMobile
              ? "grid grid-cols-[minmax(0,1fr)_auto] items-center sm:flex sm:flex-row"
              : "flex flex-col sm:flex-row sm:items-center",
            "sm:justify-between",
            dense ? "py-1" : "py-1.5 sm:px-4"
          )
    )}>
      <div className={cn(
        tableLayout
          ? "md:col-start-5 md:row-start-1 md:flex md:justify-end"
          : cn("sm:order-2", inlineBookingOnMobile && "col-start-2 row-start-1 justify-self-end")
      )}>
        {bookingActions}
      </div>
      <div className={cn(
        "grid w-full gap-2",
        secondaryColumns === 2 ? "grid-cols-2" : "grid-cols-1",
        tableLayout
          ? "md:col-span-4 md:col-start-1 md:row-start-1 md:flex md:w-auto md:flex-wrap md:items-center md:justify-start md:gap-x-4"
          : cn(
              "sm:order-1 sm:flex sm:w-auto sm:items-center sm:justify-start",
              inlineBookingOnMobile && "col-start-1 row-start-1 min-w-0"
            )
      )}>
        {secondaryActions}
      </div>
    </div>
  )
}

export function JourneyDisclosureButton({
  icon,
  label,
  expandedLabel,
  mobileLabel,
  expanded,
  onClick,
  disabled = false,
  controlsId,
  layout = "default",
}: {
  icon: ReactNode
  label: string
  expandedLabel: string
  mobileLabel: string
  expanded: boolean
  onClick: () => void
  disabled?: boolean
  controlsId?: string
  layout?: "default" | "table"
}) {
  const tableLayout = layout === "table"

  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-300",
        tableLayout
          ? "md:min-h-0 md:justify-start md:gap-1.5 md:rounded-none md:border-0 md:bg-transparent md:px-0 md:text-xs"
          : "sm:min-h-0 sm:justify-start sm:gap-1.5 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0 sm:text-xs"
      )}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      aria-controls={controlsId}
    >
      {icon}
      <span className={tableLayout ? "md:hidden" : "sm:hidden"}>{mobileLabel}</span>
      <span className={tableLayout ? "hidden md:inline" : "hidden sm:inline"}>
        {expanded ? expandedLabel : label}
      </span>
      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </button>
  )
}

function formatFullDate(value?: string) {
  if (!value) return "–"
  return new Date(value).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function formatTime(value?: string) {
  if (!value) return "–"
  return new Date(value).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getRoundTripTravelMinutes(journey: RoundTripJourneyData) {
  if (
    !journey.outwardDeparture ||
    !journey.outwardArrival ||
    !journey.returnDeparture ||
    !journey.returnArrival
  ) return null

  return getDurationMinutes(journey.outwardDeparture, journey.outwardArrival) +
    getDurationMinutes(journey.returnDeparture, journey.returnArrival)
}

function formatTravelMinutes(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return null
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}min`
}

function transferLabel(transfers?: number) {
  if (transfers === 0) return "Direkt"
  if (typeof transfers !== "number") return "–"
  return `${transfers} Umstieg${transfers === 1 ? "" : "e"}`
}

function TransferFact({
  transfers,
  mobileCompact = false,
  total = false,
  onToggle,
  expanded = false,
  controlsId,
}: {
  transfers?: number
  mobileCompact?: boolean
  total?: boolean
  onToggle?: () => void
  expanded?: boolean
  controlsId?: string
}) {
  const direct = transfers === 0
  const factClasses = cn(
    "inline-flex items-center gap-1 whitespace-nowrap",
    direct ? "font-semibold text-blue-700" : "text-gray-500"
  )
  const content = (
    <>
      <Shuffle className={cn(
        "h-3.5 w-3.5 shrink-0 transition-colors",
        direct ? "text-blue-600" : "text-gray-400 group-hover:text-blue-500 group-focus-visible:text-blue-500"
      )} />
      {mobileCompact ? (
        <>
          <strong className={cn("font-semibold sm:hidden", direct ? "text-blue-700" : "text-gray-700")}>
            {direct ? "Direkt" : transfers}
          </strong>
          <span className={cn("hidden sm:inline", direct && "font-semibold text-blue-700")}>{transferLabel(transfers)}</span>
        </>
      ) : transferLabel(transfers)}
    </>
  )

  if (!onToggle) return <span className={factClasses}>{content}</span>

  const factDescription = direct
    ? "Direktverbindung ohne Umstieg"
    : `${transferLabel(transfers)}${total ? " insgesamt" : ""}`
  const actionLabel = expanded ? "Fahrtverlauf schließen" : "Fahrtverlauf anzeigen"

  return (
    <button
      type="button"
      className={cn(
        factClasses,
        "group pointer-events-auto -mx-1.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
      )}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-label={`${actionLabel}: ${factDescription}`}
      title={actionLabel}
    >
      {content}
    </button>
  )
}

function getArrivalDayOffset(departure?: string, arrival?: string) {
  const departureDate = departure?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const arrivalDate = arrival?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!departureDate || !arrivalDate) return 0

  const [departureYear, departureMonth, departureDay] = departureDate.split("-").map(Number)
  const [arrivalYear, arrivalMonth, arrivalDay] = arrivalDate.split("-").map(Number)
  const offset = Math.round((
    Date.UTC(arrivalYear, arrivalMonth - 1, arrivalDay) -
    Date.UTC(departureYear, departureMonth - 1, departureDay)
  ) / 86_400_000)

  return Math.max(0, offset)
}

function getStayNights(outwardDate?: string, returnDate?: string) {
  const outwardDay = outwardDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const returnDay = returnDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!outwardDay || !returnDay) return undefined

  const [outwardYear, outwardMonth, outwardDateOfMonth] = outwardDay.split("-").map(Number)
  const [returnYear, returnMonth, returnDateOfMonth] = returnDay.split("-").map(Number)
  const nightCount = Math.round((
    Date.UTC(returnYear, returnMonth - 1, returnDateOfMonth) -
    Date.UTC(outwardYear, outwardMonth - 1, outwardDateOfMonth)
  ) / 86_400_000)

  return nightCount >= 0 ? nightCount : undefined
}

function JourneySummaryHeader({
  leadingContent,
  mobileBadges,
  desktopBadges,
  price,
  priceTone,
  totalDuration,
  totalTransfers,
  highlightTotalDuration = false,
  onTransfersClick,
  transfersExpanded = false,
  transfersControlsId,
  stackOnMobile = false,
}: {
  leadingContent?: ReactNode
  mobileBadges?: ReactNode
  desktopBadges?: ReactNode
  price: number
  priceTone: string
  totalDuration?: string | null
  totalTransfers?: number | null
  highlightTotalDuration?: boolean
  onTransfersClick?: () => void
  transfersExpanded?: boolean
  transfersControlsId?: string
  stackOnMobile?: boolean
}) {
  const showTotals = Boolean(totalDuration) || typeof totalTransfers === "number"
  const leadingBlock = (
    <div className="flex min-w-0 items-center gap-3">
      {leadingContent && <div className="min-w-0">{leadingContent}</div>}
      <span className="contents sm:hidden">{mobileBadges}</span>
      <span className="hidden shrink-0 flex-wrap items-center gap-1.5 sm:flex">{desktopBadges}</span>
    </div>
  )
  const totalsBlock = (
    <>
      {totalDuration && (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-gray-500"
          aria-label={highlightTotalDuration
            ? `Schnellste Verbindung, Gesamtreisezeit ${totalDuration}`
            : `Gesamtreisezeit ${totalDuration}`}
        >
          {highlightTotalDuration ? (
            <Zap className="h-3.5 w-3.5 shrink-0 text-purple-600" />
          ) : (
            <Clock className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          )}
          <strong className={cn(
            "font-semibold text-gray-700",
            highlightTotalDuration && "text-purple-700"
          )}>{totalDuration}</strong>
        </span>
      )}
      {totalDuration && typeof totalTransfers === "number" && (
        <span className="text-xs text-gray-300" aria-hidden="true">·</span>
      )}
      {typeof totalTransfers === "number" && (
        <span className="text-[11px]">
          <TransferFact
            transfers={totalTransfers}
            mobileCompact
            total
            onToggle={onTransfersClick}
            expanded={transfersExpanded}
            controlsId={transfersControlsId}
          />
        </span>
      )}
    </>
  )
  const priceBlock = (
    <span
      className={cn(
        "shrink-0 rounded-md border px-1.5 py-0.5 text-lg font-bold leading-tight tabular-nums sm:px-2 sm:py-1 sm:text-xl",
        priceTone
      )}
      aria-label={`${showTotals ? "Gesamtpreis" : "Preis"} ${formatPrice(price)}`}
    >
      {formatPrice(price)}
    </span>
  )

  if (stackOnMobile) {
    return (
      <header className="grid min-h-[3.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-gray-200 bg-white/80 px-3 py-1.5 sm:flex sm:gap-2 sm:px-4">
        <div className="col-start-1 min-w-0 sm:contents">
          {leadingBlock}
        </div>
        <div className="col-start-2 flex shrink-0 items-center gap-1.5 sm:contents">
          {showTotals && (
            <div className="flex shrink-0 items-center gap-1 sm:ml-auto sm:gap-1.5">
              {totalsBlock}
            </div>
          )}
          {showTotals && (
            <span className="text-xs text-gray-300" aria-hidden="true">·</span>
          )}
          <div className="self-center">{priceBlock}</div>
        </div>
      </header>
    )
  }

  return (
    <header className="flex min-h-[3.25rem] items-center justify-between gap-3 border-b border-gray-200 bg-white/80 px-3 py-1.5 sm:px-4">
      {leadingBlock}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {totalsBlock}
        {showTotals && <span className="text-xs text-gray-300" aria-hidden="true">·</span>}
        {priceBlock}
      </div>
    </header>
  )
}

function JourneyConnectionOverview({
  departure,
  arrival,
  origin,
  destination,
  transfers,
  legs,
  showVehicleTypes = true,
  hideVehicleTypesOnMobile = false,
  highlightDuration = false,
  onTransfersClick,
  transfersExpanded = false,
  transfersControlsId,
  widthReferenceOrigin,
  widthReferenceDestination,
}: {
  departure?: string
  arrival?: string
  origin?: string
  destination?: string
  transfers?: number
  legs?: JourneyLeg[]
  showVehicleTypes?: boolean
  hideVehicleTypesOnMobile?: boolean
  highlightDuration?: boolean
  onTransfersClick?: () => void
  transfersExpanded?: boolean
  transfersControlsId?: string
  widthReferenceOrigin?: string
  widthReferenceDestination?: string
}) {
  const arrivalDayOffset = getArrivalDayOffset(departure, arrival)

  return (
    <div className={cn(
      "grid w-full min-w-0 items-center",
      showVehicleTypes
        ? "grid-cols-1 gap-y-1.5 sm:grid-cols-[minmax(18rem,max-content)_minmax(0,1fr)] sm:gap-x-8 sm:gap-y-0 lg:gap-x-10"
        : "grid-cols-[minmax(0,18rem)_minmax(0,1fr)] gap-x-8 sm:grid-cols-[minmax(18rem,max-content)_minmax(0,1fr)] lg:gap-x-10"
    )}>
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-x-1 sm:w-fit sm:min-w-[18rem] sm:grid-cols-[minmax(0,max-content)_1.25rem_minmax(0,max-content)] sm:justify-between sm:gap-x-2">
          <div className="min-w-0 sm:max-w-[13rem]">
            <div className="text-lg font-bold leading-none tabular-nums text-gray-950">{formatTime(departure)}</div>
            <div className="mt-1.5 truncate text-xs font-medium text-gray-700" title={origin}>{origin || "–"}</div>
          </div>
          <ArrowRight className="h-4 w-4 justify-self-center text-blue-400" />
          <div className="min-w-0 pr-3 text-right sm:max-w-[13rem] sm:pr-0">
            <div className="relative inline-block text-lg font-bold leading-none tabular-nums text-gray-950">
              {formatTime(arrival)}
              {arrivalDayOffset > 0 && (
                <sup
                  className="absolute left-full top-0 ml-0.5 text-[10px] font-semibold leading-none text-blue-600"
                  aria-label={`Ankunft ${arrivalDayOffset === 1 ? "am Folgetag" : `${arrivalDayOffset} Tage später`}`}
                  title={arrivalDayOffset === 1 ? "Ankunft am Folgetag" : `Ankunft ${arrivalDayOffset} Tage später`}
                >
                  +{arrivalDayOffset}
                </sup>
              )}
            </div>
            <div className="mt-1.5 truncate text-xs font-medium text-gray-700" title={destination}>{destination || "–"}</div>
          </div>
          {widthReferenceOrigin && (
            <span className="pointer-events-none invisible col-start-1 row-start-2 hidden h-0 max-w-[13rem] whitespace-nowrap text-xs font-medium sm:block" aria-hidden="true">
              {widthReferenceOrigin}
            </span>
          )}
          {widthReferenceDestination && (
            <span className="pointer-events-none invisible col-start-3 row-start-2 hidden h-0 max-w-[13rem] whitespace-nowrap text-xs font-medium sm:block" aria-hidden="true">
              {widthReferenceDestination}
            </span>
          )}
        </div>
      <div className={cn(
        "min-w-0 items-center text-[11px] text-gray-600 sm:grid sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-8 sm:gap-y-0 sm:text-xs lg:gap-x-10",
        hideVehicleTypesOnMobile
          ? "grid grid-cols-1"
          : "flex flex-wrap gap-x-5 gap-y-1.5"
      )}>
        <div className={cn(
          "flex shrink-0 items-center gap-2",
          showVehicleTypes && "sm:w-max sm:justify-self-center sm:flex-col sm:items-start sm:gap-1",
          !showVehicleTypes && "flex-col items-start gap-1"
        )}>
          <span className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap font-medium text-gray-700",
            highlightDuration && "font-semibold text-purple-700"
          )}>
            {highlightDuration ? (
              <Zap className="h-3.5 w-3.5 text-purple-600" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-gray-400" />
            )}
            {departure && arrival ? calculateDuration(departure, arrival) : "–"}
          </span>
          <TransferFact
            transfers={transfers}
            onToggle={onTransfersClick}
            expanded={transfersExpanded}
            controlsId={transfersControlsId}
          />
        </div>
        {showVehicleTypes && (
          <div className={cn(
            hideVehicleTypesOnMobile
              ? "hidden sm:block"
              : "w-max max-w-full shrink-0 sm:w-auto sm:max-w-none"
          )}>
            <VehicleTypesSummary interval={{ abschnitte: legs || [] }} />
          </div>
        )}
      </div>
    </div>
  )
}

export function OneWayJourneySummary({
  journey,
  leadingContent,
  mobileBadges,
  desktopBadges,
  priceTone,
  showDate = false,
  priceInMobileHeader = false,
  highlightDuration = false,
  onTransfersClick,
  transfersExpanded = false,
  transfersControlsId,
  stationWidthReference,
}: {
  journey: OneWayJourneyData
  leadingContent?: ReactNode
  mobileBadges?: ReactNode
  desktopBadges?: ReactNode
  priceTone: string
  layout?: "card" | "table"
  showMobileRoute?: boolean
  showDate?: boolean
  priceInMobileHeader?: boolean
  highlightDuration?: boolean
  onTransfersClick?: () => void
  transfersExpanded?: boolean
  transfersControlsId?: string
  stationWidthReference?: { origin?: string; destination?: string }
}) {
  const hasHeaderRow = Boolean(leadingContent || mobileBadges || desktopBadges || priceInMobileHeader)

  return (
    <div>
      {hasHeaderRow && (
        <div className={cn(
          "min-h-9 min-w-0 items-center gap-3 border-b border-gray-200 bg-white/80 px-3 py-1.5 sm:flex sm:px-4",
          priceInMobileHeader ? "grid grid-cols-[minmax(0,1fr)_auto]" : "flex"
        )}>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-3">
            {leadingContent && <div className="min-w-0">{leadingContent}</div>}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:hidden">{mobileBadges}</div>
            <div className="hidden shrink-0 flex-wrap items-center gap-1.5 sm:flex">{desktopBadges}</div>
          </div>
          {priceInMobileHeader && (
            <div className={cn("shrink-0 rounded-md border px-2 py-1 text-right shadow-sm sm:hidden", priceTone)} aria-label={`Preis ${formatPrice(journey.price)}`}>
              <span className="whitespace-nowrap text-lg font-bold leading-none tabular-nums">{formatPrice(journey.price)}</span>
            </div>
          )}
        </div>
      )}
      <section className={cn(
        "items-center gap-3 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5 sm:px-4",
        priceInMobileHeader ? "block" : "grid grid-cols-[minmax(0,1fr)_auto]"
      )} aria-label="Einfache Fahrt">
        <div className="min-w-0">
          {showDate && (
            <div className="mb-2 text-xs font-semibold text-gray-700">
              {formatFullDate(journey.date)}
            </div>
          )}
          <JourneyConnectionOverview
            departure={journey.departure}
            arrival={journey.arrival}
            origin={journey.origin}
            destination={journey.destination}
            transfers={journey.transfers}
            legs={journey.legs}
            highlightDuration={highlightDuration}
            onTransfersClick={onTransfersClick}
            transfersExpanded={transfersExpanded}
            transfersControlsId={transfersControlsId}
            widthReferenceOrigin={stationWidthReference?.origin}
            widthReferenceDestination={stationWidthReference?.destination}
          />
        </div>
        <div
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 text-right shadow-sm sm:block sm:px-3",
            priceInMobileHeader ? "hidden" : "block",
            priceTone
          )}
          aria-label={`Preis ${formatPrice(journey.price)}`}
        >
          <span className="whitespace-nowrap text-lg font-bold leading-none tabular-nums sm:text-xl">
            {formatPrice(journey.price)}
          </span>
        </div>
      </section>
    </div>
  )
}

export function OneWayJourneyDetails({ journey, id }: { journey: OneWayJourneyData; id?: string }) {
  const legs = journey.legs || []
  if (legs.length === 0) return null

  return (
    <div id={id} className="border-t border-gray-200 bg-white p-3 sm:p-4">
      <section className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Fahrtverlauf</h4>
        <div className="hidden md:block"><JourneyTimelineHorizontal legs={legs} /></div>
        <div className="md:hidden"><JourneyTimelineVertical legs={legs} /></div>
      </section>
    </div>
  )
}

export function OneWayJourneySummaryPlaceholder({
  showDate = false,
  showBadges = false,
  priceInMobileHeader = false,
}: {
  layout?: "card" | "table"
  showDate?: boolean
  showBadges?: boolean
  priceInMobileHeader?: boolean
}) {
  return (
    <div className="animate-pulse motion-reduce:animate-none">
      {(showBadges || priceInMobileHeader) && (
        <div className={cn(
          "min-h-9 items-center gap-3 border-b border-gray-200 bg-white/80 px-3 py-1.5 sm:flex sm:px-4",
          priceInMobileHeader ? "grid grid-cols-[minmax(0,1fr)_auto]" : "flex"
        )}>
          <div className="h-5 w-24 rounded-full bg-blue-100" />
          {priceInMobileHeader && <div className="h-8 w-20 rounded-md border border-green-200 bg-green-100 sm:hidden" />}
        </div>
      )}
      <div className={cn(
        "items-center gap-3 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5 sm:px-4",
        priceInMobileHeader ? "block" : "grid grid-cols-[minmax(0,1fr)_auto]"
      )}>
        <div className="min-w-0">
          {showDate && <div className="mb-2 h-4 w-32 rounded bg-gray-100" />}
          <div className="grid w-full grid-cols-1 items-center gap-y-1.5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-x-12 sm:gap-y-0 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-x-16">
            <div className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-x-1 sm:gap-x-2">
              <div>
                <div className="h-5 w-14 rounded bg-gray-200" />
                <div className="mt-1.5 h-3 w-20 max-w-full rounded bg-gray-100" />
              </div>
              <ArrowRight className="h-4 w-4 text-gray-300" />
              <div>
                <div className="ml-auto h-5 w-14 rounded bg-gray-200" />
                <div className="ml-auto mt-1.5 h-3 w-24 max-w-full rounded bg-gray-100" />
              </div>
            </div>
            <div className="grid grid-cols-1 items-center sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-12 lg:gap-x-16">
              <div className="flex shrink-0 items-center gap-2 sm:w-max sm:justify-self-center sm:flex-col sm:items-start sm:gap-1">
                <div className="h-4 w-16 rounded bg-gray-200" />
                <div className="h-4 w-16 rounded bg-gray-100" />
              </div>
              <div className="hidden h-4 w-14 rounded bg-blue-100 sm:block" />
            </div>
          </div>
        </div>
        <div className={cn(
          "h-8 w-20 rounded-md border border-green-200 bg-green-100 sm:block sm:w-24",
          priceInMobileHeader ? "hidden" : "block"
        )} />
        <div className="col-span-2 mt-1.5 h-4 w-28 rounded bg-blue-100 sm:hidden" />
      </div>
    </div>
  )
}

function RoundTripTimelineNode({ position }: { position: "first" | "last" }) {
  return (
    <div className="relative">
      <span
        className={cn(
          "absolute left-1/2 w-px -translate-x-1/2 bg-blue-200",
          position === "first" ? "top-1/2 -bottom-1" : "-top-1 bottom-1/2"
        )}
      />
      <span className="absolute left-1/2 top-1/2 z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-blue-400 bg-white">
        <TrainFront className="h-3.5 w-3.5 text-blue-700" />
      </span>
    </div>
  )
}

function RoundTripDirectionPanel({
  direction,
  date,
  departure,
  arrival,
  price,
  transfers,
  legs,
  origin,
  destination,
  widthReferenceOrigin,
  widthReferenceDestination,
  onTransfersClick,
  transfersExpanded = false,
  transfersControlsId,
  position,
  dense,
}: {
  direction: "Hinfahrt" | "Rückfahrt"
  date?: string
  departure?: string
  arrival?: string
  price?: number
  transfers?: number
  legs?: JourneyLeg[]
  origin?: string
  destination?: string
  widthReferenceOrigin?: string
  widthReferenceDestination?: string
  onTransfersClick?: () => void
  transfersExpanded?: boolean
  transfersControlsId?: string
  position: "first" | "last"
  dense?: boolean
}) {
  const departureStation = legs?.[0]?.abfahrtsOrt || origin
  const arrivalStation = legs?.[legs.length - 1]?.ankunftsOrt || destination

  return (
    <section className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-0.5 sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:gap-x-3" aria-label={direction}>
      <RoundTripTimelineNode position={position} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-lg bg-slate-100 sm:grid-cols-[10.5rem_minmax(0,1fr)_6.5rem] sm:items-stretch">
        <div className={cn(
          "min-w-0 px-3 pt-2 sm:flex sm:flex-col sm:justify-center sm:bg-blue-100/60 sm:py-2",
          dense && "sm:py-1.5"
        )}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-blue-700">{direction}</div>
          <div className="mt-0.5 whitespace-nowrap text-sm font-bold leading-tight text-blue-950 sm:text-base">{formatFullDate(date)}</div>
        </div>

        <div className={cn(
          "col-span-2 row-start-2 min-w-0 px-3 pb-2 pt-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:px-4 sm:py-2",
          dense && "sm:py-1.5"
        )}>
          <JourneyConnectionOverview
            departure={departure}
            arrival={arrival}
            origin={departureStation}
            destination={arrivalStation}
            transfers={transfers}
            legs={legs}
            onTransfersClick={onTransfersClick}
            transfersExpanded={transfersExpanded}
            transfersControlsId={transfersControlsId}
            widthReferenceOrigin={widthReferenceOrigin}
            widthReferenceDestination={widthReferenceDestination}
          />
        </div>

        <div className="col-start-2 row-start-1 self-center px-3 text-right sm:col-start-3">
          <div className="text-[13px] font-medium tabular-nums text-gray-700">{formatPrice(price)}</div>
        </div>
      </div>
    </section>
  )
}

function RoundTripStayConnector({ nights }: { nights?: number }) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:gap-x-3">
      <div className="relative min-h-7">
        <span className="absolute -inset-y-1 left-1/2 w-px -translate-x-1/2 bg-blue-200" />
        <span className="absolute left-1/2 top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-green-300 bg-green-50 text-green-700">
          <Moon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="flex min-h-7 items-center gap-3">
        <span className="whitespace-nowrap text-xs font-medium text-green-800">
          {typeof nights === "number" ? (
            <><strong className="font-bold">{nights}</strong><span className="ml-1">{nights === 1 ? "Nacht" : "Nächte"} Aufenthalt</span></>
          ) : "Hin- und Rückfahrt"}
        </span>
        <span className="h-px flex-1 bg-gray-100" />
      </div>
    </div>
  )
}

export function RoundTripJourneySummary({
  journey,
  leadingContent,
  mobileBadges,
  desktopBadges,
  priceTone,
  dense = false,
  stackHeaderOnMobile = true,
  isFastestJourney = false,
  onTransfersClick,
  transfersExpanded = false,
  transfersControlsId,
  stationWidthReference,
}: {
  journey: RoundTripJourneyData
  leadingContent?: ReactNode
  mobileBadges?: ReactNode
  desktopBadges?: ReactNode
  priceTone: string
  dense?: boolean
  stackHeaderOnMobile?: boolean
  isFastestJourney?: boolean
  onTransfersClick?: () => void
  transfersExpanded?: boolean
  transfersControlsId?: string
  stationWidthReference?: { origin?: string; destination?: string }
}) {
  const totalTravelTime = formatTravelMinutes(getRoundTripTravelMinutes(journey))
  const totalTransfers = typeof journey.outwardTransfers === "number" && typeof journey.returnTransfers === "number"
    ? journey.outwardTransfers + journey.returnTransfers
    : null

  return (
    <div>
      <JourneySummaryHeader
        leadingContent={leadingContent}
        mobileBadges={mobileBadges}
        desktopBadges={desktopBadges}
        price={journey.totalPrice}
        priceTone={priceTone}
        totalDuration={totalTravelTime}
        totalTransfers={totalTransfers}
        highlightTotalDuration={isFastestJourney}
        onTransfersClick={onTransfersClick}
        transfersExpanded={transfersExpanded}
        transfersControlsId={transfersControlsId}
        stackOnMobile={stackHeaderOnMobile}
      />
      <div className={cn("p-2.5 sm:p-3.5", dense && "sm:p-2.5")}>
        <div className="relative">
          <RoundTripDirectionPanel
            direction="Hinfahrt"
            date={journey.outwardDate}
            departure={journey.outwardDeparture}
            arrival={journey.outwardArrival}
            price={journey.outwardPrice}
            transfers={journey.outwardTransfers}
            legs={journey.outwardLegs}
            origin={journey.outwardOrigin}
            destination={journey.outwardDestination}
            widthReferenceOrigin={stationWidthReference?.origin}
            widthReferenceDestination={stationWidthReference?.destination}
            onTransfersClick={onTransfersClick}
            transfersExpanded={transfersExpanded}
            transfersControlsId={transfersControlsId}
            position="first"
            dense={dense}
          />
          <RoundTripStayConnector nights={journey.nights} />
          <RoundTripDirectionPanel
            direction="Rückfahrt"
            date={journey.returnDate}
            departure={journey.returnDeparture}
            arrival={journey.returnArrival}
            price={journey.returnPrice}
            transfers={journey.returnTransfers}
            legs={journey.returnLegs}
            origin={journey.returnOrigin}
            destination={journey.returnDestination}
            widthReferenceOrigin={stationWidthReference?.destination}
            widthReferenceDestination={stationWidthReference?.origin}
            onTransfersClick={onTransfersClick}
            transfersExpanded={transfersExpanded}
            transfersControlsId={transfersControlsId}
            position="last"
            dense={dense}
          />
        </div>
      </div>
    </div>
  )
}

export function RoundTripJourneyDetails({ journey, id }: { journey: RoundTripJourneyData; id?: string }) {
  const outwardLegs = journey.outwardLegs || []
  const returnLegs = journey.returnLegs || []

  if (outwardLegs.length === 0 && returnLegs.length === 0) return null

  return (
    <div id={id} className="grid gap-3 border-t border-gray-200 bg-white p-3 sm:p-4 lg:grid-cols-2">
      {([
        ["Fahrtverlauf Hinfahrt", outwardLegs],
        ["Fahrtverlauf Rückfahrt", returnLegs],
      ] as const).map(([title, legs]) => (
        <section key={title} className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</h4>
          {legs.length > 0 ? (
            <>
              <div className="hidden md:block"><JourneyTimelineHorizontal legs={legs} /></div>
              <div className="md:hidden"><JourneyTimelineVertical legs={legs} /></div>
            </>
          ) : <p className="text-xs text-gray-500">Keine Detaildaten verfügbar.</p>}
        </section>
      ))}
    </div>
  )
}

export function RoundTripJourneySummaryPlaceholder({
  outwardDate,
  returnDate,
  nights,
  dense = false,
  mobileBadge,
  desktopBadge,
  stackHeaderOnMobile = true,
}: {
  outwardDate?: string
  returnDate?: string
  nights?: number
  dense?: boolean
  mobileBadge?: ReactNode
  desktopBadge?: ReactNode
  stackHeaderOnMobile?: boolean
}) {
  const resolvedNights = typeof nights === "number" ? nights : getStayNights(outwardDate, returnDate)

  const DirectionPlaceholder = ({ direction, date }: { direction: string; date?: string }) => (
    <div className={cn(
      "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-0.5 sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:gap-x-3",
      dense ? "sm:min-h-[3.875rem]" : "sm:min-h-[4.125rem]"
    )}>
      <div className="relative">
        <span className="absolute left-1/2 top-1/2 z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-200 bg-white" />
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-lg bg-slate-100 sm:grid-cols-[10.5rem_minmax(0,1fr)_6.5rem] sm:items-stretch">
        <div className={cn("min-w-0 px-3 pt-2 sm:bg-blue-100/40 sm:py-2", dense && "sm:py-1.5")}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-blue-300">{direction}</div>
          {date
            ? <div className="mt-0.5 whitespace-nowrap text-sm font-bold text-gray-400 sm:text-base">{formatFullDate(date)}</div>
            : <div className="mt-1 h-4 w-32 rounded bg-gray-100" />}
        </div>
        <div className={cn(
          "col-span-2 row-start-2 min-w-0 px-3 pb-2 pt-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:px-4 sm:py-2",
          dense && "sm:py-1.5"
        )}>
          <div className="grid w-full grid-cols-1 items-center gap-y-1.5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-x-12 sm:gap-y-0 lg:gap-x-16">
            <div className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-x-1 sm:gap-x-2">
              <div><div className="h-5 w-14 rounded bg-gray-200" /><div className="mt-1.5 h-3 w-20 max-w-full rounded bg-gray-100" /></div>
              <ArrowRight className="h-4 w-4 text-gray-300" />
              <div><div className="ml-auto h-5 w-14 rounded bg-gray-200" /><div className="ml-auto mt-1.5 h-3 w-20 max-w-full rounded bg-gray-100" /></div>
            </div>
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-x-12 lg:gap-x-16">
              <div className="flex shrink-0 items-center gap-2 sm:w-max sm:justify-self-center sm:flex-col sm:items-start sm:gap-1">
                <div className="h-4 w-16 rounded bg-gray-200" />
                <div className="h-4 w-16 rounded bg-gray-100" />
              </div>
              <div className="h-4 w-14 rounded bg-blue-100" />
            </div>
          </div>
        </div>
        <div className="col-start-2 row-start-1 self-center px-3 text-right sm:col-start-3">
          <div className="ml-auto h-3.5 w-14 rounded bg-gray-100" />
        </div>
      </div>
    </div>
  )

  return (
    <div className="animate-pulse">
      {stackHeaderOnMobile ? (
        <div className="grid min-h-[3.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-gray-200 bg-white/80 px-3 py-1.5 sm:flex sm:gap-2 sm:px-4">
          <div className="col-start-1 min-w-0 sm:contents">
            <div className="sm:hidden">{mobileBadge || <div className="h-5 w-24 rounded-full bg-blue-100" />}</div>
            <div className="hidden sm:block">{desktopBadge || <div className="h-5 w-28 rounded-full bg-blue-100" />}</div>
          </div>
          <div className="col-start-2 flex shrink-0 items-center gap-1.5 sm:contents">
            <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
              <div className="h-3 w-16 rounded bg-gray-100" />
              <div className="h-3 w-8 rounded bg-gray-100" />
            </div>
            <div className="h-3 w-1 rounded bg-gray-100" />
            <div className="h-8 w-20 self-center rounded-md border border-green-200 bg-green-100" />
          </div>
        </div>
      ) : (
        <div className="flex min-h-[3.25rem] items-center justify-between gap-3 border-b border-gray-200 bg-white/80 px-3 py-1.5 sm:px-4">
          <div className="sm:hidden">{mobileBadge || <div className="h-5 w-24 rounded-full bg-blue-100" />}</div>
          <div className="hidden sm:block">{desktopBadge || <div className="h-5 w-28 rounded-full bg-blue-100" />}</div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-16 rounded bg-gray-100" />
            <div className="h-3 w-8 rounded bg-gray-100" />
            <div className="h-8 w-20 rounded-md border border-green-200 bg-green-100" />
          </div>
        </div>
      )}
      <div className={cn("p-2.5 sm:p-3.5", dense && "sm:p-2.5")}>
        <div className="relative">
          <span className="absolute inset-y-0 left-3 w-px -translate-x-1/2 bg-blue-100 sm:left-3.5" />
          <DirectionPlaceholder direction="Hinfahrt" date={outwardDate} />
          <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:gap-x-3">
            <div className="relative min-h-7"><span className="absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-green-200 bg-green-50" /></div>
            <div className="flex min-h-7 items-center gap-3">
              {typeof resolvedNights === "number" ? (
                <span className="whitespace-nowrap text-xs font-medium text-green-800">
                  <strong className="font-bold">{resolvedNights}</strong>
                  <span className="ml-1">{resolvedNights === 1 ? "Nacht" : "Nächte"} Aufenthalt</span>
                </span>
              ) : <div className="h-3 w-24 rounded bg-gray-100" />}
              <span className="h-px flex-1 bg-gray-100" />
            </div>
          </div>
          <DirectionPlaceholder direction="Rückfahrt" date={returnDate} />
        </div>
      </div>
    </div>
  )
}
