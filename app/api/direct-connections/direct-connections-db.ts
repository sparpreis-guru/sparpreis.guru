import { createHash } from "crypto"
import { createReadStream, promises as fs } from "fs"
import path from "path"
import { gunzipSync } from "zlib"
import Database from "better-sqlite3"
import { logInfo, logWarn } from "@/lib/shared/logger"

const LOG_SCOPE = "direktverbindungen.db"
const RELEASE_API_URL = "https://api.github.com/repos/sparpreis-guru/sparpreis.guru-direct-connections-data/releases/tags/direct-connections-data"
const RELEASE_ASSET_PATH_PREFIX = "/sparpreis-guru/sparpreis.guru-direct-connections-data/releases/download/direct-connections-data/"
const RELEASE_ASSET_NAME_PATTERN = /^direct-connections-(\d{8}T\d{6}Z)-([a-f0-9]{12})\.db$/
const RELEASE_METADATA_SCHEMA_VERSION = 1
const MAX_BYTES = 180 * 1024 * 1024
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000
const FAILED_REFRESH_RETRY_MS = 5 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 45_000

const DATA_DIR = path.join(process.cwd(), "data")
const CACHE_DB_FILE = path.join(DATA_DIR, "direct-connections.db")
const BACKUP_DB_FILE = path.join(DATA_DIR, "direct-connections.db.backup")
const TEMP_DB_FILE = path.join(DATA_DIR, "direct-connections.db.tmp")
const RELEASE_METADATA_FILE = path.join(DATA_DIR, "direct-connections.release.json")
const TEMP_RELEASE_METADATA_FILE = path.join(DATA_DIR, "direct-connections.release.json.tmp")
const BUNDLED_DB_FILE = path.join(process.cwd(), "public", "direct-connections.db")

let db: Database.Database | null = null
let dbPath: string | null = null
let refreshPromise: Promise<void> | null = null
let nextReleaseCheckAt = 0
let overviewJsonCache: string | null = null

interface ReleaseAsset {
  id: number
  name: string
  size: number
  browser_download_url: string
  digest: string | null
}

interface ReleaseResponse {
  tag_name: string
  assets: ReleaseAsset[]
}

interface DatabaseReleaseAsset extends ReleaseAsset {
  digestPrefix: string
  sortKey: string
  version: string
  sha256: string
}

interface CachedReleaseMetadata {
  schemaVersion: typeof RELEASE_METADATA_SCHEMA_VERSION
  assetId: number
  assetName: string
  databaseBytes: number
  sha256: string
  version: string
}

interface LocalDatabase {
  path: string
  version: string
}

export interface DirectConnectionsDbRefreshStatus {
  isRefreshing: boolean
  refreshRequired: boolean
  reason: "missing" | "stale" | null
}

function isAllowedReleaseApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" &&
      parsed.hostname === "api.github.com" &&
      parsed.pathname === "/repos/sparpreis-guru/sparpreis.guru-direct-connections-data/releases/tags/direct-connections-data"
  } catch {
    return false
  }
}

function isAllowedReleaseAssetUrl(url: string, assetName: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      parsed.pathname === `${RELEASE_ASSET_PATH_PREFIX}${assetName}`
  } catch {
    return false
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

function parseReleaseAssetName(assetName: string): Pick<DatabaseReleaseAsset, "digestPrefix" | "sortKey" | "version"> | null {
  const match = RELEASE_ASSET_NAME_PATTERN.exec(assetName)
  if (!match) return null

  const timestamp = match[1]
  const digestPrefix = match[2]
  return {
    digestPrefix,
    sortKey: `${timestamp}-${digestPrefix}`,
    version: timestamp.slice(0, 8),
  }
}

async function readCachedReleaseMetadata(): Promise<CachedReleaseMetadata | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(RELEASE_METADATA_FILE, "utf-8")) as Partial<CachedReleaseMetadata>
    if (
      parsed.schemaVersion !== RELEASE_METADATA_SCHEMA_VERSION ||
      !Number.isSafeInteger(parsed.assetId) ||
      Number(parsed.assetId) <= 0 ||
      typeof parsed.assetName !== "string" ||
      !parseReleaseAssetName(parsed.assetName) ||
      !Number.isSafeInteger(parsed.databaseBytes) ||
      Number(parsed.databaseBytes) <= 0 ||
      typeof parsed.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.sha256) ||
      typeof parsed.version !== "string" ||
      !/^\d{8}$/.test(parsed.version)
    ) {
      return null
    }
    return parsed as CachedReleaseMetadata
  } catch {
    return null
  }
}

