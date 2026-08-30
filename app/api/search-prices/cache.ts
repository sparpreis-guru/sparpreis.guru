import { metricsCollector } from '@/app/api/metrics/collector'
import { formatLogDateTime, logDebug, logError, logInfo, logWarn } from '@/lib/shared/logger'
import Database from 'better-sqlite3'
import { dirname, join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { gzipSync, gunzipSync } from 'zlib'
import { generateConnectionId } from './utils'
import { connectionKey } from '@/lib/database/connection-key.cjs'
import { initializeEmptyDatabase } from '@/lib/database/database-migrations.cjs'
import databaseSchema from '@/lib/database/database-schema.json'
import databasePolicy from '@/lib/database/database-policy.json'
import { getBerlinDateKey } from '@/lib/shared/berlin-date'

const LOG_SCOPE = "bestpreissuche.cache"

// Cache-Konfiguration
const CACHE_FRESHNESS_TTL = 60 * 60 * 1000 // 60 Minuten - nach dieser Zeit werden Daten neu abgefragt
const DATA_RETENTION_DAYS = databasePolicy.connectionRetentionDays
const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000
const STATION_SEARCH_RETENTION_DAYS = databasePolicy.stationSearchRetentionDays
const STATION_SEARCH_RETENTION_MS = STATION_SEARCH_RETENTION_DAYS * 24 * 60 * 60 * 1000
const STATION_USAGE_RETENTION_DAYS = databasePolicy.stationUsageRetentionDays
const STATION_USAGE_RETENTION_MS = STATION_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000

// ENV-Variable für das Löschen vergangener Fahrten (standardmäßig aktiviert)
const CLEANUP_PAST_CONNECTIONS = process.env.CLEANUP_PAST_CONNECTIONS !== 'false'

interface TrainResult {
  preis: number
  info: string
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  recordedAt?: number
  // Tagestarif im Flexpreis-Modus; gilt für alle Verbindungen des Tages.
  flexPreis?: number
  allIntervals?: Array<{
    preis: number
    abschnitte?: Array<{
      abfahrtsZeitpunkt: string
      ankunftsZeitpunkt: string
      abfahrtsOrt: string
      ankunftsOrt: string
    }>
    abfahrtsZeitpunkt: string
    ankunftsZeitpunkt: string
    abfahrtsOrt: string
    ankunftsOrt: string
    info: string
    umstiegsAnzahl: number
    isCheapestPerInterval?: boolean
  }>
}

interface TrainResults {
  [date: string]: TrainResult
}

// Initialisiere SQLite Datenbank
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
const dataDir = join(process.cwd(), 'data')
const dbPath = process.env.DATABASE_PATH || join(dataDir, 'connection-cache.db')
const dbDir = dirname(dbPath)
if (!isBuildPhase && !existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}
const db = new Database(isBuildPhase ? ':memory:' : dbPath)

// Der Migrationsrunner wird vor dem Serverstart ausgeführt. Hier wird nur noch
// geprüft, dass kein Prozess mit einem inkompatiblen Schema weiterarbeitet.
db.pragma('busy_timeout = 30000')
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')

if (isBuildPhase) {
  initializeEmptyDatabase(db)
} else {
  const databaseVersion = db.pragma('user_version', { simple: true }) as number
  if (databaseVersion !== databaseSchema.latestVersion) {
    db.close()
    throw new Error(
      `Database schema mismatch: current=${databaseVersion}, expected=${databaseSchema.latestVersion}. ` +
      'Run "npm run database:migrate" before starting the application.'
    )
  }
}

// Prepared Statements
const stmtGetCache = db.prepare('SELECT data_compressed, last_fetched_at FROM connection_cache WHERE cache_key = ?')
const stmtSetCache = db.prepare(`
  INSERT OR REPLACE INTO connection_cache (cache_key, data_compressed, created_at, last_fetched_at)
  VALUES (?, ?, ?, ?)
`)
const stmtInsertPriceHistoryContext = db.prepare(`
  INSERT OR IGNORE INTO price_history_context (
    start_station_id,
    destination_station_id,
    travel_date,
    age_type,
    discount_type,
    discount_class,
    travel_class
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const stmtGetPriceHistoryContext = db.prepare(`
  SELECT id
  FROM price_history_context
  WHERE start_station_id = ?
    AND destination_station_id = ?
    AND travel_date = ?
    AND age_type = ?
    AND discount_type = ?
    AND discount_class = ?
    AND travel_class = ?
`)
const stmtInsertPriceHistoryJourney = db.prepare(`
  INSERT OR IGNORE INTO price_history_journey (context_id, connection_key)
  VALUES (?, ?)
`)
const stmtGetPriceHistoryJourney = db.prepare(`
  SELECT id
  FROM price_history_journey
  WHERE context_id = ? AND connection_key = ?
`)
const stmtInsertPriceHistoryObservation = db.prepare(`
  INSERT OR IGNORE INTO price_history_observation (journey_id, recorded_at, price)
  VALUES (?, ?, ?)
`)
const stmtCleanupCache = db.prepare('DELETE FROM connection_cache WHERE last_fetched_at < ?')
const stmtCleanupHistory = db.prepare('DELETE FROM price_history_observation WHERE recorded_at < ?')
const stmtCleanupOrphanHistoryJourneys = db.prepare(`
  DELETE FROM price_history_journey
  WHERE NOT EXISTS (
    SELECT 1 FROM price_history_observation
    WHERE price_history_observation.journey_id = price_history_journey.id
  )
`)
const stmtCleanupOrphanHistoryContexts = db.prepare(`
  DELETE FROM price_history_context
  WHERE NOT EXISTS (
    SELECT 1 FROM price_history_journey
    WHERE price_history_journey.context_id = price_history_context.id
  )
`)
const stmtGetCacheCount = db.prepare('SELECT COUNT(*) as count FROM connection_cache')
const stmtGetHistoryCount = db.prepare('SELECT COUNT(*) as count FROM price_history_observation')
const stmtGetStationSearchCount = db.prepare('SELECT COUNT(*) as count FROM station_search_cache')

// Station search prepared statements
const stmtGetStationSearch = db.prepare(`
  SELECT
    c.ext_id,
    c.station_id,
    c.name,
    c.lat,
    c.lon,
    c.station_type,
    c.products
  FROM station_search_cache c
  LEFT JOIN station_search_usage u
    ON u.search_term = c.search_term AND u.ext_id = c.ext_id
  WHERE c.search_term = ? AND c.created_at >= ?
  ORDER BY COALESCE(u.click_count, 0) DESC, c.result_rank ASC, c.name ASC
  LIMIT 10
`)

const stmtInsertStationSearch = db.prepare(`
  INSERT OR REPLACE INTO station_search_cache 
  (search_term, ext_id, station_id, name, lat, lon, station_type, products, result_rank, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const stmtDeleteStationSearchTerm = db.prepare('DELETE FROM station_search_cache WHERE search_term = ?')

const stmtCleanupStationSearch = db.prepare('DELETE FROM station_search_cache WHERE created_at < ?')
const stmtCleanupStationSearchUsage = db.prepare('DELETE FROM station_search_usage WHERE last_clicked_at < ?')

const stmtGetStationSearchUsage = db.prepare(`
  SELECT ext_id, click_count
  FROM station_search_usage
  WHERE search_term = ?
`)

const stmtRecordStationSearchClick = db.prepare(`
  INSERT INTO station_search_usage (search_term, ext_id, name, click_count, last_clicked_at)
  VALUES (?, ?, ?, 1, ?)
  ON CONFLICT(search_term, ext_id) DO UPDATE SET
    name = excluded.name,
    click_count = click_count + 1,
    last_clicked_at = excluded.last_clicked_at
`)

const stmtCountPastPriceHistory = db.prepare(`
  SELECT COUNT(*) AS count
  FROM price_history_observation observation
  JOIN price_history_journey journey ON journey.id = observation.journey_id
  JOIN price_history_context context ON context.id = journey.context_id
  WHERE context.travel_date < ?
`)
const stmtCleanupPastPriceHistory = db.prepare(`
  DELETE FROM price_history_context
  WHERE travel_date < ?
`)

const stmtGetConnectionPriceHistory = db.prepare(`
  SELECT observation.price AS preis, observation.recorded_at
  FROM price_history_observation observation
  JOIN price_history_journey journey ON journey.id = observation.journey_id
  JOIN price_history_context context ON context.id = journey.context_id
  WHERE journey.connection_key = ?
    AND context.age_type = ?
    AND context.discount_type = ?
    AND context.discount_class = ?
    AND context.travel_class = ?
  ORDER BY observation.recorded_at ASC
`)

// Cache-Hilfsfunktionen
export function generateCacheKey(params: {
  startStationId: string
  zielStationId: string
  date: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  klasse: string
  schnelleVerbindungen: boolean
  abfahrtAb?: string
  abfahrtBis?: string
  ankunftAb?: string
  ankunftBis?: string
  umstiegszeit?: string
  tarif?: string
}): string {
  const cleanedParams = {
    startStationId: params.startStationId,
    zielStationId: params.zielStationId,
    date: params.date,
    alter: params.alter,
    ermaessigungArt: params.ermaessigungArt,
    ermaessigungKlasse: params.ermaessigungKlasse,
    klasse: params.klasse,
    schnelleVerbindungen: params.schnelleVerbindungen,
    ...(params.umstiegszeit && params.umstiegszeit !== "undefined" && { umstiegszeit: params.umstiegszeit }),
    // Nur im Flexpreis-Modus Teil des Keys, damit bestehende Sparpreis-Eintraege
    // gültig bleiben. Ein Eintrag ohne Flexpreis darf nie als Flexpreis-Treffer
    // ausgeliefert werden, deshalb müssen beide Modi getrennte Keys haben.
    ...(params.tarif === "FLEXPREIS" && { tarif: params.tarif }),
  }
  
  return JSON.stringify(cleanedParams)
}

function compressData(data: TrainResults): Buffer {
  const jsonString = JSON.stringify(data)
  return gzipSync(Buffer.from(jsonString, 'utf-8'))
}

function decompressData(compressed: Buffer): TrainResults {
  const decompressed = gunzipSync(compressed)
  return JSON.parse(decompressed.toString('utf-8'))
}

function getOrCreatePriceHistoryContextId(params: {
  startStationId: string
  zielStationId: string
  date: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  klasse: string
}): number {
  const values = [
    params.startStationId,
    params.zielStationId,
    params.date,
    params.alter,
    params.ermaessigungArt,
    params.ermaessigungKlasse,
    params.klasse,
  ] as const

  stmtInsertPriceHistoryContext.run(...values)
  const row = stmtGetPriceHistoryContext.get(...values) as { id: number } | undefined
  if (!row) {
    throw new Error('Could not resolve price history context after insert')
  }
  return row.id
}

function recordPriceHistoryObservation(
  contextId: number,
  connectionId: string,
  price: number,
  recordedAt: number
): void {
  const key = connectionKey(connectionId)
  stmtInsertPriceHistoryJourney.run(contextId, key)
  const journey = stmtGetPriceHistoryJourney.get(contextId, key) as { id: number } | undefined
  if (!journey) {
    throw new Error('Could not resolve price history journey after insert')
  }
  stmtInsertPriceHistoryObservation.run(journey.id, recordedAt, price)
}

export function getCachedResult(cacheKey: string): { data: TrainResults | null; needsRefresh: boolean; recordedAt?: number } {
  try {
    const row = stmtGetCache.get(cacheKey) as { data_compressed: Buffer; last_fetched_at: number } | undefined
    
    if (!row) {
      return { data: null, needsRefresh: true }
    }
    
    const now = Date.now()
    const age = now - row.last_fetched_at
    const needsRefresh = age > CACHE_FRESHNESS_TTL
    
    const data = decompressData(row.data_compressed)
    
    if (needsRefresh) {
      logDebug(LOG_SCOPE, "♻️ Connection cache entry exists but is stale", {
        ageMinutes: Math.round(age / 60000),
        freshnessTtlMinutes: Math.round(CACHE_FRESHNESS_TTL / 60000),
      })
    }
    
    return { data, needsRefresh, recordedAt: row.last_fetched_at }
  } catch (error) {
    logError(LOG_SCOPE, "Could not read connection cache entry", error)
    return { data: null, needsRefresh: true }
  }
}

export function setCachedResult(
  cacheKey: string,
  data: TrainResults | null,
  params: {
    startStationId: string
    zielStationId: string
    date: string
    alter: string
    ermaessigungArt: string
    ermaessigungKlasse: string
    klasse: string
    schnelleVerbindungen: boolean
    umstiegszeit?: string
  }
): void {
  if (!data) return

  try {
    const now = Date.now()
    const compressed = compressData(data)
    
    // Cache-Eintrag speichern
    stmtSetCache.run(cacheKey, compressed, now, now)
    
    let historyContextId: number | undefined
    const getHistoryContextId = () => {
      historyContextId ??= getOrCreatePriceHistoryContextId(params)
      return historyContextId
    }

    // Preishistorie für alle Verbindungen speichern
    for (const result of Object.values(data)) {
      // Hauptverbindung
      if (result.abfahrtsZeitpunkt && result.ankunftsZeitpunkt) {
        const umstiegsAnzahl = result.allIntervals?.find(iv => iv.abfahrtsZeitpunkt === result.abfahrtsZeitpunkt && iv.ankunftsZeitpunkt === result.ankunftsZeitpunkt)?.umstiegsAnzahl || 0
        const connectionId = generateConnectionId(
          params.startStationId,
          params.zielStationId,
          result.abfahrtsZeitpunkt,
          result.ankunftsZeitpunkt,
          umstiegsAnzahl
        )

        recordPriceHistoryObservation(
          getHistoryContextId(),
          connectionId,
          result.preis,
          now
        )
      }
      
      // Alle Intervalle speichern
      if (result.allIntervals) {
        for (const interval of result.allIntervals) {
          const connectionId = generateConnectionId(
            params.startStationId,
            params.zielStationId,
            interval.abfahrtsZeitpunkt,
            interval.ankunftsZeitpunkt,
            interval.umstiegsAnzahl
          )

          recordPriceHistoryObservation(
            getHistoryContextId(),
            connectionId,
            interval.preis,
            now
          )
        }
      }
    }
    
    // Logging
    const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
    const historyCount = (stmtGetHistoryCount.get() as { count: number }).count
    
    if (cacheCount % 50 === 0 || cacheCount < 10) {
      logDebug(LOG_SCOPE, "💾 Connection cache stored", {
        travelDate: params.date,
        startStationId: params.startStationId,
        destinationStationId: params.zielStationId,
        cacheEntries: cacheCount,
        priceHistoryRecords: historyCount,
      })
    }
    
    metricsCollector.updateCacheMetrics(getStationSearchCacheSize(), cacheCount)
  } catch (error) {
    logError(LOG_SCOPE, "Could not write connection cache entry", error, {
      travelDate: params.date,
      startStationId: params.startStationId,
      destinationStationId: params.zielStationId,
    })
  }
}

// Cache-Bereinigung
function cleanupCache(): void {
  try {
    const now = Date.now()
    const cutoffTime = now - DATA_RETENTION_MS
    const stationSearchCutoff = now - STATION_SEARCH_RETENTION_MS
    const stationUsageCutoff = now - STATION_USAGE_RETENTION_MS
    
    const cacheRemoved = stmtCleanupCache.run(cutoffTime).changes
    const historyRemoved = stmtCleanupHistory.run(cutoffTime).changes
    stmtCleanupOrphanHistoryJourneys.run()
    stmtCleanupOrphanHistoryContexts.run()
    const stationSearchRemoved = stmtCleanupStationSearch.run(stationSearchCutoff).changes
    const stationUsageRemoved = stmtCleanupStationSearchUsage.run(stationUsageCutoff).changes
    
    if (cacheRemoved > 0 || historyRemoved > 0 || stationSearchRemoved > 0 || stationUsageRemoved > 0) {
      logInfo(LOG_SCOPE, "Expired cache data cleaned up", {
        connectionCacheRemoved: cacheRemoved,
        priceHistoryRemoved: historyRemoved,
        stationSearchRemoved,
        stationUsageRemoved,
        retentionDays: DATA_RETENTION_DAYS,
      })
      
      const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
      metricsCollector.updateCacheMetrics(getStationSearchCacheSize(), cacheCount)
    }
    
    // Optimiere Datenbank
    db.pragma('optimize')
  } catch (error) {
    logError(LOG_SCOPE, "Cache cleanup failed", error)
  }
}

// Neue Funktion: Bereinige vergangene Fahrten
function cleanupPastConnections(): void {
  if (!CLEANUP_PAST_CONNECTIONS) {
    return
  }
  
  try {
    const todayStr = getBerlinDateKey()
    
    // Lösche Cache-Einträge mit Datum in der Vergangenheit
    let cacheRemoved = 0
    const allCacheKeys = db.prepare('SELECT cache_key FROM connection_cache').all() as Array<{ cache_key: string }>
    
    for (const row of allCacheKeys) {
      try {
        const parsed = JSON.parse(row.cache_key)
        if (parsed.date && parsed.date < todayStr) {
          db.prepare('DELETE FROM connection_cache WHERE cache_key = ?').run(row.cache_key)
          cacheRemoved++
        }
      } catch {
        // Ignoriere ungültige Cache-Keys
      }
    }
    
    // Lösche Preishistorie für vergangene Daten. Das Entfernen des Kontexts
    // löscht Journeys und Beobachtungen über die Foreign Keys mit.
    const historyRemoved = (stmtCountPastPriceHistory.get(todayStr) as { count: number }).count
    const historyContextsRemoved = stmtCleanupPastPriceHistory.run(todayStr).changes
    
    if (cacheRemoved > 0 || historyRemoved > 0) {
      logInfo(LOG_SCOPE, "Past travel dates cleaned from cache", {
        beforeDate: todayStr,
        connectionCacheRemoved: cacheRemoved,
        priceHistoryRemoved: historyRemoved,
        priceHistoryContextsRemoved: historyContextsRemoved,
      })
      
      const cacheCount = (stmtGetCacheCount.get() as { count: number }).count
      metricsCollector.updateCacheMetrics(getStationSearchCacheSize(), cacheCount)
    }
    
    // Optimiere Datenbank nach größerem Cleanup
    if (cacheRemoved > 100 || historyRemoved > 1000) {
      db.pragma('optimize')
      logInfo(LOG_SCOPE, "Database compaction scheduled for next application start", {
        connectionCacheRemoved: cacheRemoved,
        priceHistoryRemoved: historyRemoved,
      })
    }
  } catch (error) {
    logError(LOG_SCOPE, "Past connection cleanup failed", error)
  }
}

// Cache-Bereinigung alle 6 Stunden
// Nur in Runtime ausführen, nicht beim Build
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' || typeof window === 'undefined') {
  const isRuntime = !process.env.NEXT_PHASE || process.env.NEXT_PHASE === 'phase-production-server'
  
  if (isRuntime) {
    setInterval(cleanupCache, 6 * 60 * 60 * 1000)
    
    // Cleanup vergangener Fahrten einmal täglich (zur Mitternacht + 1 Stunde)
    const scheduleNextPastConnectionsCleanup = () => {
      const now = new Date()
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(1, 0, 0, 0) // 01:00 Uhr
      
      const msUntilNextCleanup = tomorrow.getTime() - now.getTime()
      
      setTimeout(() => {
        cleanupPastConnections()
        // Plane nächsten Cleanup
        setInterval(cleanupPastConnections, 24 * 60 * 60 * 1000)
      }, msUntilNextCleanup)
      
      logInfo(LOG_SCOPE, "Past connection cleanup scheduled", {
        nextRunAt: formatLogDateTime(tomorrow),
      })
    }
    
    // Starte initialen Cleanup vergangener Fahrten
    if (CLEANUP_PAST_CONNECTIONS) {
      logInfo(LOG_SCOPE, "Past connection cleanup enabled", {
        disableWith: "CLEANUP_PAST_CONNECTIONS=false",
      })
      scheduleNextPastConnectionsCleanup()
    } else {
      logWarn(LOG_SCOPE, "Past connection cleanup disabled", {
        enableWith: "CLEANUP_PAST_CONNECTIONS=true or unset",
      })
    }
  }
}

// Graceful Shutdown
process.on('SIGINT', () => {
  db.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  db.close()
  process.exit(0)
})

// Neue Funktion: Hole Preishistorie für einen bestimmten Tag (günstigster Preis pro Abfragezeitpunkt)
export interface PriceHistoryEntry {
  preis: number
  recorded_at: number
}

export function getDayPriceHistory(
  params: {
    startStationId: string
    zielStationId: string
    date: string
    alter: string
    ermaessigungArt: string
    ermaessigungKlasse: string
    klasse: string
  },
  connectionIds?: string[],
  timeFilters?: {
    abfahrtAb?: string
    abfahrtBis?: string
    ankunftAb?: string
    ankunftBis?: string
  }
): PriceHistoryEntry[] {
  try {
    // Wenn keine Connection-IDs übergeben wurden, leere Liste zurückgeben
    if (!connectionIds || connectionIds.length === 0) {
      return []
    }
    
    // Filtere Journeys vor dem MIN()-Aggregat. Die festen 32-Byte-Keys
    // ersetzen die langen, mehrfach gespeicherten Connection-ID-Texte.
    const placeholders = connectionIds.map(() => '?').join(',')
    const query = `
      SELECT MIN(filtered.price) as min_preis, filtered.recorded_at
      FROM (
        SELECT observation.price, observation.recorded_at
        FROM price_history_observation observation
        JOIN price_history_journey journey ON journey.id = observation.journey_id
        JOIN price_history_context context ON context.id = journey.context_id
        WHERE context.start_station_id = ?
          AND context.destination_station_id = ?
          AND context.travel_date = ?
          AND context.age_type = ?
          AND context.discount_type = ?
          AND context.discount_class = ?
          AND context.travel_class = ?
          AND journey.connection_key IN (${placeholders})
      ) AS filtered
      GROUP BY filtered.recorded_at
      ORDER BY filtered.recorded_at ASC
    `
    
    const stmt = db.prepare(query)
    const rows = stmt.all(
      params.startStationId,
      params.zielStationId,
      params.date,
      params.alter,
      params.ermaessigungArt,
      params.ermaessigungKlasse,
      params.klasse,
      ...connectionIds.map(connectionKey)
    ) as Array<{ min_preis: number; recorded_at: number }>
    
    return rows.map(row => ({ preis: row.min_preis, recorded_at: row.recorded_at }))
  } catch (error) {
    logError(LOG_SCOPE, "Could not read day price history", error, {
      travelDate: params.date,
      startStationId: params.startStationId,
      destinationStationId: params.zielStationId,
    })
    return []
  }
}

// Neue Funktion: Hole Preishistorie für eine spezifische Verbindung
export function getConnectionPriceHistory(params: {
  connectionId: string
  alter: string
  ermaessigungArt: string
  ermaessigungKlasse: string
  klasse: string
}): PriceHistoryEntry[] {
  try {
    const rows = stmtGetConnectionPriceHistory.all(
      connectionKey(params.connectionId),
      params.alter,
      params.ermaessigungArt,
      params.ermaessigungKlasse,
      params.klasse
    ) as Array<{ preis: number; recorded_at: number }>
    return rows.map(row => ({ preis: row.preis, recorded_at: row.recorded_at }))
  } catch (error) {
    logError(LOG_SCOPE, "Could not read connection price history", error, {
      connectionId: params.connectionId,
    })
    return []
  }
}

// Stationensuche mit gemeinsamem SQLite-Cache
export interface StationSearchResult {
  extId: string
  id: string
  name: string
  lat?: number
  lon?: number
  type?: string
  products?: string[]
}

function decodeBahnLocationPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value.replace(/\+/g, ' ')
  }
}

