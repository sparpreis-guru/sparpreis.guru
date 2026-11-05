export function isTurnstileEnabled(): boolean {
  const value = process.env.TURNSTILE_ENABLED?.trim().toLowerCase()
  return value === "true" || value === "1" || value === "yes"
}

export function isPriceSearchDisabled(): boolean {
  const value = process.env.DISABLE_PRICE_SEARCH?.trim().toLowerCase()
  return value === "true" || value === "1" || value === "yes"
}

export function isUrlaubsfinderEnabled(): boolean {
  return process.env.ENABLE_URLAUBSFINDER?.toLowerCase() !== "false"
}

export function isFooterEnabled(): boolean {
  const value = process.env.SHOW_FOOTER?.toLowerCase()
  return value === "true" || value === "1" || value === "yes"
}
