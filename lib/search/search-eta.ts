export interface SearchEtaQueueSnapshot {
  effectiveInterval: number
  sustainedInterval: number
  burstCapacity: number
  pacedBurstCapacity: number
  pacedBurstInterval: number
  nextRateLimitStartDelay: number
  maxConcurrentRequests: number
  averageExecutionTimeMs: number
  activeRequestRemainingTimesMs: number[]
  sessionActiveRemainingTimesMs: number[]
  sessionActiveRequests: number
  otherActiveRequests: number
  waitingRequests: number
  competingSessions: number
  competingRemainingRequests: number
}

export interface SearchEtaInput {
  uncachedRequests: number
  cachedRequests: number
  averageCachedResponseTimeMs: number
  queue: SearchEtaQueueSnapshot
}

function positiveSeconds(milliseconds: number, fallback: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return fallback
  return milliseconds / 1000
}

function buildStartSequence(
  ownQueuedRequests: number,
  competingQueuedRequests: number,
  competingSessions: number,
  waitingRequests: number
): boolean[] {
  const sequence: boolean[] = []
  let ownRemaining = Math.max(0, Math.ceil(ownQueuedRequests))
  let competingRemaining = Math.max(0, Math.ceil(competingQueuedRequests))

  const appendCompeting = (count: number) => {
    const requestsToAppend = Math.min(competingRemaining, Math.max(0, count))
    for (let index = 0; index < requestsToAppend; index++) sequence.push(false)
    competingRemaining -= requestsToAppend
  }

  appendCompeting(waitingRequests)

  while (ownRemaining > 0) {
    sequence.push(true)
    ownRemaining--
    if (ownRemaining > 0) appendCompeting(competingSessions)
  }

  return sequence
}

export function estimateSearchEtaSeconds({
  uncachedRequests,
  cachedRequests,
  averageCachedResponseTimeMs,
  queue,
}: SearchEtaInput): number {
  const normalizedUncached = Math.max(0, Math.ceil(uncachedRequests))
  const normalizedCached = Math.max(0, Math.ceil(cachedRequests))
  if (normalizedUncached === 0 && normalizedCached === 0) return 0

  const concurrency = Math.max(1, Math.floor(queue.maxConcurrentRequests || 1))
  const serviceSeconds = Math.min(
    45,
    Math.max(0.5, positiveSeconds(queue.averageExecutionTimeMs, 2))
  )
  const ownActiveRequests = Math.min(
    normalizedUncached,
    Math.max(0, Math.ceil(queue.sessionActiveRequests))
  )
  const ownQueuedRequests = Math.max(0, normalizedUncached - ownActiveRequests)
  const competingQueuedRequests = Math.max(
    0,
    Math.ceil(queue.competingRemainingRequests) - Math.max(0, queue.otherActiveRequests)
  )
  const startSequence = buildStartSequence(
    ownQueuedRequests,
    competingQueuedRequests,
    Math.max(0, Math.ceil(queue.competingSessions)),
    Math.max(0, Math.ceil(queue.waitingRequests))
  )

  const activeSlotTimes = queue.activeRequestRemainingTimesMs
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value / 1000)
    .slice(0, concurrency)
  while (activeSlotTimes.length < concurrency) activeSlotTimes.push(0)

  const ownActiveCompletion = queue.sessionActiveRemainingTimesMs
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((maximum, value) => Math.max(maximum, value / 1000), 0)

  const effectiveIntervalSeconds = Math.max(
    0.25,
    positiveSeconds(queue.effectiveInterval, 0.45)
  )
  const sustainedIntervalSeconds = Math.max(
    effectiveIntervalSeconds,
    positiveSeconds(queue.sustainedInterval, 2)
  )
  const fastStarts = Math.max(0, Math.floor(queue.burstCapacity))
  const pacedBurstStarts = Math.max(0, Math.floor(queue.pacedBurstCapacity))
  const pacedBurstIntervalSeconds = Math.max(
    effectiveIntervalSeconds,
    positiveSeconds(queue.pacedBurstInterval, 1.25)
  )
  let nextRateLimitedStart = Math.max(
    0,
    positiveSeconds(queue.nextRateLimitStartDelay, 0)
  )
  let latestOwnCompletion = ownActiveCompletion

  startSequence.forEach((isOwnRequest, startIndex) => {
    let earliestSlotIndex = 0
    for (let slotIndex = 1; slotIndex < activeSlotTimes.length; slotIndex++) {
      if (activeSlotTimes[slotIndex] < activeSlotTimes[earliestSlotIndex]) {
        earliestSlotIndex = slotIndex
      }
    }

    const requestStart = Math.max(nextRateLimitedStart, activeSlotTimes[earliestSlotIndex])
    const requestCompletion = requestStart + serviceSeconds
    activeSlotTimes[earliestSlotIndex] = requestCompletion
    if (isOwnRequest) latestOwnCompletion = Math.max(latestOwnCompletion, requestCompletion)

    const nextInterval = startIndex < Math.max(0, fastStarts - 1)
      ? effectiveIntervalSeconds
      : startIndex < Math.max(0, fastStarts + pacedBurstStarts - 1)
        ? pacedBurstIntervalSeconds
        : sustainedIntervalSeconds
    nextRateLimitedStart = requestStart + nextInterval
  })

  const cachedCompletion = normalizedCached > 0
    ? Math.max(0.05, positiveSeconds(averageCachedResponseTimeMs, 0.1))
    : 0

  return Math.max(1, Math.ceil(Math.max(latestOwnCompletion, cachedCompletion)))
}
