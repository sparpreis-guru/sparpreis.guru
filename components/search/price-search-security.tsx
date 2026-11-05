import type { ReactNode } from "react"
import { getTurnstileClientConfig } from "@/lib/security/turnstile"
import { PriceSearchProvider } from "./price-search-provider"
import { SearchSubmissionProvider } from "./search-submission-provider"
import { isPriceSearchDisabled } from "@/lib/shared/feature-flags"

export function PriceSearchSecurity({ children }: { children: ReactNode }) {
  return <PriceSearchProvider config={getTurnstileClientConfig()} stationSearchDisabled={isPriceSearchDisabled()}><SearchSubmissionProvider>{children}</SearchSubmissionProvider></PriceSearchProvider>
}
