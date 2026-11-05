export const PRICE_SEARCH_ACTIONS = {
  "/api/search-prices": "bestpreissuche",
  "/api/urlaubsfinder": "urlaubsfinder",
  "/api/flexpreis/day": "flexpreis",
} as const

export type PriceSearchPath = keyof typeof PRICE_SEARCH_ACTIONS
export type PriceSearchAction = typeof PRICE_SEARCH_ACTIONS[PriceSearchPath]
export type TurnstileAction = PriceSearchAction | "station-search"

export interface TurnstileClientConfig {
  enabled: boolean
  siteKey: string
  appearance?: "always" | "execute" | "interaction-only"
}

export class PriceSearchVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PriceSearchVerificationError"
  }
}
