import { buildFlexpreisRoute } from "./flexpreis-routing.ts"
import type { FlexpreisRoute, FlexpreisProductClass } from "./flexpreis-routing"

export const FLEXPREIS_DATA_VERSION = 1
export const FLEXPREIS_DAY_SAMPLE_LIMIT = 5

export interface FlexpreisSource {
  connectionKey: string
  ctxRecon: string
  route: FlexpreisRoute
  legs: FlexpreisJourneyLeg[]
}

export interface FlexpreisJourneyLeg {
  abfahrtsZeitpunkt: string; ankunftsZeitpunkt: string
  abfahrtsOrt: string; ankunftsOrt: string
  verkehrsmittel?: { name?: string; mittelText?: string; kategorie?: string; produktGattung?: string }
}

export interface FlexpreisContext {
  klasse: string
  alter: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  sessionId?: string
}

export interface FlexpreisQuote {
  connectionKey: string
  amountCents: number
  currency: "EUR"
  name: string
  productClass: FlexpreisProductClass
  conditions: string[]
  route: FlexpreisRoute
  legs: FlexpreisJourneyLeg[]
  recordedAt: number
  bookingUrl?: string
  bookingKind: "search"
}

export type FlexpreisStatus = "pending" | "priced" | "no_offer" | "missing_connection" | "unclear_route" | "error"

export interface FlexpreisDayData {
  version: 1
  basisId?: string
  status: FlexpreisStatus
  comparisonQuote?: FlexpreisQuote
  quotes: FlexpreisQuote[]
  /** Successful checks, including confirmed responses without an offer. */
  checkedConnectionKeys?: string[]
  alternativesStatus: "idle" | "complete" | "partial"
}

export interface FlexpreisBasis {
  id: string
  label: string
  productClass: FlexpreisProductClass
  connectionCount: number
  dayCount: number
  typicalDurationMinutes: number | null
  typicalTransfers: number | null
}

export interface FlexpreisComparison {
  basis?: FlexpreisBasis
  bases: FlexpreisBasis[]
  totalDays: number
}

/** Keep discovery data in place while replacing every old comparison quote. */
export function rebaseFlexpreisResults<T extends { flexpreis?: FlexpreisDayData }>(results: Record<string, T>, basisId: string): Record<string, T> {
  return Object.fromEntries(Object.entries(results).map(([date, result]) => [date, date === "_meta" ? result : {
    ...result,
    flexpreis: { version: 1, basisId, status: "pending", quotes: [], alternativesStatus: "idle" },
  }]))
}

export function flexpreisQuoteCacheKey(source: FlexpreisSource, context: FlexpreisContext): string {
  return JSON.stringify({ kind: "flexpreis-offer", version: 1,
    date: source.route.representativeDeparture.slice(0, 10), connection: source.connectionKey,
    klasse: context.klasse, alter: context.alter,
    ermaessigungArt: context.ermaessigungArt || "KEINE_ERMAESSIGUNG",
    ermaessigungKlasse: context.ermaessigungKlasse || "KLASSENLOS" })
}

export function getFlexpreisProductLabel(product: FlexpreisProductClass): string {
  return product === "HIGH_SPEED" ? "ICE" : product === "INTERCITY" ? "IC/EC" : "Nahverkehr"
}

function time(leg: any, direction: "abfahrt" | "ankunft"): string {
  return leg[direction === "abfahrt" ? "abfahrtsZeitpunkt" : "ankunftsZeitpunkt"] ||
    leg[direction]?.sollzeit || leg[direction === "abfahrt" ? "startHalt" : "zielHalt"]?.[direction]?.sollzeit || ""
}

