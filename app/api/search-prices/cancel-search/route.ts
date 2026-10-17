import { NextRequest, NextResponse } from "next/server"
import {
  cancelBestpreisSearchSession,
  isBestpreisSearchSessionCancelled,
} from "../rate-limiter"
import { logDebug, logError, logInfo, logWarn } from "@/lib/shared/logger"

const LOG_SCOPE = "bestpreissuche.cancel"

// GET - Prüfe ob Session abgebrochen wurde
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    const isCancelled = isBestpreisSearchSessionCancelled(sessionId)
    
    return NextResponse.json({
      isCancelled,
      sessionId
    })
  } catch (error) {
    logError(LOG_SCOPE, "Could not check cancellation status", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST - Session als abgebrochen markieren
export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { sessionId, reason = 'user_request' } = data
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    // Prüfe ob Session bereits als abgebrochen markiert ist
    if (isBestpreisSearchSessionCancelled(sessionId)) {
      return NextResponse.json({ 
        success: true, 
        sessionId,
        message: "Session already marked as cancelled",
        wasAlreadyCancelled: true
      })
    }

    // Informiere Rate-Limiter über Cancel
    cancelBestpreisSearchSession(sessionId, reason)
    
    const logCancel = reason === "user_request" ? logInfo : logDebug
    logCancel(LOG_SCOPE, "🛑 Search cancellation requested", {
      sessionId,
      reason,
    })

    // Markiere die Session als abgeschlossen in der Progress-Verfolgung
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
      await fetch(`${baseUrl}/api/search-progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          currentDay: 0,
          totalDays: 0,
          currentDate: "",
          isComplete: true, // Markiere als abgeschlossen
          uncachedDays: 0,
          cachedDays: 0,
          averageUncachedResponseTime: 0,
          averageCachedResponseTime: 0,
          queueSize: 0,
          activeRequests: 0,
        }),
      })
      logDebug(LOG_SCOPE, "✅ Progress marked complete after cancellation", { sessionId })
    } catch (progressError) {
      logWarn(LOG_SCOPE, "Could not mark progress complete after cancellation", {
        sessionId,
        error: progressError instanceof Error ? progressError.message : progressError,
      })
      // Nicht kritisch - Cancel funktioniert trotzdem
    }

    return NextResponse.json({ 
      success: true, 
      sessionId,
      message: "Session marked as cancelled" 
    })
  } catch (error) {
    logError(LOG_SCOPE, "Could not cancel search session", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
