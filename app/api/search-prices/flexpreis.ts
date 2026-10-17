import { reconRateLimiter, globalRateLimiter } from './rate-limiter'
import { fetchBahn } from './bahn-http'
import { getFlexpreisCache, setFlexpreisCache } from './cache'
import { filterFlexpreisSources } from './bahn-api'
import { metricsCollector } from '@/app/api/metrics/collector'
import { logWarn } from '@/lib/shared/logger'
import { createBookingLink } from '@/lib/train-search/day-details-utils'
import { parseFlexpreisOffer } from '@/lib/search/flexpreis-offers'
import {
  comparisonSource, extractFlexpreisSources, flexpreisQuoteCacheKey,
  buildFlexpreisSource,
  selectFlexpreisSamples,
  type FlexpreisSource, type FlexpreisContext, type FlexpreisQuote, type FlexpreisDayData,
} from '@/lib/search/flexpreis-comparison'

const HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
  Origin: 'https://www.bahn.de', Referer: 'https://www.bahn.de/buchung/fahrplan/suche',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0' }

export interface FlexpreisRequestConfig extends FlexpreisContext {
  startStation: { id: string; name: string }
  zielStation: { id: string; name: string }
  maximaleUmstiege?: number | string
  umstiegszeit?: string
  schnelleVerbindungen?: boolean
  abfahrtAb?: string; abfahrtBis?: string; ankunftAb?: string; ankunftBis?: string
}

interface QuoteResult { version: 1; status: 'priced' | 'no_offer' | 'error'; quote?: FlexpreisQuote }
const inFlight = new Map<string, Promise<QuoteResult>>()

export function cachedFlexpreisQuote(source: FlexpreisSource, config: FlexpreisContext): QuoteResult | null {
  const key = flexpreisQuoteCacheKey(source, config)
  const value = getFlexpreisCache<QuoteResult>(key)
  if (value?.version !== 1 || (value.status !== 'priced' && value.status !== 'no_offer')) return null
  if (value.status === 'priced' && (!value.quote || value.quote.connectionKey !== source.connectionKey ||
    !Number.isSafeInteger(value.quote.amountCents) || value.quote.amountCents <= 0)) return null
  return value.status === 'no_offer' ? getFlexpreisCache<QuoteResult>(key, 10 * 60_000) : value
}

export async function fetchFlexpreisQuote(source: FlexpreisSource, config: FlexpreisRequestConfig): Promise<QuoteResult> {
  const cached = cachedFlexpreisQuote(source, config)
  if (cached) {
    metricsCollector.recordFlexpreisCacheLookup('offer', true)
    return cached
  }
  // A user's cancellation must not cancel another user's queued lookup.
  const key = `${config.sessionId || ''}:${flexpreisQuoteCacheKey(source, config)}`
  const existing = inFlight.get(key)
  if (existing) return existing
  metricsCollector.recordFlexpreisCacheLookup('offer', false)
  const task = (async (): Promise<QuoteResult> => {
    try {
      const data = await reconRateLimiter.addToQueue(`flex-${source.route.representativeDeparture}-${source.connectionKey.length}`, async () => {
        if (config.sessionId && reconRateLimiter.isSessionCancelledSync(config.sessionId)) throw new Error('Search was cancelled')
        const response = await metricsCollector.measureBahnApiRequest('recon', () => fetchBahn('https://www.bahn.de/web/api/angebote/recon', {
          method: 'POST', headers: HEADERS,
          body: JSON.stringify({ ctxRecon: source.ctxRecon, klasse: config.klasse,
            reisende: [{ typ: config.alter, ermaessigungen: [{ art: config.ermaessigungArt || 'KEINE_ERMAESSIGUNG',
              klasse: config.ermaessigungKlasse || 'KLASSENLOS' }], alter: [], anzahl: 1 }],
            deutschlandTicketVorhanden: false, nurDeutschlandTicketVerbindungen: false, reservierungsKontingenteVorhanden: false }),
        }))
        if (!response.ok) return { __httpStatus: response.status, __errorText: (await response.text()).slice(0, 100),
          __retryAfterMs: retryAfterMs(response.getHeader('retry-after')) }
        return response.json<any>()
      }, config.sessionId)
      if ((data as any)?.__httpStatus || !Array.isArray((data as any)?.verbindungen)) return { version: 1, status: 'error' }
      const reconstructed = buildFlexpreisSource((data as any).verbindungen[0])
      if (!reconstructed || reconstructed.connectionKey !== source.connectionKey) return { version: 1, status: 'error' }
      const offer = parseFlexpreisOffer((data as any).verbindungen[0]?.reiseAngebote, config)
      const value: QuoteResult = offer ? { version: 1, status: 'priced', quote: {
        ...offer, connectionKey: source.connectionKey, currency: 'EUR', productClass: source.route.productClass,
        route: source.route, legs: source.legs, recordedAt: Date.now(), bookingKind: 'search',
        bookingUrl: createBookingLink(source.route.representativeDeparture, config.startStation.name, config.zielStation.name,
          config.startStation.id, config.zielStation.id, config.klasse, String(config.maximaleUmstiege ?? 'alle'),
          config.alter, config.ermaessigungArt || 'KEINE_ERMAESSIGUNG', config.ermaessigungKlasse || 'KLASSENLOS', config.umstiegszeit)
          .replace('&s=true', '&s=false'),
      }} : { version: 1, status: 'no_offer' }
      setFlexpreisCache(flexpreisQuoteCacheKey(source, config), value)
      return value
    } catch (error) {
      logWarn('bestpreissuche.flexpreis', 'Flexpreis lookup failed', { error: error instanceof Error ? error.message : String(error) })
      return { version: 1, status: 'error' }
    }
  })()
  inFlight.set(key, task)
  try { return await task } finally { inFlight.delete(key) }
}