async function writeCachedReleaseMetadata(asset: DatabaseReleaseAsset): Promise<void> {
  const metadata: CachedReleaseMetadata = {
    schemaVersion: RELEASE_METADATA_SCHEMA_VERSION,
    assetId: asset.id,
    assetName: asset.name,
    databaseBytes: asset.size,
    sha256: asset.sha256,
    version: asset.version,
  }

  await fs.writeFile(TEMP_RELEASE_METADATA_FILE, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8")
  try {
    await fs.unlink(RELEASE_METADATA_FILE)
  } catch {}
  await fs.rename(TEMP_RELEASE_METADATA_FILE, RELEASE_METADATA_FILE)
}

function inspectDatabase(filePath: string, expectedVersion?: string, checkIntegrity = false): string {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true })

  try {
    if (checkIntegrity) {
      const quickCheck = candidate.pragma("quick_check", { simple: true }) as string
      if (quickCheck !== "ok") {
        throw new Error(`SQLite quick_check failed: ${quickCheck}`)
      }
    }

    const tables = candidate
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('metadata', 'main_data', 'origin_details')")
      .all() as Array<{ name: string }>
    if (tables.length !== 3) {
      throw new Error("Required direct-connections tables are missing")
    }

    const versionRow = candidate
      .prepare("SELECT value FROM metadata WHERE key = 'version'")
      .get() as { value: string } | undefined
    if (!versionRow || !/^\d{8}$/.test(versionRow.value)) {
      throw new Error("Direct-connections database version is invalid")
    }
    if (expectedVersion && versionRow.value !== expectedVersion) {
      throw new Error(`Database version ${versionRow.value} does not match release asset ${expectedVersion}`)
    }

    const mainData = candidate
      .prepare("SELECT length(data_compressed) AS size FROM main_data WHERE id = 1")
      .get() as { size: number } | undefined
    if (!mainData || mainData.size <= 0) {
      throw new Error("Main direct-connections data is missing")
    }

    return versionRow.value
  } finally {
    candidate.close()
  }
}

async function findLocalDatabase(): Promise<LocalDatabase | null> {
  for (const candidatePath of [CACHE_DB_FILE, BACKUP_DB_FILE, BUNDLED_DB_FILE]) {
    if (!(await fileExists(candidatePath))) continue

    try {
      return {
        path: candidatePath,
        version: inspectDatabase(candidatePath),
      }
    } catch {
      // A broken cache must not hide a usable backup or bundled database.
    }
  }

  return null
}

async function activeDbPath(): Promise<string> {
  const localDatabase = await findLocalDatabase()
  if (!localDatabase) {
    throw new Error("No usable direct-connections database is available")
  }
  return localDatabase.path
}

async function getRefreshReason(): Promise<"missing" | "stale" | null> {
  if (Date.now() < nextReleaseCheckAt) return null
  return await findLocalDatabase() ? "stale" : "missing"
}

export async function getDirectConnectionsDbRefreshStatus(): Promise<DirectConnectionsDbRefreshStatus> {
  const reason = await getRefreshReason()

  return {
    isRefreshing: refreshPromise !== null,
    refreshRequired: reason !== null || refreshPromise !== null,
    reason,
  }
}

function closeOpenDatabase() {
  if (db) {
    db.close()
    db = null
    dbPath = null
  }
  overviewJsonCache = null
}