/** Observed journey identity, including trains and times; never a tariff-area key. */
export function buildFlexpreisSource(connection: any): FlexpreisSource | null {
  const legs = connection?.verbindungsAbschnitte
  if (typeof connection?.ctxRecon !== "string" || !Array.isArray(legs) || !legs.length) return null
  const departure = time(legs[0], "abfahrt"), arrival = time(legs.at(-1), "ankunft")
  if (!departure || !arrival) return null
  const route = buildFlexpreisRoute(legs, Number(connection.umstiegsAnzahl) || 0, departure, arrival)
  if (Number.isFinite(connection.verbindungsDauerInSeconds) && connection.verbindungsDauerInSeconds > 0) {
    route.durationMinutes = Math.round(connection.verbindungsDauerInSeconds / 60)
  }
  if (!route.flexpreisCandidate) return null
  const connectionKey = JSON.stringify(legs.map(leg => [
    leg.abfahrtsOrtExtId || leg.startHalt?.extId || leg.abfahrtsOrt,
    leg.ankunftsOrtExtId || leg.zielHalt?.extId || leg.ankunftsOrt,
    time(leg, "abfahrt"), time(leg, "ankunft"),
    leg.verkehrsmittel?.name || leg.verkehrsmittel?.mittelText,
    leg.verkehrsmittel?.produktGattung, route.key,
  ]))
  return { connectionKey, ctxRecon: connection.ctxRecon, route, legs: legs.map(leg => ({
    abfahrtsZeitpunkt: time(leg, "abfahrt"), ankunftsZeitpunkt: time(leg, "ankunft"),
    abfahrtsOrt: leg.abfahrtsOrt || leg.startHalt?.name || "", ankunftsOrt: leg.ankunftsOrt || leg.zielHalt?.name || "",
    verkehrsmittel: leg.verkehrsmittel ? { name: leg.verkehrsmittel.name, mittelText: leg.verkehrsmittel.mittelText,
      kategorie: leg.verkehrsmittel.kategorie, produktGattung: leg.verkehrsmittel.produktGattung } : undefined,
  })) }
}

export function extractFlexpreisSources(data: any): FlexpreisSource[] {
  const raw = Array.isArray(data?.verbindungen) ? data.verbindungen :
    (data?.intervalle || []).flatMap((iv: any) => (iv.verbindungen || []).map((o: any) => o.verbindung))
  const unique = new Map<string, FlexpreisSource>()
  for (const connection of raw) {
    const source = buildFlexpreisSource(connection)
    if (source) unique.set(source.connectionKey, source)
  }
  return [...unique.values()]
}

// A comparison uses the exact observed station sequence and product class.
// Missing IDs or a connection without observable intermediate stations cannot
// establish a comparable journey path. Such offers can still be checked individually.
export function hasComparisonRoute(source: FlexpreisSource): boolean {
  const stations = [source.route.origin, ...source.route.viaStations, source.route.destination]
  return source.route.productClass !== "REGIONAL" && stations.length > 2 && stations.every(s => Boolean(s.extId))
}

export function preferFlexpreisSource(a: FlexpreisSource, b: FlexpreisSource): number {
  return (a.route.durationMinutes ?? Infinity) - (b.route.durationMinutes ?? Infinity) ||
    a.route.transfers - b.route.transfers || a.route.representativeDeparture.localeCompare(b.route.representativeDeparture) ||
    a.connectionKey.localeCompare(b.connectionKey)
}

function basisLabel(route: FlexpreisRoute, peers: FlexpreisRoute[] = []): string {
  const stops = route.viaStations
  // Only describe observed stops; no inferred Via/Wegevorschrift.
  let indices = stops.length <= 3 ? stops.map((_, i) => i) : [0, 1, stops.length - 1]
  if (peers.length > 1 && stops.length > 3) {
    // A truncated label must retain the stop that differentiates its peers:
    // e.g. Halle vs Leipzig, not two identical Eisenach–Erfurt–Südkreuz labels.
    const otherStops = new Set(peers.filter(p => p.key !== route.key).flatMap(p => p.viaStations.map(s => s.extId || s.name)))
    const distinguishingIndex = stops.findIndex(s => !otherStops.has(s.extId || s.name))
    if (distinguishingIndex >= 0) indices = [...new Set([0, distinguishingIndex, stops.length - 1])].sort((a, b) => a - b)
  }
  const names = indices.map(i => stops[i].name)
  return `${getFlexpreisProductLabel(route.productClass)} · über ${names.join(" – ")}`
}

