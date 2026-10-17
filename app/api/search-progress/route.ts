import { NextRequest, NextResponse } from "next/server"
import {
  cancelBestpreisSearchSession,
  globalRateLimiter,
  isBestpreisSearchSessionCancelled,
  reconRateLimiter,
} from "@/app/api/search-prices/rate-limiter"
import { estimateSearchEtaSeconds } from "@/lib/search/search-eta"
import {
  recordSearchEtaEstimate,
  type SearchEtaType,
} from "@/lib/search/search-eta-tracking"
import { logDebug, logError } from "@/lib/shared/logger"

const LOG_SCOPE = "search-progress"

interface SearchProgressData {
  currentDay: number
  totalDays: number
  currentDate: string
  isComplete: boolean
  uncachedDays?: number
  cachedDays?: number
  remainingRateLimitedRequests?: number
  remainingTagesbestpreisRequests?: number
  remainingReconRequests?: number
  averageUncachedResponseTime?: number
  averageCachedResponseTime?: number
  queueSize?: number
  activeRequests?: number
  timestamp: number
  isActiveSearch?: boolean // Markiert aktive Suchen
}

// In-Memory Storage für Progress-Daten
const progressStorage = new Map<string, SearchProgressData>()

interface RemainingWork {
  total: number
  tagesbestpreis: number
  recon: number
  cached: number
}

function parseRequestedRemainingRequests(url: URL): number | undefined {
  const rawRequestedValue = url.searchParams.get('remainingRequests')
  if (rawRequestedValue === null) return undefined

  const requestedValue = Number(rawRequestedValue)
  if (Number.isFinite(requestedValue) && requestedValue >= 0) {
    return Math.min(Math.ceil(requestedValue), 500)
  }

  return undefined
}

function parseSearchType(url: URL): SearchEtaType {
  const searchType = url.searchParams.get('searchType')
  if (searchType === 'bestpreissuche' || searchType === 'urlaubsfinder') return searchType
  return 'unknown'
}

function getRemainingWork(
  url: URL,
  progressData: SearchProgressData | undefined,
  tagesbestpreisQueue: ReturnType<typeof globalRateLimiter.getQueueStatus>,
  reconQueue: ReturnType<typeof reconRateLimiter.getQueueStatus>
): RemainingWork {
  const requestedRemaining = parseRequestedRemainingRequests(url)
  const liveTagesbestpreisRequests =
    tagesbestpreisQueue.sessionQueueSize + tagesbestpreisQueue.sessionActiveRequests
  const liveReconRequests = reconQueue.sessionQueueSize + reconQueue.sessionActiveRequests
  const progressUncached = Math.max(0, progressData?.uncachedDays || 0)
  const progressCached = Math.max(0, progressData?.cachedDays || 0)
  const reportedTagesbestpreis = Math.max(
    0,
    progressData?.remainingTagesbestpreisRequests ??
      progressData?.remainingRateLimitedRequests ??
      progressUncached
  )
  const reportedRecon = Math.max(0, progressData?.remainingReconRequests || 0)
  const tagesbestpreis = Math.max(
    progressData ? reportedTagesbestpreis : (requestedRemaining ?? 0),
    liveTagesbestpreisRequests
  )
  const recon = Math.max(reportedRecon, liveReconRequests)
  const cached = progressData ? progressCached : 0

  return {
    total: tagesbestpreis + recon + cached,
    tagesbestpreis,
    recon,
    cached,
  }
}

function calculateEstimatedTimeRemaining(
  remainingWork: RemainingWork,
  progressData: SearchProgressData | undefined,
  tagesbestpreisQueue: ReturnType<typeof globalRateLimiter.getQueueStatus>,
  reconQueue: ReturnType<typeof reconRateLimiter.getQueueStatus>
): number {
  if (progressData?.isComplete && remainingWork.total === 0) return 0

  const tagesbestpreisEta = estimateSearchEtaSeconds({
    uncachedRequests: remainingWork.tagesbestpreis,
    cachedRequests: remainingWork.cached,
    averageCachedResponseTimeMs: progressData?.averageCachedResponseTime || 100,
    queue: tagesbestpreisQueue,
  })
  const reconEta = estimateSearchEtaSeconds({
    uncachedRequests: remainingWork.recon,
    cachedRequests: 0,
    averageCachedResponseTimeMs: progressData?.averageCachedResponseTime || 100,
    queue: reconQueue,
  })

  return Math.max(tagesbestpreisEta, reconEta)
}

