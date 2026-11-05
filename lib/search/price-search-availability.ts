import { NextResponse } from "next/server"
import { isPriceSearchDisabled } from "@/lib/shared/feature-flags"

export function getPriceSearchUnavailableResponse() {
  if (!isPriceSearchDisabled()) return null

  return NextResponse.json(
    {
      error: "Bestpreissuche und Urlaubsfinder sind vorübergehend deaktiviert. Akamai blockiert die Bahn-Abfragen dieses Servers. Du kannst sparpreis.guru selbst hosten; die Anleitung findest du im GitHub-Repository.",
      code: "PRICE_SEARCH_DISABLED",
      repositoryUrl: "https://github.com/sparpreis-guru/sparpreis.guru",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  )
}
