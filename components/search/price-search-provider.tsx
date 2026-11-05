"use client"

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { Loader2, Search, ShieldCheck, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { createPriceSearchFetch } from "@/lib/security/price-search-fetch"
import { loadTurnstile, type TurnstileApi } from "@/lib/security/turnstile-loader"
import { createStationSearchClient } from "@/lib/security/station-search-fetch"
import { PriceSearchVerificationError, type TurnstileAction, type TurnstileClientConfig } from "@/lib/security/turnstile-shared"

interface Challenge {
  id: number
  action: TurnstileAction
  done: boolean
  timer?: ReturnType<typeof setTimeout>
  finish: (token?: string, error?: Error) => void
}

function TurnstileWidget({ siteKey, challenge, appearance, onInteractionRequired, onInteractionFinished }: {
  siteKey: string
  challenge: Challenge
  appearance: TurnstileClientConfig["appearance"]
  onInteractionRequired: () => void
  onInteractionFinished: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false
    let widgetId: string | undefined
    let api: TurnstileApi | undefined
    loadTurnstile().then(loaded => {
      if (disposed || challenge.done || !container.current) return
      api = loaded
      widgetId = api.render(container.current, {
        sitekey: siteKey, action: challenge.action, theme: "light", size: "flexible", language: "de",
        appearance: appearance || "interaction-only", retry: "never", "refresh-expired": "manual", "refresh-timeout": "manual",
        "response-field": false,
        "before-interactive-callback": () => { if (!disposed && !challenge.done) onInteractionRequired() },
        "after-interactive-callback": () => { if (!disposed && !challenge.done) onInteractionFinished() },
        "unsupported-callback": () => challenge.finish(undefined, new PriceSearchVerificationError("Dein Browser unterstützt die Sicherheitsprüfung nicht. Bitte verwende einen aktuellen Browser.")),
        callback: (token: string) => challenge.finish(token),
        "error-callback": () => challenge.finish(undefined, new PriceSearchVerificationError("Die Sicherheitsprüfung ist fehlgeschlagen. Bitte starte die Suche erneut.")),
        "expired-callback": () => challenge.finish(undefined, new PriceSearchVerificationError("Die Sicherheitsprüfung ist abgelaufen. Bitte starte die Suche erneut.")),
        "timeout-callback": () => challenge.finish(undefined, new PriceSearchVerificationError("Die Sicherheitsprüfung hat zu lange gedauert. Bitte starte die Suche erneut.")),
      })
    }).catch(error => {
      if (!disposed) challenge.finish(undefined, error instanceof Error ? error : new PriceSearchVerificationError("Die Sicherheitsprüfung ist nicht verfügbar."))
    })
    return () => {
      disposed = true
      if (widgetId !== undefined) api?.remove(widgetId)
    }
  }, [challenge, siteKey, appearance, onInteractionRequired, onInteractionFinished])
  return <div ref={container} className="w-full min-w-0 overflow-x-auto" />
}

const PriceSearchContext = createContext(createPriceSearchFetch(null))
export const usePriceSearchFetch = () => useContext(PriceSearchContext)
const TurnstileEnabledContext = createContext(false)
export const useTurnstileEnabled = () => useContext(TurnstileEnabledContext)
const StationSearchContext = createContext(createStationSearchClient(null))
const unavailableStationSearch = async (): Promise<Response> => { throw new DOMException("Suche deaktiviert", "AbortError") }
const unavailableStationClient = { search: unavailableStationSearch, recordSelection: async () => {}, dispose: () => {} }
export const useStationSelection = () => useContext(StationSearchContext).recordSelection

/** Superseded input in one field must not update its suggestions after verification. */
export function useStationSearchFetch() {
  const { search } = useContext(StationSearchContext)
  const pending = useRef(new Map<string, AbortController>())
  useEffect(() => () => {
    for (const controller of pending.current.values()) controller.abort()
    pending.current.clear()
  }, [])
  return useCallback(async (query: string, field = "station") => {
    pending.current.get(field)?.abort()
    if (query.trim().length < 2) return Response.json({ results: [] })
    const controller = new AbortController()
    pending.current.set(field, controller)
    const response = await search(query, { signal: controller.signal })
    controller.signal.throwIfAborted()
    return response
  }, [search])
}

interface VerificationState { active: Challenge | null; config: TurnstileClientConfig }
const VerificationContext = createContext<VerificationState>({ active: null, config: { enabled: false, siteKey: "" } })

export function usePriceSearchVerification() {
  const { active } = useContext(VerificationContext)
  return {
    isVerifying: Boolean(active && active.action !== "station-search"),
    cancelVerification: () => active?.finish(undefined, new DOMException("Suche abgebrochen", "AbortError")),
  }
}