// GET - Progress-Daten abrufen
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    const progressData = progressStorage.get(sessionId)
    const requestedRemaining = parseRequestedRemainingRequests(url)
    if (!progressData?.isComplete) {
      const remainingDays = progressData
        ? Math.max(0, progressData.totalDays - progressData.currentDay)
        : requestedRemaining
      const remainingTagesbestpreisRequests = progressData
        ? Math.max(
            0,
            progressData.remainingTagesbestpreisRequests ??
              progressData.remainingRateLimitedRequests ??
              progressData.uncachedDays ??
              0
          )
        : requestedRemaining
      const remainingReconRequests = progressData
        ? Math.max(0, progressData.remainingReconRequests ?? 0)
        : 0
      globalRateLimiter.heartbeatSearchSession(
        sessionId,
        remainingDays,
        remainingTagesbestpreisRequests
      )
      if (remainingReconRequests > 0) {
        reconRateLimiter.heartbeatSearchSession(
          sessionId,
          remainingDays,
          remainingReconRequests
        )
      } else {
        reconRateLimiter.unregisterSearchSession(sessionId)
      }
    }
    const queueStatus = globalRateLimiter.getQueueStatus(sessionId)
    const reconQueueStatus = reconRateLimiter.getQueueStatus(sessionId)
    const remainingWork = getRemainingWork(
      url,
      progressData,
      queueStatus,
      reconQueueStatus
    )
    const estimatedTimeRemaining = calculateEstimatedTimeRemaining(
      remainingWork,
      progressData,
      queueStatus,
      reconQueueStatus
    )

    const isCancelled = isBestpreisSearchSessionCancelled(sessionId)
    if (!isCancelled && !progressData?.isComplete && remainingWork.total > 0) {
      recordSearchEtaEstimate(sessionId, estimatedTimeRemaining, parseSearchType(url))
    }

    return NextResponse.json({
      currentDay: progressData?.currentDay || 0,
      totalDays: progressData?.totalDays || 0,
      currentDate: progressData?.currentDate || "",
      isComplete: progressData?.isComplete || false,
      estimatedTimeRemaining,
      queueSize: queueStatus.queueSize + reconQueueStatus.queueSize,
      activeRequests: queueStatus.activeRequests + reconQueueStatus.activeRequests,
      totalUsers: Math.max(queueStatus.totalUsers, reconQueueStatus.totalUsers),
      otherActiveSearches: Math.max(
        queueStatus.otherCompetingSearches,
        reconQueueStatus.otherCompetingSearches
      ),
      otherRemainingRequests:
        queueStatus.otherCompetingRemainingRequests +
        reconQueueStatus.otherCompetingRemainingRequests,
      isCancelled,
      isContended: remainingWork.total > 0 && (
        queueStatus.otherCompetingSearches > 0 ||
        reconQueueStatus.otherCompetingSearches > 0
      ),
      isRateLimited: queueStatus.isRateLimited || reconQueueStatus.isRateLimited,
      effectiveInterval: Math.max(
        queueStatus.effectiveInterval,
        reconQueueStatus.effectiveInterval
      ),
      remainingRequests: remainingWork.total,
      remainingTagesbestpreisRequests: remainingWork.tagesbestpreis,
      remainingReconRequests: remainingWork.recon,
    })

  } catch (error) {
    logError(LOG_SCOPE, "Could not read search progress", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST - Progress-Daten speichern
export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { sessionId } = data
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    if (data.isActiveSearch === false) {
      cancelBestpreisSearchSession(sessionId, 'client_inactive')
      return NextResponse.json({ success: true })
    }

    // Speichere Progress-Daten
    progressStorage.set(sessionId, {
      ...data,
      timestamp: Date.now()
    })

    // Wenn die Suche abgeschlossen ist, markiere Session als beendet für den Rate Limiter
    if (data.isComplete) {
      // Session als abgeschlossen markieren, damit sie nicht mehr als aktiv gilt
      // Verwende die cancel-Funktion mit speziellem Grund für abgeschlossene Suchen
      cancelBestpreisSearchSession(sessionId, 'search_completed')
      logDebug(LOG_SCOPE, "✅ Search session marked as completed", { sessionId })
    } else {
      const remainingDays = Math.max(
        0,
        Number(data.totalDays || 0) - Number(data.currentDay || 0)
      )
      const remainingTagesbestpreisRequests = Math.max(
        0,
        Number(
          data.remainingTagesbestpreisRequests ??
          data.remainingRateLimitedRequests ??
          data.uncachedDays ??
          0
        )
      )
      const remainingReconRequests = Math.max(
        0,
        Number(data.remainingReconRequests ?? 0)
      )
      globalRateLimiter.registerSearchSession(
        sessionId,
        remainingDays,
        remainingTagesbestpreisRequests
      )
      if (remainingReconRequests > 0) {
        reconRateLimiter.registerSearchSession(
          sessionId,
          remainingDays,
          remainingReconRequests
        )
      } else {
        reconRateLimiter.unregisterSearchSession(sessionId)
      }
    }

    // Nur wichtige Meilensteine loggen
    if (data.totalDays > 0 && (data.currentDay === 1 || data.currentDay === data.totalDays || data.currentDay % 10 === 0)) {
      logDebug(LOG_SCOPE, "📊 Search progress milestone updated", {
        sessionId,
        currentDay: data.currentDay,
        totalDays: data.totalDays,
        progressPercent: Math.round((data.currentDay / data.totalDays) * 100),
        currentDate: data.currentDate,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError(LOG_SCOPE, "Could not update search progress", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Cleanup alte Progress-Daten (älter als 1 Stunde)
setInterval(() => {
  const now = Date.now()
  const oneHour = 60 * 60 * 1000
  
  for (const [sessionId, data] of progressStorage.entries()) {
    if (now - data.timestamp > oneHour) {
      progressStorage.delete(sessionId)
      logDebug(LOG_SCOPE, "🧹 Old search progress data cleaned up", { sessionId })
    }
  }
}, 5 * 60 * 1000) // Cleanup alle 5 Minuten
