import { PriceSearchVerificationError } from "./turnstile-shared"

export interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    sparpreisTurnstileLoaded?: () => void
  }
}

/** One script per concurrent load, resolved by Cloudflare's API-ready callback. */
export function createTurnstileLoader() {
  let pending: Promise<TurnstileApi> | null = null
  let failedApi: TurnstileApi | undefined
  return function load(): Promise<TurnstileApi> {
    if (pending) return pending
    if (window.turnstile && typeof window.turnstile.render === "function" && window.turnstile !== failedApi) return Promise.resolve(window.turnstile)
    let resolveApi!: (api: TurnstileApi) => void
    let rejectApi!: (error: Error) => void
    const result = new Promise<TurnstileApi>((resolve, reject) => { resolveApi = resolve; rejectApi = reject })
    pending = result
    {
      const script = document.createElement("script")
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        script.onerror = null
        if (window.sparpreisTurnstileLoaded === loaded) delete window.sparpreisTurnstileLoaded
      }
      const fail = () => {
        if (settled) return
        settled = true
        failedApi = window.turnstile
        cleanup()
        script.remove()
        pending = null
        rejectApi(new PriceSearchVerificationError("Die Sicherheitsprüfung konnte nicht geladen werden. Bitte prüfe deine Verbindung und starte die Suche erneut."))
      }
      const loaded = () => {
        if (settled) return
        if (!window.turnstile || typeof window.turnstile.render !== "function") { fail(); return }
        settled = true
        cleanup()
        resolveApi(window.turnstile)
      }
      const timer = setTimeout(fail, 15_000)
      // Register before inserting the script: a cached response can initialize immediately.
      try {
        window.sparpreisTurnstileLoaded = loaded
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=sparpreisTurnstileLoaded"
        script.async = true
        script.onerror = fail
        document.head.appendChild(script)
      } catch { fail() }
    }
    return result
  }
}

export const loadTurnstile = createTurnstileLoader()