/** Compact labels for presentation only; never a tariff-grouping key. */
export function getFlexpreisRouteLabels(routes: FlexpreisRoute[]): Map<string, string> {
  const unique = [...new Map(routes.map(route => [route.key, route])).values()]
  const peers = new Map<string, FlexpreisRoute[]>()
  for (const route of unique) {
    const label = basisLabel(route)
    peers.set(label, [...(peers.get(label) || []), route])
  }
  const labels = new Map(unique.map(route => [route.key, basisLabel(route, peers.get(basisLabel(route)))]))
  for (const label of new Set(labels.values())) {
    const collisions = unique.filter(route => labels.get(route.key) === label).sort((a, b) => a.key.localeCompare(b.key))
    if (collisions.length > 1) collisions.forEach((route, i) => labels.set(route.key, `${label} · Haltevariante ${i + 1}`))
  }
  return labels
}

function typicalDuration(values: Iterable<number | null>): number | null {
  const durations = [...values].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  if (!durations.length) return null
  const middle = Math.floor(durations.length / 2)
  return Math.round(durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2)
}

export function formatFlexpreisTypicalDuration(minutes?: number | null): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "–"
  const rounded = Math.round(minutes), hours = Math.floor(rounded / 60), rest = rounded % 60
  if (!Number.isSafeInteger(rounded) || rounded <= 0) return "–"
  return `ca. ${hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${rest} min`}`
}

export function formatFlexpreisTypicalTransfers(transfers?: number | null): string {
  if (typeof transfers !== "number" || !Number.isSafeInteger(transfers) || transfers < 0) return "–"
  return transfers === 0 ? "Direkt" : `${transfers} ${transfers === 1 ? "Umstieg" : "Umstiege"}`
}

function typicalTransfers(values: Iterable<number>): number | null {
  const counts = new Map<number, number>()
  for (const value of values) {
    if (Number.isSafeInteger(value) && value >= 0) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a - b)[0]?.[0] ?? null
}

export function formatFlexpreisBasisOccurrences(basis: FlexpreisBasis, totalDays: number): string {
  const connections = `${basis.connectionCount} ${basis.connectionCount === 1 ? "Verbindung" : "Verbindungen"}`
  const days = `an ${basis.dayCount} von ${totalDays} ${totalDays === 1 ? "Reisetag" : "Reisetagen"}`
  return `${connections} · ${days}`
}

export function chooseFlexpreisComparison(days: Record<string, FlexpreisSource[]>, requestedId?: string): FlexpreisComparison {
  const groups = new Map<string, { source: FlexpreisSource; days: Set<string>; connections: Map<string, { duration: number | null; transfers: number }> }>()
  for (const [date, sources] of Object.entries(days)) {
    for (const source of sources.filter(hasComparisonRoute)) {
      const found = groups.get(source.route.key)
      const facts = { duration: source.route.durationMinutes, transfers: source.route.transfers }
      if (!found) groups.set(source.route.key, { source, days: new Set([date]), connections: new Map([[source.connectionKey, facts]]) })
      else {
        found.days.add(date)
        if (!found.connections.has(source.connectionKey)) found.connections.set(source.connectionKey, facts)
        if (preferFlexpreisSource(source, found.source) < 0) found.source = source
      }
    }
  }
  const ranked = [...groups.values()].sort((a, b) => b.days.size - a.days.size || preferFlexpreisSource(a.source, b.source))
  const labels = getFlexpreisRouteLabels(ranked.map(({ source }) => source.route))
  const bases = ranked.map(({ source, days, connections }) => ({ id: source.route.key,
    label: labels.get(source.route.key)!, productClass: source.route.productClass,
    connectionCount: connections.size, dayCount: days.size,
    typicalDurationMinutes: typicalDuration([...connections.values()].map(value => value.duration)),
    typicalTransfers: typicalTransfers([...connections.values()].map(value => value.transfers)) }))
  // An explicit selection never silently falls back to another observed journey path.
  return { basis: requestedId ? bases.find(b => b.id === requestedId) : bases[0], bases, totalDays: Object.keys(days).length }
}

export function comparisonSource(sources: FlexpreisSource[], basisId?: string): FlexpreisSource | undefined {
  return basisId ? sources.filter(s => hasComparisonRoute(s) && s.route.key === basisId).sort(preferFlexpreisSource)[0] : undefined
}

/** Request ordering only. Similarity never assigns a tariff to another journey. */
export function selectFlexpreisSamples(sources: FlexpreisSource[], primary?: FlexpreisSource, limit = FLEXPREIS_DAY_SAMPLE_LIMIT): FlexpreisSource[] {
  const paths = new Map<string, FlexpreisSource>()
  for (const source of [...sources].sort(preferFlexpreisSource)) if (!paths.has(source.route.key)) paths.set(source.route.key, source)
  const remaining = [...paths.values()].filter(s => s.route.key !== primary?.route.key)
  const selected = primary ? [primary] : []
  if (!selected.length && remaining.length) selected.push(remaining.shift()!)
  function distance(a: FlexpreisSource, b: FlexpreisSource) {
    if (a.route.productClass !== b.route.productClass) return 1
    const sequence = (s: FlexpreisSource) => [s.route.origin, ...s.route.viaStations, s.route.destination].map(x => x.extId || x.name)
    const x = sequence(a), y = sequence(b), row = Array<number>(y.length + 1).fill(0)
    for (const station of x) {
      let previous = 0
      for (let j = 1; j <= y.length; j++) { const old = row[j]; row[j] = station === y[j - 1] ? previous + 1 : Math.max(row[j], row[j - 1]); previous = old }
    }
    return 1 - row[y.length] / Math.max(x.length, y.length)
  }
  while (remaining.length && selected.length < limit) {
    remaining.sort((a, b) => Math.min(...selected.map(s => distance(b, s))) - Math.min(...selected.map(s => distance(a, s))) || preferFlexpreisSource(a, b))
    selected.push(remaining.shift()!)
  }
  return selected.slice(0, limit)
}

export function flexpreisCellAmount(day?: FlexpreisDayData, basisId?: string): number | undefined {
  const quote = day?.comparisonQuote
  return day?.version === 1 && day.status === "priced" && day.basisId === basisId && quote &&
    Number.isSafeInteger(quote.amountCents) && quote.amountCents > 0 ? quote.amountCents / 100 : undefined
}

export function flexpreisStatusLabel(status?: FlexpreisStatus): string {
  switch (status) {
    case "pending": return "Flexpreis wird geprüft"
    case "missing_connection": return "Kein Vergleichstreffer"
    case "unclear_route": return "Reiseweg nicht vergleichbar"
    case "no_offer": return "Kein passendes Flexangebot"
    case "error": return "Preisabfrage fehlgeschlagen"
    default: return "Flexpreis noch nicht geprüft"
  }
}

/** Preserve valid observations when a later request fails. */
export function mergeFlexpreisDays(previous: FlexpreisDayData | undefined, next: FlexpreisDayData): FlexpreisDayData {
  if (!previous || previous.basisId !== next.basisId) return next
  if (next.status !== "error" && next.alternativesStatus !== "partial") return next
  const checked = new Set(next.checkedConnectionKeys)
  const comparisonQuote = next.comparisonQuote || (next.status === "error" ? previous.comparisonQuote : undefined)
  const quotes = new Map(previous.quotes
    .filter(q => !checked.has(q.connectionKey) && q.connectionKey !== previous.comparisonQuote?.connectionKey)
    .map(q => [q.connectionKey, q]))
  for (const quote of next.quotes) quotes.set(quote.connectionKey, quote)
  if (comparisonQuote) quotes.set(comparisonQuote.connectionKey, comparisonQuote)
  return {
    ...next,
    comparisonQuote,
    status: comparisonQuote ? "priced" : next.status,
    quotes: [...quotes.values()],
  }
}