async function fetchLatestDatabaseAsset(): Promise<DatabaseReleaseAsset> {
  if (!isAllowedReleaseApiUrl(RELEASE_API_URL)) {
    throw new Error("Release API URL is not allowlisted")
  }

  const response = await fetch(RELEASE_API_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "sparpreis.guru direct-connections updater",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub release API returned HTTP ${response.status}`)
  }

  const release = await response.json() as ReleaseResponse
  if (release.tag_name !== "direct-connections-data" || !Array.isArray(release.assets)) {
    throw new Error("GitHub release response is invalid")
  }

  const candidates = release.assets.flatMap(asset => {
    const assetName = parseReleaseAssetName(asset.name)
    const digestMatch = /^sha256:([a-f0-9]{64})$/.exec(asset.digest ?? "")
    if (
      !assetName ||
      !digestMatch ||
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_BYTES
    ) {
      return []
    }
    if (!isAllowedReleaseAssetUrl(asset.browser_download_url, asset.name)) {
      return []
    }
    if (!digestMatch[1].startsWith(assetName.digestPrefix)) {
      return []
    }

    return [{
      ...asset,
      ...assetName,
      sha256: digestMatch[1],
    }]
  })

  candidates.sort((left, right) => right.sortKey.localeCompare(left.sortKey))
  const latestAsset = candidates[0]
  if (!latestAsset) {
    throw new Error("GitHub release contains no valid direct-connections database asset")
  }

  return latestAsset
}

async function replaceCachedDatabase(): Promise<void> {
  closeOpenDatabase()

  const hadCache = await fileExists(CACHE_DB_FILE)
  if (hadCache) {
    try {
      await fs.unlink(BACKUP_DB_FILE)
    } catch {}
    await fs.rename(CACHE_DB_FILE, BACKUP_DB_FILE)
  }

  try {
    await fs.rename(TEMP_DB_FILE, CACHE_DB_FILE)
  } catch (error) {
    if (hadCache && !(await fileExists(CACHE_DB_FILE)) && await fileExists(BACKUP_DB_FILE)) {
      await fs.rename(BACKUP_DB_FILE, CACHE_DB_FILE)
    }
    throw error
  }

  try {
    await fs.unlink(BACKUP_DB_FILE)
  } catch {}
}

async function updateFromRelease(): Promise<void> {
  const asset = await fetchLatestDatabaseAsset()
  const localDatabase = await findLocalDatabase()
  const cachedRelease = await readCachedReleaseMetadata()
  if (localDatabase?.path === CACHE_DB_FILE && cachedRelease?.sha256 === asset.sha256) {
    const cacheStat = await fs.stat(CACHE_DB_FILE)
    if (
      cacheStat.size === asset.size &&
      cachedRelease.databaseBytes === asset.size &&
      await sha256File(CACHE_DB_FILE) === asset.sha256
    ) {
      logInfo(LOG_SCOPE, "Direct connections DB is current", {
        asset: cachedRelease.assetName,
        version: localDatabase.version,
      })
      return
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(asset.browser_download_url, {
      signal: controller.signal,
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "sparpreis.guru direct-connections updater",
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub release asset returned HTTP ${response.status}`)
    }

    const contentLength = response.headers.get("content-length")
    if (contentLength && Number(contentLength) > MAX_BYTES) {
      throw new Error(`Remote DB is too large: ${contentLength} bytes`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error("Remote response body is not readable")
    }

    await fs.mkdir(DATA_DIR, { recursive: true })
    const file = await fs.open(TEMP_DB_FILE, "w")
    const hash = createHash("sha256")
    let receivedBytes = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        receivedBytes += value.byteLength
        if (receivedBytes > MAX_BYTES) {
          throw new Error(`Remote DB exceeded ${MAX_BYTES} bytes`)
        }
        hash.update(value)
        await file.write(value)
      }
    } finally {
      await file.close()
    }

    if (receivedBytes !== asset.size) {
      throw new Error(`Downloaded DB size ${receivedBytes} does not match release asset size ${asset.size}`)
    }

    const sha256 = hash.digest("hex")
    if (sha256 !== asset.sha256) {
      throw new Error("Downloaded DB checksum does not match the GitHub release digest")
    }

    inspectDatabase(TEMP_DB_FILE, asset.version, true)
    await replaceCachedDatabase()
    await writeCachedReleaseMetadata(asset)
    logInfo(LOG_SCOPE, "Direct connections DB refreshed", {
      asset: asset.name,
      bytes: receivedBytes,
      version: asset.version,
    })
  } finally {
    clearTimeout(timeout)
    try {
      await fs.unlink(TEMP_DB_FILE)
    } catch {}
    try {
      await fs.unlink(TEMP_RELEASE_METADATA_FILE)
    } catch {}
  }
}

function startRefresh(): Promise<void> {
  if (!refreshPromise) {
    nextReleaseCheckAt = Date.now() + FAILED_REFRESH_RETRY_MS
    refreshPromise = updateFromRelease()
      .then(() => {
        nextReleaseCheckAt = Date.now() + REFRESH_INTERVAL_MS
      })
      .catch(error => {
        logWarn(LOG_SCOPE, "Could not refresh direct connections DB; serving fallback if available", {
          error: error instanceof Error ? error.message : error,
        })
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

export async function getDirectConnectionsDb(): Promise<Database.Database> {
  const localDatabase = await findLocalDatabase()
  let nextPath: string

  if (localDatabase) {
    nextPath = localDatabase.path
    if (Date.now() >= nextReleaseCheckAt) {
      void startRefresh()
    }
  } else {
    await startRefresh()
    nextPath = await activeDbPath()
  }

  if (!db || dbPath !== nextPath) {
    closeOpenDatabase()
    db = new Database(nextPath, { readonly: true, fileMustExist: true })
    dbPath = nextPath
  }

  return db
}

export function readOverviewJson(database: Database.Database): string {
  if (overviewJsonCache) return overviewJsonCache

  const row = database
    .prepare("SELECT data_compressed FROM main_data WHERE id = 1")
    .get() as { data_compressed: Buffer } | undefined
  if (!row) {
    throw new Error("Main direct connection data missing")
  }

  overviewJsonCache = gunzipSync(row.data_compressed).toString("utf-8")
  return overviewJsonCache
}
