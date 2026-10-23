import { AlertTriangle } from "lucide-react"
import type { SearchFailure } from "@/lib/search/search-errors"

export function SearchErrorNotice({ failures, hasResults = false }: {
  failures: SearchFailure[]
  hasResults?: boolean
}) {
  if (failures.length === 0) return null
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-900" role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{hasResults ? "Preisabfrage teilweise fehlgeschlagen" : "Preisabfrage fehlgeschlagen"}</p>
        {hasResults && <p className="mt-1 text-sm">Die angezeigten Ergebnisse sind unvollständig.</p>}
        {[...new Set(failures.map(failure => failure.message))].map(message => (
          <p key={message} className="mt-1 text-sm">{message}</p>
        ))}
      </div>
    </div>
  )
}
