"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { canonicalSearchQuery } from "@/lib/search/search-submission"

export interface SubmittedStations {
  startStation: { name: string; id: string }
  zielStation: { name: string; id: string }
}

interface SearchSubmission {
  query: string | null
  attempt: number
  stations: SubmittedStations | null
  submit: (query: string, stations?: SubmittedStations) => void
  clear: () => void
}

const SubmissionContext = createContext<SearchSubmission>({ query: null, attempt: 0, stations: null, submit: () => {}, clear: () => {} })
export const useSearchSubmission = () => useContext(SubmissionContext)

export function SearchSubmissionProvider({ children }: { children: ReactNode }) {
  const [submission, setSubmission] = useState({ query: null as string | null, attempt: 0, stations: null as SubmittedStations | null })
  const submit = useCallback((query: string, stations?: SubmittedStations) => setSubmission(previous => ({ query: canonicalSearchQuery(query), attempt: previous.attempt + 1, stations: stations || null })), [])
  const clear = useCallback(() => setSubmission(previous => ({ ...previous, query: null, stations: null })), [])
  useEffect(() => {
    window.addEventListener("popstate", clear)
    return () => window.removeEventListener("popstate", clear)
  }, [clear])
  const value = useMemo(() => ({ ...submission, submit, clear }), [submission, submit, clear])
  return <SubmissionContext.Provider value={value}>{children}</SubmissionContext.Provider>
}