function parseBahnLocationId(value: string): { extId: string; name: string; normalizedId: string } | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('A=') || !trimmed.includes('@O=') || !trimmed.includes('@L=')) {
    return null
  }

  const extId = trimmed.match(/@L=([^@]+)@/)?.[1]
  const rawName = trimmed.match(/@O=([^@]+)@/)?.[1]

  if (!extId || !rawName) {
    return null
  }

  return {
    extId,
    name: decodeBahnLocationPart(rawName),
    normalizedId: trimmed.replace(/@p=\d+@/g, '@'),
  }
}

export function getStableStationExtId(station: { extId?: string | null; id?: string | null }): string {
  const extId = station.extId?.trim()
  const id = station.id?.trim()

  if (extId) {
    return parseBahnLocationId(extId)?.extId ?? extId
  }

  if (id) {
    return parseBahnLocationId(id)?.extId ?? id
  }

  return ''
}

export function getCachedStationSearch(searchTerm: string): StationSearchResult[] | null {
  try {
    const parsedLocation = parseBahnLocationId(searchTerm)
    if (parsedLocation) {
      return [{
        extId: parsedLocation.extId,
        id: searchTerm,
        name: parsedLocation.name,
      }]
    }

    const normalizedTerm = searchTerm.toLowerCase().trim()
    const rows = stmtGetStationSearch.all(normalizedTerm, Date.now() - STATION_SEARCH_RETENTION_MS) as Array<{
      ext_id: string
      station_id: string
      name: string
      lat: number | null
      lon: number | null
      station_type: string | null
      products: string | null
    }>
    
    if (rows.length === 0) {
      return null
    }
    
    return rows.map(row => ({
      extId: getStableStationExtId({ extId: row.ext_id, id: row.station_id }),
      id: row.station_id,
      name: row.name,
      lat: row.lat ?? undefined,
      lon: row.lon ?? undefined,
      type: row.station_type ?? undefined,
      products: row.products ? JSON.parse(row.products) : undefined
    }))
  } catch (error) {
    logError(LOG_SCOPE, "Could not read station search cache", error, {
      query: searchTerm,
    })
    return null
  }
}

