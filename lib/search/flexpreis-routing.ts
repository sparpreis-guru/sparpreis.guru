export type FlexpreisProductClass = "HIGH_SPEED" | "INTERCITY" | "REGIONAL"

export interface FlexpreisRouteStation {
  name: string
  extId?: string
}

export interface FlexpreisRoute {
  key: string
  origin: FlexpreisRouteStation
  destination: FlexpreisRouteStation
  /** Planmäßige Zwischenhalte der repräsentativen Verbindung. */
  viaStations: FlexpreisRouteStation[]
  productClass: FlexpreisProductClass
  transfers: number
  durationMinutes: number | null
  representativeDeparture: string
  representativeArrival: string
  direct: boolean
  /** False nur bei eindeutig nicht DB-Flexpreis-fähigen Produkten wie FLX. */
  flexpreisCandidate: boolean
}

export interface FlexpreisRoutingLeg {
  abfahrtsOrt?: string
  ankunftsOrt?: string
  abfahrtsOrtExtId?: string
  ankunftsOrtExtId?: string
  halte?: Array<{
    name?: string
    extId?: string
  }>
  verkehrsmittel?: {
    produktGattung?: string
    kategorie?: string
    name?: string
    mittelText?: string
  }
}

const HIGH_SPEED_MARKERS = ["ICE", "ECE", "TGV", "RJX", "RJT", "RAILJET", "RJ"]
const INTERCITY_MARKERS = ["INTERCITY", "EUROCITY", "NIGHTJET", "ICEC", "IC", "EC", "IR", "NJ", "EN", "DNZ"]

function normalizedProductValue(value: string | undefined): string {
  return (value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function includesProductMarker(value: string, markers: string[]): boolean {
  return markers.some(marker => value === marker || value.startsWith(marker))
}

function getLegProductClass(leg: FlexpreisRoutingLeg): FlexpreisProductClass {
  const values = [
    normalizedProductValue(leg.verkehrsmittel?.produktGattung),
    normalizedProductValue(leg.verkehrsmittel?.kategorie),
  ].filter(Boolean)

  if (values.some(value => includesProductMarker(value, HIGH_SPEED_MARKERS))) {
    return "HIGH_SPEED"
  }
  if (values.some(value => includesProductMarker(value, INTERCITY_MARKERS))) {
    return "INTERCITY"
  }
  return "REGIONAL"
}

function getHighestProductClass(legs: FlexpreisRoutingLeg[]): FlexpreisProductClass {
  const classes = legs.map(getLegProductClass)
  if (classes.includes("HIGH_SPEED")) return "HIGH_SPEED"
  if (classes.includes("INTERCITY")) return "INTERCITY"
  return "REGIONAL"
}

function isClearlyUnsupportedFlexpreisLeg(leg: FlexpreisRoutingLeg): boolean {
  const values = [
    leg.verkehrsmittel?.produktGattung,
    leg.verkehrsmittel?.kategorie,
    leg.verkehrsmittel?.name,
    leg.verkehrsmittel?.mittelText,
  ].map(normalizedProductValue)

  return values.some(value => value === "DRF" || value.startsWith("FLX"))
}

/**
 * Führt technische Bezeichnungen desselben Bahnhofskomplexes zusammen, ohne
 * unterschiedliche Orte oder echte Via-Bahnhöfe zu verschmelzen.
 */
export function normalizeStationComplexName(name: string | undefined): string {
  return (name || "unbekannt")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\((?:s-bahn|s|tief|oben)\)/gi, " ")
    .replace(/\bgl\.?\s*\d+(?:\s*[-–]\s*\d+)?\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
}

function stationKey(station: FlexpreisRouteStation): string {
  if (station.extId) return station.extId
  return normalizeStationComplexName(station.name)
}

function collapseStationSequence(stations: FlexpreisRouteStation[]): FlexpreisRouteStation[] {
  const collapsed: FlexpreisRouteStation[] = []
  for (const station of stations) {
    if (!station.name && !station.extId) continue
    const previous = collapsed[collapsed.length - 1]
    if (previous && stationKey(previous) === stationKey(station)) continue
    collapsed.push(station)
  }
  return collapsed
}

function getLegStations(leg: FlexpreisRoutingLeg): FlexpreisRouteStation[] {
  const scheduledStops = Array.isArray(leg.halte)
    ? leg.halte
      .map(stop => ({ name: stop.name || "", extId: stop.extId }))
      .filter(stop => stop.name || stop.extId)
    : []

  if (scheduledStops.length >= 2) return scheduledStops

  return [
    { name: leg.abfahrtsOrt || "Unbekannt", extId: leg.abfahrtsOrtExtId },
    { name: leg.ankunftsOrt || "Unbekannt", extId: leg.ankunftsOrtExtId },
  ]
}

function calculateDurationMinutes(departure: string, arrival: string): number | null {
  const departureMs = Date.parse(departure)
  const arrivalMs = Date.parse(arrival)
  if (!Number.isFinite(departureMs) || !Number.isFinite(arrivalMs) || arrivalMs < departureMs) {
    return null
  }
  return Math.round((arrivalMs - departureMs) / 60_000)
}

export function buildFlexpreisRoute(
  legs: FlexpreisRoutingLeg[],
  transfers: number,
  departure: string,
  arrival: string
): FlexpreisRoute {
  const stations = collapseStationSequence(legs.flatMap(getLegStations))
  const transferStations = collapseStationSequence(
    legs.slice(0, -1).map(leg => ({
      name: leg.ankunftsOrt || "Unbekannt",
      extId: leg.ankunftsOrtExtId,
    }))
  )

  const origin = stations[0] || { name: "Unbekannt" }
  const destination = stations[stations.length - 1] || origin
  const viaStations = stations.slice(1, -1)
  const productClass = getHighestProductClass(legs)
  const normalizedTransfers = Math.max(
    0,
    Number.isFinite(transfers) ? Math.floor(transfers) : transferStations.length
  )
  const key = `${stations.map(stationKey).join(">") || "unbekannt"}#${productClass}`

  return {
    key,
    origin,
    destination,
    viaStations,
    productClass,
    transfers: normalizedTransfers,
    durationMinutes: calculateDurationMinutes(departure, arrival),
    representativeDeparture: departure,
    representativeArrival: arrival,
    direct: normalizedTransfers === 0,
    flexpreisCandidate: !legs.some(isClearlyUnsupportedFlexpreisLeg),
  }
}