/** Promote the same DOM node into the top layer; never move or remount its Turnstile iframe. */
export function setVerificationDialogMode(dialog: Pick<HTMLDialogElement, "open" | "isConnected" | "close" | "show" | "showModal">, interactive: boolean) {
  if (!dialog.isConnected) return
  if (dialog.open) dialog.close()
  if (interactive) dialog.showModal()
  else dialog.show()
}

type VerificationVariant = "progress" | "classic" | "station"

function VerificationChallenge({ challenge, config, className, variant }: { challenge: Challenge; config: TurnstileClientConfig; className?: string; variant: VerificationVariant }) {
  const [interactive, setInteractive] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const dialogId = useId()
  const setMode = useCallback((required: boolean) => {
    if (!dialog.current || challenge.done) return
    try {
      setVerificationDialogMode(dialog.current, required)
      setInteractive(required)
    } catch {
      challenge.finish(undefined, new PriceSearchVerificationError("Die Sicherheitsprüfung konnte nicht angezeigt werden. Bitte starte die Suche erneut."))
    }
  }, [challenge])
  const requireInteraction = useCallback(() => setMode(true), [setMode])
  const finishInteraction = useCallback(() => setMode(false), [setMode])
  const cancel = () => challenge.finish(undefined, new DOMException("Suche abgebrochen", "AbortError"))

  return (
    <div data-price-search-verification className={cn("min-w-0 font-sans text-sm leading-relaxed", variant === "classic" && "relative", className)} aria-label="Sicherheitsprüfung">
      {variant === "classic" && <div className="flex min-h-6 items-center justify-center gap-2 text-gray-600" role="status">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Sicherheitsprüfung läuft …
      </div>}
      {variant === "progress" && (
        <div className="mb-3 space-y-2.5">
          <ol aria-label="Suchablauf" className="flex items-center gap-3 text-xs font-medium sm:gap-4">
            <li aria-current="step" className="flex min-w-0 flex-1 items-center gap-2 text-blue-800">
              <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-blue-900">
                <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                <span>{interactive ? "Bestätigung nötig" : "Sicherheit prüfen"}</span>
              </span>
              <span className="h-px min-w-3 flex-1 bg-gray-200" aria-hidden="true" />
            </li>
            <li className="flex min-w-0 items-center gap-2 text-gray-600">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Preise suchen<span className="sr-only">, anschließend</span></span>
            </li>
          </ol>
          <p className="text-xs leading-5 text-gray-600">
            {interactive ? (
              <span className="font-medium text-gray-900">Bitte bestätige die Prüfung im geöffneten Fenster.</span>
            ) : (
              <><span className="font-medium text-gray-900">Bitte warte kurz.</span>{" "}Falls eine Bestätigung nötig ist, öffnet sich ein Fenster.</>
            )}
          </p>
        </div>
      )}
      <dialog
        open
        ref={dialog}
        role={interactive ? "dialog" : "presentation"}
        aria-modal={interactive || undefined}
        aria-labelledby={interactive ? `${dialogId}-title` : undefined}
        aria-describedby={interactive ? `${dialogId}-description` : undefined}
        onCancel={event => { event.preventDefault(); cancel() }}
        className={interactive
          ? "fixed inset-0 m-auto max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto rounded-xl border-0 bg-white px-2 py-6 font-sans text-gray-900 shadow-2xl backdrop:bg-slate-900/40 min-[360px]:w-[calc(100%-1rem)] min-[360px]:px-4 sm:p-6"
          : cn("m-0 block min-w-0 max-w-none border-0 p-0 text-inherit", variant === "station"
            ? "fixed bottom-4 left-4 w-[300px] bg-transparent"
            : variant === "classic" ? "absolute left-0 top-full z-10 w-full bg-[#fafafa]" : "relative w-full bg-transparent")}
      >
        <div className={interactive ? "mb-4 space-y-2" : "hidden"}>
          <div className="flex items-center justify-between gap-3">
            <ShieldCheck className="h-6 w-6 text-blue-600" aria-hidden="true" />
            <button type="button" onClick={cancel} className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label="Sicherheitsprüfung abbrechen">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <h2 id={`${dialogId}-title`} className="text-lg font-semibold">Bitte bestätige die Sicherheitsprüfung</h2>
          <p id={`${dialogId}-description`} className="text-sm leading-relaxed text-gray-600">
            {variant === "station" ? "Wir benötigen eine kurze Bestätigung für die Bahnhofssuche." : "Wir benötigen eine kurze Bestätigung, bevor deine Preissuche startet."}
          </p>
        </div>
        <TurnstileWidget siteKey={config.siteKey} challenge={challenge} appearance={variant === "station" ? "interaction-only" : config.appearance}
          onInteractionRequired={requireInteraction} onInteractionFinished={finishInteraction} />
        <p className={cn("text-xs leading-relaxed text-gray-500", interactive ? "mt-4" : variant !== "progress" ? "sr-only" : "mt-1")}>
          Prüfung durch Cloudflare Turnstile.{" "}
          <a href="https://www.cloudflare.com/privacypolicy/" className="rounded-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Datenschutz</a>
        </p>
      </dialog>
    </div>
  )
}

