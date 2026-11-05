import { notFound } from "next/navigation"
import { isFooterEnabled, isPriceSearchDisabled, isUrlaubsfinderEnabled } from "@/lib/shared/feature-flags"
import { PriceSearchUnavailablePage } from "@/components/search/price-search-unavailable-page"
import { PriceSearchSecurity } from "@/components/search/price-search-security"
import UrlauberfinderClientPage from "./urlaubsfinder-client"

export const dynamic = "force-dynamic"

export default function UrlauberfinderPage() {
  if (!isUrlaubsfinderEnabled()) {
    notFound()
  }

  const priceSearchDisabled = isPriceSearchDisabled()
  const page = <UrlauberfinderClientPage showFooter={isFooterEnabled()} searchDisabled={priceSearchDisabled} />

  return <PriceSearchSecurity>{priceSearchDisabled ? <PriceSearchUnavailablePage>{page}</PriceSearchUnavailablePage> : page}</PriceSearchSecurity>
}
