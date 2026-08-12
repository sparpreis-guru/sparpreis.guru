"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ArrowUp, CheckCircle2, CircleX, Loader2, RotateCcw } from "lucide-react"
import type { SearchQueueStatusData } from "@/hooks/use-search-queue-status"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SearchCancelButton } from "./search-cancel-button"
import { formatEta, SearchQueueStatus } from "./search-queue-status"

function formatElapsedTime(seconds: number | null): string {
  if (seconds === null) return "nicht erfasst"
  if (seconds < 1) return "< 1 Sek."
  if (seconds < 60) return `${seconds} Sek.`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes} Min. ${remainingSeconds} Sek.` : `${minutes} Min.`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours} Std. ${remainingMinutes} Min.` : `${hours} Std.`
}

interface SearchProgressPanelProps {
  isActive: boolean
  completedItems: number
  totalItems: number
  queueStatus: SearchQueueStatusData
  progressUnit: string
  completedUnit: string
  isCancelled?: boolean
  onCancel?: () => void
  onRestart?: () => void
  detail?: ReactNode
}

export function SearchProgressPanel({
  isActive,
  completedItems,
  totalItems,
  queueStatus,
  progressUnit,
  completedUnit,
  isCancelled = false,
  onCancel,
  onRestart,
  detail,
}: SearchProgressPanelProps) {
  const panelId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const wasTimingRef = useRef(isActive)
  const hasAutoScrolledRef = useRef(false)
  const searchStartedAtRef = useRef<number | null>(isActive ? Date.now() : null)
  const [showTerminalShortcut, setShowTerminalShortcut] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(isActive ? 0 : null)
  const safeCompletedItems = Math.max(0, completedItems)
  const safeTotalItems = Math.max(0, totalItems)
  const remainingItems = Math.max(0, safeTotalItems - safeCompletedItems)
  const progress = safeTotalItems > 0
    ? Math.min(100, Math.round((safeCompletedItems / safeTotalItems) * 100))
    : 0
  const state = isActive ? "active" : isCancelled ? "cancelled" : "completed"

  useEffect(() => {
    if (!isActive) {
      hasAutoScrolledRef.current = false
      return
    }
    if (hasAutoScrolledRef.current) return

    let layoutFrame: number | undefined
    const renderFrame = window.requestAnimationFrame(() => {
      layoutFrame = window.requestAnimationFrame(() => {
        if (!panelRef.current || hasAutoScrolledRef.current) return
        hasAutoScrolledRef.current = true
        panelRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    })
    return () => {
      window.cancelAnimationFrame(renderFrame)
      if (layoutFrame !== undefined) window.cancelAnimationFrame(layoutFrame)
    }
  }, [isActive])

  useEffect(() => {
    if (!isActive) {
      if (wasTimingRef.current && searchStartedAtRef.current !== null) {
        setElapsedSeconds(Math.max(0, Math.round((Date.now() - searchStartedAtRef.current) / 1000)))
      }
      wasTimingRef.current = false
      return
    }

    if (!wasTimingRef.current || searchStartedAtRef.current === null) {
      searchStartedAtRef.current = Date.now()
      setElapsedSeconds(0)
    }
    wasTimingRef.current = true

    const updateElapsedTime = () => {
      if (searchStartedAtRef.current === null) return
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - searchStartedAtRef.current) / 1000)))
    }
    updateElapsedTime()
    const timer = window.setInterval(updateElapsedTime, 1000)
    return () => window.clearInterval(timer)
  }, [isActive])

  useEffect(() => {
    if (isActive) {
      setShowTerminalShortcut(false)
      return
    }

    if (!isCancelled) {
      setShowTerminalShortcut(false)
      return
    }

    setShowTerminalShortcut(true)
    const hideTimer = window.setTimeout(() => setShowTerminalShortcut(false), 3000)
    return () => window.clearTimeout(hideTimer)
  }, [isActive, isCancelled])

  if (!isActive && !isCancelled && safeTotalItems === 0) return null

  const scrollToPanel = () => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <>
      <section
        ref={panelRef}
        id={panelId}
        className={cn(
          "scroll-mt-4 overflow-hidden rounded-lg border bg-white shadow-sm",
          state === "active" && "border-blue-200",
          state === "completed" && "border-green-200",
          state === "cancelled" && "border-amber-200"
        )}
        role="status"
        aria-live="polite"
      >
        <div
          className={cn(
            "flex items-start justify-between gap-3 border-b px-4 py-2.5",
            state === "active" && "border-blue-100 bg-blue-50/70",
            state === "completed" && "border-green-100 bg-green-50/70",
            state === "cancelled" && "border-amber-100 bg-amber-50/70"
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {state === "active" ? (
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-600" />
            ) : state === "cancelled" ? (
              <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-950">
                {state === "active"
                  ? "Suche läuft"
                  : state === "cancelled"
                    ? "Suche abgebrochen"
                    : "Suche abgeschlossen"}
              </h2>
              <p className="mt-0.5 text-xs text-gray-600">
                {state === "active"
                  ? "Die Ergebnisse werden fortlaufend ergänzt."
                  : state === "cancelled"
                    ? "Die angezeigten Ergebnisse sind unvollständig."
                    : `${safeCompletedItems} ${completedUnit} wurden geprüft.`}
              </p>
            </div>
          </div>
          {isActive && onCancel && <SearchCancelButton onClick={onCancel} />}
          {state === "cancelled" && onRestart && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 shrink-0 border-blue-200 bg-blue-50 px-0 text-xs font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-100 hover:text-blue-800 focus-visible:ring-blue-400 sm:w-auto sm:px-2.5 [&_svg]:size-3.5"
              onClick={onRestart}
              aria-label="Suche wiederholen"
              title="Suche wiederholen"
            >
              <RotateCcw aria-hidden="true" />
              <span className="hidden sm:inline">Suche wiederholen</span>
            </Button>
          )}
        </div>

        <div className="px-4 py-2.5">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4 sm:gap-y-0">
            <div className="min-w-0">
              <dt className="text-[11px] text-gray-500">Fortschritt</dt>
              <dd className="text-sm font-semibold tabular-nums text-gray-950">{progress}%</dd>
            </div>
            <div className="min-w-0" aria-label={`${safeCompletedItems} von ${safeTotalItems} ${progressUnit} geprüft`}>
              <dt className="text-[11px] text-gray-500">Geprüft</dt>
              <dd className="text-sm font-semibold tabular-nums text-gray-950">{safeCompletedItems}/{safeTotalItems}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-gray-500">Offen</dt>
              <dd className="text-sm font-semibold tabular-nums text-gray-950">{remainingItems}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-gray-500">{isActive ? "Restzeit" : "Dauer"}</dt>
              <dd className={cn("truncate text-sm font-semibold tabular-nums", isActive ? "text-blue-700" : "text-gray-950")}>
                {isActive ? `ca. ${formatEta(queueStatus.estimatedTimeRemaining)}` : formatElapsedTime(elapsedSeconds)}
              </dd>
            </div>
          </dl>

          <div className="mt-2 h-1.5 overflow-hidden rounded bg-gray-100">
            <div
              className={cn(
                "h-full rounded transition-all duration-500 ease-out",
                state === "active" && "bg-blue-600",
                state === "completed" && "bg-green-600",
                state === "cancelled" && "bg-amber-500"
              )}
              style={{ width: `${progress || (isActive ? 2 : 0)}%` }}
            />
          </div>

          <div className="mt-2 flex min-h-6 min-w-0 items-center gap-3 text-xs text-gray-600">
            {isActive ? (
              <span className="shrink-0 tabular-nums">Vergangen: {formatElapsedTime(elapsedSeconds)}</span>
            ) : (
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 font-medium",
                  state === "cancelled" ? "text-amber-900" : "text-green-900"
                )}
              >
                {state === "cancelled" ? (
                  <CircleX className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                )}
                <span>{state === "cancelled" ? "Suche vorzeitig beendet." : "Alle geplanten Anfragen verarbeitet."}</span>
              </span>
            )}
            {isActive && <SearchQueueStatus status={queueStatus} inline />}
            {!isActive && detail && <span className="min-w-0 flex-1 truncate">{detail}</span>}
          </div>
        </div>
      </section>

      {(isActive || showTerminalShortcut) && (
        <button
          type="button"
          className={cn(
            "fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-[1500] inline-flex min-h-12 items-center gap-2 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold shadow-xl transition-all sm:bottom-4 sm:right-4",
            state === "active" && "border-blue-700 bg-blue-600 text-white shadow-[0_12px_30px_-12px_rgba(30,64,175,0.65)] hover:bg-blue-700",
            state === "cancelled" && "border-amber-300 bg-white text-amber-950 hover:bg-amber-50"
          )}
          onClick={scrollToPanel}
          aria-controls={panelId}
          aria-label={state === "active" ? `Suche läuft, ${progress} Prozent abgeschlossen. Suchstatus anzeigen` : "Suche abgebrochen. Suchstatus anzeigen"}
          title="Suchstatus anzeigen"
        >
          {state === "active" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white" />
          ) : (
            <CircleX className="h-5 w-5 text-amber-600" />
          )}
          {state === "active" ? (
            <>
              <span>Suche läuft</span>
              <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold tabular-nums ring-1 ring-white/20">
                {progress}%
              </span>
            </>
          ) : (
            <span>
              <span className="block">Suche abgebrochen</span>
              <span className="block text-[10px] font-medium text-amber-800">Ergebnisse unvollständig</span>
            </span>
          )}
          <span className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            state === "active" ? "bg-white/15 text-white ring-1 ring-white/20" : ""
          )}>
            <ArrowUp className="h-4 w-4" />
          </span>
        </button>
      )}
    </>
  )
}
