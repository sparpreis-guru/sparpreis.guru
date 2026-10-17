import { addDaysToDateKey, getBerlinDateKey } from "./berlin-date.ts"

export interface JourneyTimeFilters { abfahrtAb?: string; abfahrtBis?: string; ankunftAb?: string; ankunftBis?: string }

function clock(value: string): number {
  const [hour, minute] = value.split(":").map(Number)
  return hour * 60 + minute
}

function localStamp(value: string): { date: string; minutes: number } | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  // Bahn sends local, offset-free timetable times. Read them as Berlin wall time,
  // independent of the server's TZ. Offset-bearing times are converted explicitly.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
    return match ? { date: match[1], minutes: clock(match[2]) } : null
  }
  const date = new Date(value)
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)
  return { date: getBerlinDateKey(date), minutes: clock(time) }
}

function window(minutes: number, lower?: string, upper?: string): boolean {
  const a = lower ? clock(lower) : null, b = upper ? clock(upper) : null
  if (a !== null && b !== null) return a <= b ? minutes >= a && minutes <= b : minutes >= a || minutes <= b
  return (a === null || minutes >= a) && (b === null || minutes <= b)
}

export function passesTimeFilter(departure: string, arrival: string, filters: JourneyTimeFilters): boolean {
  if (!filters.abfahrtAb && !filters.abfahrtBis && !filters.ankunftAb && !filters.ankunftBis) return true
  const dep = localStamp(departure), arr = localStamp(arrival)
  if (!dep || !arr) return false
  const a = filters.abfahrtAb ? clock(filters.abfahrtAb) : null, b = filters.ankunftBis ? clock(filters.ankunftBis) : null
  const sameDay = dep.date === arr.date
  if (a !== null && b !== null && !filters.abfahrtBis && !filters.ankunftAb) {
    if (a < b) return sameDay && dep.minutes >= a && arr.minutes <= b
    return dep.minutes >= a && (sameDay || (arr.date === addDaysToDateKey(dep.date, 1) && arr.minutes <= b))
  }
  if (!window(dep.minutes, filters.abfahrtAb, filters.abfahrtBis)) return false
  if ((filters.ankunftAb || filters.ankunftBis) && !sameDay) return false
  if (!window(arr.minutes, filters.ankunftAb, filters.ankunftBis)) return false
  return !(a !== null && b !== null && a < b && !sameDay)
}
