"use client"

import { useEffect, useRef, useState } from "react"

export interface SearchQueueStatusData {
  estimatedTimeRemaining: number
  otherActiveSearches: number
  otherRemainingRequests: number
  isContended: boolean
  isRateLimited: boolean
}

interface UseSearchQueueStatusOptions {
  sessionId?: string | null
  isActive: boolean
  remainingRequests: number
  searchType: "bestpreissuche" | "urlaubsfinder"
}

function estimateInitialSeconds(remainingRequests: number): number {
  const normalizedRequests = Math.max(1, Math.ceil(remainingRequests))
  const burstStartsAfterInitialSlots = Math.min(7, Math.max(0, normalizedRequests - 3))
  const pacedBurstStarts = Math.min(20, Math.max(0, normalizedRequests - 10))
  const sustainedStarts = Math.max(0, normalizedRequests - 30)
  return Math.max(
    2,
    Math.ceil(
      2 +
      burstStartsAfterInitialSlots * 0.45 +
      pacedBurstStarts * 1.25 +
      sustainedStarts * 2
    )
  )
}

export function useSearchQueueStatus({
  sessionId,
  isActive,
  remainingRequests,
  searchType,
}: UseSearchQueueStatusOptions): SearchQueueStatusData {
  const normalizedRemainingRequests = Math.max(0, remainingRequests)
  const remainingRequestsRef = useRef(normalizedRemainingRequests)
  const hasServerEstimateRef = useRef(false)
  remainingRequestsRef.current = normalizedRemainingRequests
  const fallbackStatus: SearchQueueStatusData = {
    estimatedTimeRemaining: estimateInitialSeconds(normalizedRemainingRequests),
    otherActiveSearches: 0,
    otherRemainingRequests: 0,
    isContended: false,
    isRateLimited: false,
  }
  const [status, setStatus] = useState<SearchQueueStatusData>(fallbackStatus)

  useEffect(() => {
    if (!isActive) return

    if (!sessionId) {
      setStatus(fallbackStatus)
      return
    }

    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    hasServerEstimateRef.current = false

    const poll = async () => {
      try {
        const params = new URLSearchParams({
          sessionId,
          remainingRequests: String(remainingRequestsRef.current),
          searchType,
        })
        const response = await fetch(`/api/search-progress?${params.toString()}`, {
          cache: "no-store",
        })

        if (response.ok && !cancelled) {
          const data = await response.json()
          if (data.isCancelled) {
            cancelled = true
            return
          }
          const rawEstimate = Math.max(1, Number(data.estimatedTimeRemaining) || 1)
          const shouldSmoothEstimate = hasServerEstimateRef.current
          hasServerEstimateRef.current = true
          setStatus((previousStatus) => {
            const estimatedTimeRemaining = shouldSmoothEstimate
              ? Math.ceil(
                  rawEstimate > previousStatus.estimatedTimeRemaining
                    ? previousStatus.estimatedTimeRemaining * 0.35 + rawEstimate * 0.65
                    : previousStatus.estimatedTimeRemaining * 0.65 + rawEstimate * 0.35
                )
              : rawEstimate

            return {
              estimatedTimeRemaining,
              otherActiveSearches: Math.max(0, Number(data.otherActiveSearches) || 0),
              otherRemainingRequests: Math.max(0, Number(data.otherRemainingRequests) || 0),
              isContended: Boolean(data.isContended),
              isRateLimited: Boolean(data.isRateLimited),
            }
          })
        }
      } catch {
        // Keep the last useful estimate if a progress poll fails.
      }

      if (!cancelled) {
        pollTimer = setTimeout(poll, 1000)
      }
    }

    setStatus({
      estimatedTimeRemaining: estimateInitialSeconds(remainingRequestsRef.current),
      otherActiveSearches: 0,
      otherRemainingRequests: 0,
      isContended: false,
      isRateLimited: false,
    })
    void poll()

    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [isActive, searchType, sessionId])

  return sessionId ? status : fallbackStatus
}
