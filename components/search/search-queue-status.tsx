"use client"

import { useEffect, useState } from "react"
import { ChevronDown, TriangleAlert, Users } from "lucide-react"
import type { SearchQueueStatusData } from "@/hooks/use-search-queue-status"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function formatEta(seconds: number): string {
  const safeSeconds = Math.max(1, Math.ceil(seconds))
  const roundedSeconds = safeSeconds < 60
    ? Math.ceil(safeSeconds / 5) * 5
    : safeSeconds < 5 * 60
      ? Math.ceil(safeSeconds / 15) * 15
      : Math.ceil(safeSeconds / 60) * 60
  if (roundedSeconds < 60) return `${roundedSeconds} Sek.`

  const minutes = Math.floor(roundedSeconds / 60)
  const remainingSeconds = roundedSeconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes} Min. ${remainingSeconds} Sek.`
      : `${minutes} Min.`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0
    ? `${hours} Std. ${remainingMinutes} Min.`
    : `${hours} Std.`
}

export function SearchQueueStatus({
  status,
  className,
  embedded = false,
  inline = false,
}: {
  status: SearchQueueStatusData
  className?: string
  embedded?: boolean
  inline?: boolean
}) {
  const [isHovered, setIsHovered] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const hasDelayNotice = status.isContended || status.isRateLimited

  useEffect(() => {
    if (hasDelayNotice) return
    setIsHovered(false)
    setIsPinned(false)
  }, [hasDelayNotice])

  if (!hasDelayNotice) return null

  const contentionMessage = status.isContended
    ? `Aktuell sind insgesamt ${status.otherActiveSearches + 1} Suchen aktiv. ${
        status.otherRemainingRequests > 0
          ? status.otherActiveSearches === 1
            ? `Die andere Suche hat noch ${status.otherRemainingRequests.toLocaleString("de-DE")} offene ${status.otherRemainingRequests === 1 ? "Anfrage" : "Anfragen"}. `
            : `Die anderen Suchen haben zusammen noch ${status.otherRemainingRequests.toLocaleString("de-DE")} offene Anfragen. `
          : ""
      }Die Anfragen werden fair abwechselnd verarbeitet, daher kann deine Suche etwas länger dauern.`
    : null
  const rateLimitMessage = status.isRateLimited
    ? "Die DB begrenzt Anfragen aktuell. Ergebnisse erscheinen weiterhin nach und nach."
    : null
  const contentionSummary = status.isContended
    ? `${status.otherActiveSearches + 1} Suchen${
        status.otherRemainingRequests > 0
          ? ` · ${status.otherRemainingRequests.toLocaleString("de-DE")} ${status.otherRemainingRequests === 1 ? "Anfrage" : "Anfragen"} offen`
          : " aktiv"
      }`
    : null

  if (inline) {
    const isOpen = isHovered || isPinned
    const triggerLabel = contentionSummary ?? "DB-Limit aktiv"

    return (
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsPinned(true)
          } else {
            setIsPinned(false)
            setIsHovered(false)
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex min-w-0 max-w-full shrink items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 transition-colors hover:border-amber-300 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1",
              className
            )}
            aria-label={`${triggerLabel}. Mehr Informationen anzeigen`}
            title="Weitere Informationen anzeigen"
            onPointerEnter={() => setIsHovered(true)}
            onPointerLeave={() => setIsHovered(false)}
            onFocus={() => setIsHovered(true)}
            onBlur={() => setIsHovered(false)}
            onClick={(event) => {
              event.preventDefault()
              setIsPinned((pinned) => !pinned)
              setIsHovered(false)
            }}
          >
            {status.isContended ? (
              <Users className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{triggerLabel}</span>
            {status.isContended && status.isRateLimited && (
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            <ChevronDown
              className={cn("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="z-[2000] w-80 max-w-[calc(100vw-2rem)] space-y-2.5 p-3 text-xs leading-relaxed text-gray-700"
          onPointerEnter={() => setIsHovered(true)}
          onPointerLeave={() => setIsHovered(false)}
        >
          {contentionMessage && (
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <div className="font-semibold text-amber-950">Faire Warteschlange</div>
                <p>{contentionMessage}</p>
              </div>
            </div>
          )}
          {rateLimitMessage && (
            <div className={cn("flex items-start gap-2", contentionMessage && "border-t border-gray-100 pt-2.5")}>
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <div className="font-semibold text-amber-950">Aktuelles DB-Limit</div>
                <p>{rateLimitMessage}</p>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <div
      className={cn(
        embedded ? "border-t px-0 pt-2 text-xs" : "rounded-lg border px-3 py-2 text-sm",
        hasDelayNotice
          ? embedded ? "border-amber-200 text-amber-900" : "border-amber-200 bg-amber-50 text-amber-900"
          : embedded ? "border-blue-100 text-blue-900" : "border-blue-100 bg-blue-50/70 text-blue-900",
        className
      )}
      role={embedded ? undefined : "status"}
      aria-live={embedded ? undefined : "polite"}
    >
      {status.isContended && (
        <div className="flex items-start gap-2 text-xs">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{contentionMessage}</span>
        </div>
      )}

      {status.isRateLimited && (
        <div className={cn("flex items-start gap-2 text-xs", status.isContended && "mt-1.5")}>
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{rateLimitMessage}</span>
        </div>
      )}
    </div>
  )
}
