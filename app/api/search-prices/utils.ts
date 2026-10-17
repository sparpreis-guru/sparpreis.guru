import { getBerlinDateKey } from "@/lib/shared/berlin-date"
import { logError } from "@/lib/shared/logger"

const LOG_SCOPE = "bestpreissuche.progress"

// Durchschnittswerte für Response-Zeiten (ms) - global für alle Sessions
let averageUncachedResponseTime = 2000 // Startwert 2s
let averageCachedResponseTime = 100 // Startwert 0.1s
const alpha = 0.2 // Glättungsfaktor für gleitenden Mittelwert

// Progress-Update-Funktion
export async function updateProgress(
  sessionId: string,
  currentDay: number,
  totalDays: number,
  currentDate: string,
  isComplete = false,
  uncachedDays?: number,
  cachedDays?: number,
  avgUncachedTime?: number,
  avgCachedTime?: number,
  queueSize?: number,
  activeRequests?: number,
  remainingRateLimitedRequests?: number,
  remainingTagesbestpreisRequests?: number,
  remainingReconRequests?: number
) {
  try {
    // Use absolute URL for server-side fetch
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    await fetch(`${baseUrl}/api/search-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        currentDay,
        totalDays,
        currentDate,
        isComplete,
        uncachedDays,
        cachedDays,
        averageUncachedResponseTime: avgUncachedTime,
        averageCachedResponseTime: avgCachedTime,
        queueSize,
        activeRequests,
        remainingRateLimitedRequests,
        remainingTagesbestpreisRequests,
        remainingReconRequests,
      }),
    })
  } catch (error) {
    logError(LOG_SCOPE, "Could not send progress update", error, {
      sessionId,
      currentDay,
      totalDays,
      currentDate,
      isComplete,
    })
  }
}

// Update average response times
export function updateAverageResponseTimes(duration: number, isCached: boolean) {
  if (isCached) {
    averageCachedResponseTime = alpha * duration + (1 - alpha) * averageCachedResponseTime
  } else {
    averageUncachedResponseTime = alpha * duration + (1 - alpha) * averageUncachedResponseTime
  }
}

export function getAverageResponseTimes() {
  return {
    uncached: averageUncachedResponseTime,
    cached: averageCachedResponseTime
  }
}

// Hilfsfunktion für lokales Datum im Format YYYY-MM-DD
export function formatDateKey(date: Date) {
  return getBerlinDateKey(date)
}

// Connection-ID Generierung
export function generateConnectionId(
  startStationId: string,
  zielStationId: string,
  abfahrtsZeitpunkt: string,
  ankunftsZeitpunkt: string,
  umstiegsAnzahl: number
): string {
  return `${startStationId}-${zielStationId}-${abfahrtsZeitpunkt}-${ankunftsZeitpunkt}-${umstiegsAnzahl}`
}

export { passesTimeFilter } from "@/lib/shared/journey-time-filter"