export function PriceSearchVerificationStatus({ className, variant = "progress" }: { className?: string; variant?: VerificationVariant }) {
  const { active, config } = useContext(VerificationContext)
  return active && active.action !== "station-search" ? <VerificationChallenge key={active.id} challenge={active} config={config} className={className} variant={variant} /> : null
}

export function PriceSearchProvider({ config, children, stationSearchDisabled = false }: { config: TurnstileClientConfig; children: ReactNode; stationSearchDisabled?: boolean }) {
  const [active, setActive] = useState<Challenge | null>(null)
  const activeRef = useRef<Challenge | null>(null)
  const queue = useRef<Challenge[]>([])
  const nextId = useRef(0)
  const mounted = useRef(true)
  const pump = useRef<() => void>(() => {})

  pump.current = () => {
    if (!mounted.current || activeRef.current) return
    let next = queue.current.shift()
    while (next?.done) next = queue.current.shift()
    if (!next) return
    const challenge = next
    activeRef.current = challenge
    challenge.timer = setTimeout(() => challenge.finish(undefined, new PriceSearchVerificationError("Die Sicherheitsprüfung hat zu lange gedauert. Bitte starte die Suche erneut.")), 120_000)
    setActive(challenge)
  }

  const getToken = useCallback((action: TurnstileAction, signal?: AbortSignal | null) => new Promise<string>((resolve, reject) => {
    if (!mounted.current || signal?.aborted) { reject(new DOMException("Suche abgebrochen", "AbortError")); return }
    const onAbort = () => challenge.finish(undefined, new DOMException("Suche abgebrochen", "AbortError"))
    const challenge: Challenge = {
      id: ++nextId.current, action, done: false,
      finish: (token, error) => {
        if (challenge.done) return
        challenge.done = true
        clearTimeout(challenge.timer)
        signal?.removeEventListener("abort", onAbort)
        queue.current = queue.current.filter(item => item !== challenge)
        if (activeRef.current === challenge) {
          activeRef.current = null
          if (mounted.current) setActive(null)
        }
        if (error) reject(error)
        else if (token) resolve(token)
        else reject(new PriceSearchVerificationError("Die Sicherheitsprüfung ist fehlgeschlagen."))
        queueMicrotask(() => pump.current())
      },
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    queue.current.push(challenge)
    pump.current()
  }), [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const pending = [...queue.current, ...(activeRef.current ? [activeRef.current] : [])]
      for (const challenge of pending) challenge.finish(undefined, new DOMException("Suche abgebrochen", "AbortError"))
    }
  }, [])

  const priceSearchFetch = useMemo(() => createPriceSearchFetch(!config.enabled ? null : (action, signal) => {
    if (!config.siteKey) return Promise.reject(new PriceSearchVerificationError("Die Sicherheitsprüfung ist derzeit nicht verfügbar. Bitte versuche es später erneut."))
    return getToken(action, signal)
  }), [config.enabled, config.siteKey, getToken])

  const stationSearchClient = useMemo(() => createStationSearchClient(!config.enabled ? null : signal => {
    if (!config.siteKey) return Promise.reject(new PriceSearchVerificationError("Die Sicherheitsprüfung für die Bahnhofssuche ist derzeit nicht verfügbar."))
    return getToken("station-search", signal)
  }), [config.enabled, config.siteKey, getToken])

  const verificationState = useMemo(() => ({ active, config }), [active, config])
  return (
    <PriceSearchContext.Provider value={priceSearchFetch}>
      <TurnstileEnabledContext.Provider value={config.enabled}>
        <StationSearchContext.Provider value={stationSearchDisabled ? unavailableStationClient : stationSearchClient}>
          <VerificationContext.Provider value={verificationState}>
            {children}
            {active?.action === "station-search" && <VerificationChallenge key={active.id} challenge={active} config={config} variant="station" />}
          </VerificationContext.Provider>
        </StationSearchContext.Provider>
      </TurnstileEnabledContext.Provider>
    </PriceSearchContext.Provider>
  )
}
