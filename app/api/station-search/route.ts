import { NextRequest, NextResponse } from 'next/server'
import {
  recordStationSearchClick,
  type StationSearchResult,
} from '@/app/api/search-prices/cache'
import { metricsCollector } from '@/app/api/metrics/collector'
import { logDebug, logError, logWarn } from '@/lib/shared/logger'
import { isTemporaryBahnNetworkError } from '@/app/api/search-prices/bahn-http'
import { StationRateLimitError } from './rate-limit'
import { searchStations, StationSearchUpstreamError } from './search-stations'
import { consumeStationSearchGrant } from '@/lib/security/station-search-grants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const LOG_SCOPE = 'station-search'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [] })
  }
  if (query.length > 200) return NextResponse.json({ results: [], error: 'Suchbegriff zu lang.' }, { status: 400 })
  const failure = consumeStationSearchGrant(request)
  if (failure) return failure

  try {
    const result = await searchStations(query)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof StationRateLimitError) {
      const retryAfterMs = Math.max(100, error.retryAfterMs)
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
      logWarn(LOG_SCOPE, 'Station search was rate limited', { retryAfterMs })
      return NextResponse.json(
        { results: [], error: 'Rate limit exceeded', retryAfter: retryAfterMs },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        }
      )
    }

    if (isTemporaryBahnNetworkError(error)) {
      logWarn(LOG_SCOPE, 'Bahn station search is temporarily unavailable')
      return NextResponse.json(
        { results: [], error: 'Bahn API temporarily unavailable', retryAfter: 5000 },
        {
          status: 503,
          headers: { 'Retry-After': '5' },
        }
      )
    }

    if (error instanceof StationSearchUpstreamError) {
      logWarn(LOG_SCOPE, 'Bahn station search returned an upstream error', {
        status: error.status,
      })
      return NextResponse.json(
        { results: [], error: 'Bahn API error' },
        { status: 502 }
      )
    }

    logError(LOG_SCOPE, 'Station search failed', error)
    return NextResponse.json({ results: [], error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const failure = consumeStationSearchGrant(request, true)
  if (failure) return failure
  try {
    const body = await request.json() as {
      q?: string
      station?: Partial<StationSearchResult>
    }
    const query = body.q?.trim()
    const station = body.station

    if (!query || query.length < 2 || !station?.extId || !station.name) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    recordStationSearchClick(query, {
      extId: station.extId,
      name: station.name,
    })
    metricsCollector.recordStationSearchClick()

    logDebug(LOG_SCOPE, 'Station search click recorded', {
      query,
      stationName: station.name,
      stationId: station.extId,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError(LOG_SCOPE, 'Station search click tracking failed', error)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
