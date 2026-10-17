import type { FlexpreisContext } from "./flexpreis-comparison"

export interface ParsedFlexpreisOffer { amountCents: number; name: string; conditions: string[] }

/** Only accept a bookable whole-journey fare for the requested context. */
export function parseFlexpreisOffer(value: unknown, context: FlexpreisContext): ParsedFlexpreisOffer | null {
  if (!Array.isArray(value)) return null
  const hasCard = context.ermaessigungArt === "BAHNCARD25" || context.ermaessigungArt === "BAHNCARD50"
  const candidates = value.filter((offer: any) => {
    if (!/^Flexpreis(?: Young)?$/.test(offer?.name || "") || offer.klasse !== context.klasse ||
      offer.preis?.waehrung !== "EUR" || !Number.isFinite(offer.preis?.betrag) || offer.preis.betrag <= 0 ||
      offer.teilpreis === true || offer.teilpreis === "true" || offer.angebotAbgelaufen === true) return false
    const fares = offer.hinfahrt?.fahrtAngebote
    if (!Array.isArray(fares) || !fares.length) return false
    return fares.every((fare: any) => /^Flexpreis(?: Young)?$/.test(fare.name || "") &&
      fare.buchbarkeit === "BUCHBAR" && fare.angebotAbgelaufen !== true && !fare.teilpreisDetails &&
      fare.kontext?.typ !== "KOMBINATION" && (hasCard || fare.streichpreis?.betrag === undefined))
  }).sort((a: any, b: any) => a.preis.betrag - b.preis.betrag)
  const offer = candidates[0]
  if (!offer) return null
  const conditions = [offer.konditionsAnzeigen || [], ...offer.hinfahrt.fahrtAngebote.map((f: any) => f.konditionsAnzeigen || [])]
    .flat().map((c: any) => c.textKurz).filter((s: any): s is string => typeof s === "string" && s.length < 1000)
  return { amountCents: Math.round(offer.preis.betrag * 100), name: offer.name, conditions: [...new Set<string>(conditions)] }
}
