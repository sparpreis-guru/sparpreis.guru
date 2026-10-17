export const FLEXPREIS_MAX_RECON_REQUESTS_PER_DAY = 1

export type SearchTarif = "SPARPREIS" | "FLEXPREIS"

export interface UncachedDayRequestWorkload {
  tagesbestpreisRequests: number
  reconRequests: number
}

export function getUncachedDayRequestWorkload(
  tarif: SearchTarif
): UncachedDayRequestWorkload {
  return {
    tagesbestpreisRequests: 1,
    reconRequests: tarif === "FLEXPREIS"
      ? FLEXPREIS_MAX_RECON_REQUESTS_PER_DAY
      : 0,
  }
}

/**
 * Schätzt die rate-limit-relevanten Bahn-API-Aufrufe eines ungecacheten
 * Reisetags. Im Kalender wird eine Vergleichsverbindung pro Tag geprüft.
 * Fehlende Reisewege können zusätzlich eine Fahrplanseite erfordern; die
 * Streaming-Suche aktualisiert diese Schätzung nach der Verbindungssuche.
 */
export function getUncachedDayRequestWeight(tarif: SearchTarif): number {
  const workload = getUncachedDayRequestWorkload(tarif)
  return workload.tagesbestpreisRequests + workload.reconRequests
}

export function estimateUncachedSearchRequests(
  uncachedDays: number,
  tarif: SearchTarif
): number {
  const normalizedDays = Math.max(0, Math.ceil(uncachedDays))
  return normalizedDays * getUncachedDayRequestWeight(tarif)
}