function retryAfterMs(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0
}

/** One supplementary timetable page, explicitly not a full-day timetable. */
export async function supplementFlexpreisSources(date: string, config: FlexpreisRequestConfig): Promise<FlexpreisSource[]> {
  const key = JSON.stringify({ kind: 'flexpreis-timetable', version: 1, date, from: config.startStation.id,
    to: config.zielStation.id, klasse: config.klasse, alter: config.alter, card: config.ermaessigungArt,
    cardClass: config.ermaessigungKlasse, time: config.abfahrtAb || '08:00', minTransfer: config.umstiegszeit,
    fast: config.schnelleVerbindungen })
  const cached = getFlexpreisCache<FlexpreisSource[]>(key)
  metricsCollector.recordFlexpreisCacheLookup('timetable', cached !== null)
  const dayConfig = { ...config, anfrageDatum: new Date(`${date}T12:00:00Z`) }
  if (cached) return filterFlexpreisSources(cached, dayConfig)
  const data = await globalRateLimiter.addToQueue(`flex-fahrplan-${date}`, async () => {
    const response = await metricsCollector.measureBahnApiRequest('fahrplan', () => fetchBahn('https://www.bahn.de/web/api/angebote/fahrplan', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ abfahrtsHalt: config.startStation.id, ankunftsHalt: config.zielStation.id,
        anfrageZeitpunkt: `${date}T${config.abfahrtAb || '08:00'}:00`, ankunftSuche: 'ABFAHRT', klasse: config.klasse,
        produktgattungen: ['ICE', 'EC_IC', 'IR', 'REGIONAL', 'SBAHN', 'BUS', 'SCHIFF', 'UBAHN', 'TRAM', 'ANRUFPFLICHTIG'],
        reisende: [{ typ: config.alter, ermaessigungen: [{ art: config.ermaessigungArt || 'KEINE_ERMAESSIGUNG',
          klasse: config.ermaessigungKlasse || 'KLASSENLOS' }], alter: [], anzahl: 1 }],
        schnelleVerbindungen: config.schnelleVerbindungen ?? true, deutschlandTicketVorhanden: false,
        nurDeutschlandTicketVerbindungen: false, reservierungsKontingenteVorhanden: false,
        ...(config.umstiegszeit && config.umstiegszeit !== 'normal' ? { minUmstiegszeit: Number(config.umstiegszeit) } : {}),
      }),
    }))
    if (!response.ok) return { __httpStatus: response.status, __retryAfterMs: retryAfterMs(response.getHeader('retry-after')) }
    return response.json<any>()
  }, config.sessionId)
  if (!Array.isArray((data as any)?.verbindungen)) throw new Error('Supplementary timetable lookup failed')
  const sources = extractFlexpreisSources(data)
  setFlexpreisCache(key, sources)
  return filterFlexpreisSources(sources, dayConfig)
}

export async function resolveFlexpreisDay(sources: FlexpreisSource[], config: FlexpreisRequestConfig,
  basisId?: string, alternatives = false): Promise<FlexpreisDayData> {
  const primary = comparisonSource(sources, basisId)
  const day: FlexpreisDayData = { version: 1, basisId,
    status: primary ? 'pending' : basisId ? 'missing_connection' : 'unclear_route',
    quotes: [], checkedConnectionKeys: [], alternativesStatus: 'idle' }
  const chosen = alternatives ? selectFlexpreisSamples(sources, primary) : primary ? [primary] : []
  let failed = false
  for (const source of chosen) {
    if (config.sessionId && reconRateLimiter.isSessionCancelledSync(config.sessionId)) break
    const result = await fetchFlexpreisQuote(source, config)
    if (source === primary) { day.status = result.status; day.comparisonQuote = result.quote }
    if (result.quote) day.quotes.push(result.quote)
    if (result.status === 'error') { failed = true; break }
    day.checkedConnectionKeys!.push(source.connectionKey)
  }
  if (alternatives) day.alternativesStatus = failed ? 'partial' : 'complete'
  return day
}
