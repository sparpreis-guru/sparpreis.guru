import { isPriceSearchDisabled } from "@/lib/shared/feature-flags"
import { PriceSearchUnavailablePage } from "@/components/search/price-search-unavailable-page"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ClassicFinder } from "@/components/bestpreissuche/classic-finder"
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

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getTomorrowISO() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return formatDateKey(tomorrow)
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

export default async function KlassikPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const priceSearchDisabled = isPriceSearchDisabled()
  const params = await searchParams

  if (!priceSearchDisabled && params.start && params.ziel) {
    const tomorrow = getTomorrowISO()
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
      correctedParams.set("reisezeitraumBis", addDays(effectiveStart, 6))
      needsRedirect = true
    } else if (params.reisezeitraumBis < effectiveStart) {
      correctedParams.set("reisezeitraumBis", addDays(effectiveStart, 6))
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
      <ClassicFinder searchParams={params} searchDisabled={priceSearchDisabled} />
    </>
  )

  return priceSearchDisabled ? <PriceSearchUnavailablePage>{page}</PriceSearchUnavailablePage> : page
}
