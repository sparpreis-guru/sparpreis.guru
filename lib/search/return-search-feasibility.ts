const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
// Even 30 selected dates with only one weekday fit into this window.
// Bound untrusted URLs before enumerating dates or comparing date pairs.
const MAX_SEARCH_WINDOW_DAYS = 366

export const ALL_SEARCH_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

export function parseSearchWeekdays(value?: string) {
  if (!value) return [...ALL_SEARCH_WEEKDAYS]

  try {
    const decoded = decodeURIComponent(value)
    const parsed = decoded.startsWith("[")
      ? JSON.parse(decoded)
      : decoded.split(",").map(Number)

    if (Array.isArray(parsed)) {
      const weekdays = parsed.filter(
        (weekday): weekday is number =>
          typeof weekday === "number" &&
          Number.isInteger(weekday) &&
          weekday >= 0 &&
          weekday <= 6
      )
      if (weekdays.length > 0) return [...new Set(weekdays)]
    }
  } catch {}

  return [...ALL_SEARCH_WEEKDAYS]
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null
}

export function getEligibleDateKeys(from: string, to: string, weekdays: number[]) {
  const start = parseDateKey(from)
  const end = parseDateKey(to)
  if (start === null || end === null || end < start || end - start >= MAX_SEARCH_WINDOW_DAYS * MILLISECONDS_PER_DAY) return []

  const selectedWeekdays = new Set(weekdays)
  const dates: string[] = []
  for (let timestamp = start; timestamp <= end; timestamp += MILLISECONDS_PER_DAY) {
    const date = new Date(timestamp)
    if (selectedWeekdays.has(date.getUTCDay())) {
      dates.push(date.toISOString().slice(0, 10))
    }
  }
  return dates
}

export function getReturnSearchFeasibility({
  outwardDates,
  returnDates,
  minNights,
  maxNights,
}: {
  outwardDates: string[]
  returnDates: string[]
  minNights: number
  maxNights?: number
}) {
  let maximumAvailableNights: number | null = null
  let hasCombination = false

  for (const outwardDate of outwardDates) {
    const outwardTimestamp = parseDateKey(outwardDate)
    if (outwardTimestamp === null) continue

    for (const returnDate of returnDates) {
      const returnTimestamp = parseDateKey(returnDate)
      if (returnTimestamp === null) continue

      const nights = Math.round((returnTimestamp - outwardTimestamp) / MILLISECONDS_PER_DAY)
      if (nights < 0) continue

      maximumAvailableNights = Math.max(maximumAvailableNights ?? nights, nights)
      if (nights >= minNights && (maxNights === undefined || nights <= maxNights)) {
        hasCombination = true
      }
    }
  }

  return { hasCombination, maximumAvailableNights }
}

export function getFeasibleReturnSearchDates({
  outwardDates,
  returnDates,
  minNights,
  maxNights,
}: {
  outwardDates: string[]
  returnDates: string[]
  minNights: number
  maxNights?: number
}) {
  const isValidCombination = (outwardDate: string, returnDate: string) => {
    const outwardTimestamp = parseDateKey(outwardDate)
    const returnTimestamp = parseDateKey(returnDate)
    if (outwardTimestamp === null || returnTimestamp === null) return false

    const nights = Math.round((returnTimestamp - outwardTimestamp) / MILLISECONDS_PER_DAY)
    return nights >= minNights && (maxNights === undefined || nights <= maxNights)
  }

  return {
    outwardDates: outwardDates.filter((outwardDate) =>
      returnDates.some((returnDate) => isValidCombination(outwardDate, returnDate))
    ),
    returnDates: returnDates.filter((returnDate) =>
      outwardDates.some((outwardDate) => isValidCombination(outwardDate, returnDate))
    ),
  }
}