function normalizeStationSearchTerm(searchTerm: string): string {
  return searchTerm.toLowerCase().trim()
}

function getStationSearchPrefixes(searchTerm: string): string[] {
  const normalizedTerm = normalizeStationSearchTerm(searchTerm)
  const prefixes: string[] = []
  const maxLength = Math.min(normalizedTerm.length, 40)

  for (let length = 2; length <= maxLength; length++) {
    prefixes.push(normalizedTerm.slice(0, length))
  }

  return prefixes
}

export function rankStationSearchResults(searchTerm: string, results: StationSearchResult[]): StationSearchResult[] {
  try {
    const normalizedTerm = normalizeStationSearchTerm(searchTerm)
    const usageRows = stmtGetStationSearchUsage.all(normalizedTerm) as Array<{
      ext_id: string
      click_count: number
    }>
    const usageByExtId = new Map(usageRows.map(row => [row.ext_id, row.click_count]))

    return results
      .map((result, index) => ({
        result,
        index,
        clickCount: usageByExtId.get(result.extId) ?? 0,
      }))
      .sort((a, b) => {
        if (a.clickCount !== b.clickCount) {
          return b.clickCount - a.clickCount
        }
        return a.index - b.index
      })
      .map(item => item.result)
  } catch (error) {
    logError(LOG_SCOPE, "Could not rank station search results", error, {
      query: searchTerm,
      resultCount: results.length,
    })
    return results
  }
}

