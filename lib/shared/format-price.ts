/**
 * Formatiert einen Preis als deutsche Euro-Darstellung mit zwei
 * Nachkommastellen. Fehlende, ungültige oder nicht positive Werte ergeben
 * einen Gedankenstrich, damit nirgends eine falsche Zahl als Preis erscheint.
 */
export function formatPrice(price: number | undefined | null): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return "–"
  return price.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
}

/** Space-saving calendar label; exact prices remain in the accessible name and details. */
export function formatCompactPrice(price: number | undefined | null): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return "–"
  const rounded = Math.round(price)
  return rounded === 0 ? "<1€" : `${rounded}€`
}
