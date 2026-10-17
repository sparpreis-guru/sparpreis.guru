import { TrainSearchForm } from "@/components/bestpreissuche/train-search-form"
import { TrainResults } from "@/components/bestpreissuche/train-results"
import { Footer } from "@/components/layout/footer"
import { BrandLogo } from "@/components/layout/brand-logo"
import { FAQPopup } from "@/components/layout/faq-popup"
import { MainNavigation } from "@/components/layout/main-navigation"
import { PageContainer } from "@/components/layout/page-container"
import { isFooterEnabled, isUrlaubsfinderEnabled } from "@/lib/shared/feature-flags"
import {
  getEligibleDateKeys,
  getReturnSearchFeasibility,
  parseSearchWeekdays,
} from "@/lib/search/return-search-feasibility"
import { redirect } from "next/navigation"
import { addDaysToDateKey, getEarliestSearchDateKey } from "@/lib/shared/berlin-date"

interface SearchParams {
  start?: string
  ziel?: string
  reisezeitraumAb?: string
  reisezeitraumBis?: string
  alter?: string
  ermaessigungArt?: string
  ermaessigungKlasse?: string
  abfahrtAb?: string
  abfahrtBis?: string
  ankunftAb?: string
  ankunftBis?: string
  rueckfahrt?: string
  minNaechte?: string
  maxNaechte?: string
  returnAbfahrtAb?: string
  returnAbfahrtBis?: string
  returnAnkunftAb?: string
  returnAnkunftBis?: string
  klasse?: string
  tarif?: string
  schnelleVerbindungen?: string
  nurDeutschlandTicketVerbindungen?: string
  maximaleUmstiege?: string
  umstiegszeit?: string
  wochentage?: string
  returnWochentage?: string
}

function createClassicModeHref(params: SearchParams) {
  const classicParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      classicParams.set(key, value)
    }
  })

  const query = classicParams.toString()
  return query ? `/klassik?${query}` : "/klassik"
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  
  // Validate and correct dates if they're in the past
  if (params.start && params.ziel) {
    const tomorrow = getEarliestSearchDateKey()
    const defaultSearchStart = addDaysToDateKey(tomorrow, 6)
    let needsRedirect = false
    const correctedParams = new URLSearchParams()
    
    // Copy all existing params
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        correctedParams.set(key, value)
      }
    })
    
    // Check and correct reisezeitraumAb
    if (!params.reisezeitraumAb) {
      correctedParams.set('reisezeitraumAb', defaultSearchStart)
      needsRedirect = true
    } else if (params.reisezeitraumAb < tomorrow) {
      correctedParams.set('reisezeitraumAb', tomorrow)
      needsRedirect = true
    }
    
    // Check and correct reisezeitraumBis if it's before reisezeitraumAb
    const effectiveAb = correctedParams.get('reisezeitraumAb') || defaultSearchStart
    
    if (!params.reisezeitraumBis) {
      correctedParams.set('reisezeitraumBis', addDaysToDateKey(effectiveAb, 6))
      needsRedirect = true
    } else if (params.reisezeitraumBis < effectiveAb) {
      correctedParams.set('reisezeitraumBis', addDaysToDateKey(effectiveAb, 6))
      needsRedirect = true
    }
    
    // Redirect if any corrections were made
    if (needsRedirect) {
      redirect(`/?${correctedParams.toString()}`)
    }
  }
  
  const returnSearchIsFeasible = (() => {
    if (params.rueckfahrt !== "1" || !params.reisezeitraumAb || !params.reisezeitraumBis) return true

    const outwardWeekdays = parseSearchWeekdays(params.wochentage)
    const returnWeekdays = params.returnWochentage
      ? parseSearchWeekdays(params.returnWochentage)
      : outwardWeekdays
    const minimumNights = Number(params.minNaechte || "3")
    const maximumNights = params.maxNaechte ? Number(params.maxNaechte) : undefined
    if (!Number.isInteger(minimumNights) || minimumNights < 1) return false
    if (maximumNights !== undefined && (!Number.isInteger(maximumNights) || maximumNights < minimumNights)) return false

    return getReturnSearchFeasibility({
      outwardDates: getEligibleDateKeys(params.reisezeitraumAb, params.reisezeitraumBis, outwardWeekdays),
      returnDates: getEligibleDateKeys(params.reisezeitraumAb, params.reisezeitraumBis, returnWeekdays),
      minNights: minimumNights,
      maxNights: maximumNights,
    }).hasCombination
  })()
  const hasSearch = Boolean(params.start && params.ziel && returnSearchIsFeasible)
  const urlaubsfinderEnabled = isUrlaubsfinderEnabled()
  const footerEnabled = isFooterEnabled()
  const classicModeHref = createClassicModeHref(params)

  return (
    <div className="min-h-screen bg-white">
      <PageContainer>
        <header className="mb-6 px-3 sm:px-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <MainNavigation active="bestpreissuche" showUrlaubsfinder={urlaubsfinderEnabled} variant="mobile" />
              <h1 className="min-w-0">
                <BrandLogo />
              </h1>
            </div>
            <div className="sm:hidden">
              <FAQPopup context="bestpreissuche" />
            </div>
            <div className="hidden sm:block">
              <MainNavigation active="bestpreissuche" showUrlaubsfinder={urlaubsfinderEnabled} />
            </div>
          </div>
        </header>

        <section className="mb-8">
          <TrainSearchForm searchParams={params} classicModeHref={classicModeHref} />
        </section>

          <section className="mb-8">
            {hasSearch ? (
                <TrainResults searchParams={params} />
            ) : <></>}
          </section>
        
        {/* Footer */}
        <Footer show={footerEnabled} />
      </PageContainer>
    </div>
  )
}
