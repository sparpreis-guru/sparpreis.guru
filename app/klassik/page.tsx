import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ClassicFinder } from "@/components/bestpreissuche/classic-finder"
import { isPriceSearchDisabled } from "@/lib/shared/feature-flags"
import { PriceSearchUnavailablePage } from "@/components/search/price-search-unavailable-page"
import { PriceSearchSecurity } from "@/components/search/price-search-security"
import { canonicalSearchQuery } from "@/lib/search/search-submission"
import { addDaysToDateKey, getEarliestSearchDateKey } from "@/lib/shared/berlin-date"
import "./klassik.css"

export const dynamic = "force-dynamic"

interface SearchParams {
  start?: string
  ziel?: string
  reisezeitraumAb?: string
  reisezeitraumBis?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  klasse?: string
  schnelleVerbindungen?: string
  maximaleUmstiege?: string
  abfahrtAb?: string
  ankunftBis?: string
  umstiegszeit?: string
}

export const metadata: Metadata = {
  title: "Preiskalender Klassik | sparpreis.guru",
  description: "Der klassische Preiskalender im Look von bahn.guru.",
}

export default async function KlassikPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const priceSearchDisabled = isPriceSearchDisabled()
  const params = await searchParams

  if (!priceSearchDisabled && params.start && params.ziel) {
    const tomorrow = getEarliestSearchDateKey()
    const correctedParams = new URLSearchParams()
    let needsRedirect = false

    Object.entries(params).forEach(([key, value]) => {
      if (value) correctedParams.set(key, value)
    })

    if (!params.reisezeitraumAb) {
      correctedParams.set("reisezeitraumAb", tomorrow)
      needsRedirect = true
    } else if (params.reisezeitraumAb < tomorrow) {
      correctedParams.set("reisezeitraumAb", tomorrow)
      needsRedirect = true
    }

    const effectiveStart = correctedParams.get("reisezeitraumAb") || tomorrow
    if (!params.reisezeitraumBis) {
      correctedParams.set("reisezeitraumBis", addDaysToDateKey(effectiveStart, 6))
      needsRedirect = true
    } else if (params.reisezeitraumBis < effectiveStart) {
      correctedParams.set("reisezeitraumBis", addDaysToDateKey(effectiveStart, 6))
      needsRedirect = true
    }

    if (needsRedirect) {
      redirect(`/klassik?${correctedParams.toString()}`)
    }
  }

  const page = (
    <>
      <style>{`
        html {
          background: #fafafa;
          color-scheme: light;
        }

        body {
          margin: 0;
          background: #fafafa;
          color: #333;
        }
      `}</style>
      <ClassicFinder key={canonicalSearchQuery(params)} searchParams={params} searchDisabled={priceSearchDisabled} />
    </>
  )

  return <PriceSearchSecurity>{priceSearchDisabled ? <PriceSearchUnavailablePage>{page}</PriceSearchUnavailablePage> : page}</PriceSearchSecurity>
}