export function recordStationSearchClick(
  searchTerm: string,
  station: Pick<StationSearchResult, 'extId' | 'name'>
): void {
  try {
    const stationExtId = getStableStationExtId({ extId: station.extId })
    if (!stationExtId || !station.name) {
      return
    }

    const prefixes = getStationSearchPrefixes(searchTerm)
    if (prefixes.length === 0) {
      return
    }

    const now = Date.now()
    const recordClick = db.transaction(() => {
      for (const prefix of prefixes) {
        stmtRecordStationSearchClick.run(prefix, stationExtId, station.name, now)
      }
    })

    recordClick()
  } catch (error) {
    logError(LOG_SCOPE, "Could not record station search click", error, {
      query: searchTerm,
      stationName: station.name,
      stationId: station.extId,
    })
  }
}

export function setCachedStationSearch(searchTerm: string, results: StationSearchResult[]): void {
  try {
    const normalizedTerm = normalizeStationSearchTerm(searchTerm)
    const now = Date.now()
    
    const replaceStationSearch = db.transaction(() => {
      stmtDeleteStationSearchTerm.run(normalizedTerm)
      results.forEach((result, index) => {
        const stableExtId = getStableStationExtId(result)

        // Skip stations without extId (required field)
        if (!stableExtId) {
          logWarn(LOG_SCOPE, "Skipped station search result without extId", {
            query: normalizedTerm,
            stationName: result.name,
          })
          return
        }

        stmtInsertStationSearch.run(
          normalizedTerm,
          stableExtId,
          result.id || result.extId, // Fallback to extId if id is missing
          result.name,
          result.lat ?? null,
          result.lon ?? null,
          result.type ?? null,
          result.products ? JSON.stringify(result.products) : null,
          index,
          now
        )
      })
    })
    replaceStationSearch()

    metricsCollector.updateCacheMetrics(getStationSearchCacheSize(), getCacheSize())
  } catch (error) {
    logError(LOG_SCOPE, "Could not write station search cache", error, {
      query: searchTerm,
      resultCount: results.length,
    })
  }
}

export function getCacheSize(): number {
  try {
    return (stmtGetCacheCount.get() as { count: number }).count
  } catch {
    return 0
  }
}

export function getStationSearchCacheSize(): number {
  try {
    return (stmtGetStationSearchCount.get() as { count: number }).count
  } catch {
    return 0
  }
}
