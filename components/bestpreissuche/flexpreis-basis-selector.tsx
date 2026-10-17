"use client"

import { useId } from "react"
import { CalendarDays, ChevronDown, Clock, Info, Shuffle, Train } from "lucide-react"
import { DirectJourneyBadge } from "@/components/search/journey-result"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatFlexpreisBasisOccurrences, formatFlexpreisTypicalDuration, formatFlexpreisTypicalTransfers, type FlexpreisComparison } from "@/lib/search/flexpreis-comparison"

interface FlexpreisBasisSelectorProps {
  comparison?: FlexpreisComparison
  isLoading: boolean
  onChange?: (id: string) => void
  showExplanation?: boolean
}

const factBadgeClassName = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums shadow-none"
const neutralFactBadgeClassName = `${factBadgeClassName} border-gray-200 bg-white text-gray-700`

export function FlexpreisBasisSelector({ comparison, isLoading, onChange, showExplanation = true }: FlexpreisBasisSelectorProps) {
  const id = useId()
  const basis = comparison?.basis
  const hasChoice = Boolean(comparison && (comparison.bases.length > 1 || (!basis && comparison.bases.length > 0)))
  const labelId = `${id}-label`
  const noteId = `${id}-note`
  const factsId = `${id}-facts`
  const descriptionIds = [showExplanation ? noteId : undefined, basis ? factsId : undefined].filter(Boolean).join(" ") || undefined

  return (
    <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 sm:px-4">
      <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-3">
        <div className="min-w-0">
          <label id={labelId} htmlFor={hasChoice ? `${id}-select` : undefined}
            className="mb-1 block text-xs font-medium text-gray-600">
            Reiseweg im Tagesvergleich
          </label>
          {(basis || hasChoice) && comparison ? (
            hasChoice ? (
              <Select value={basis?.id} onValueChange={onChange} disabled={isLoading || !onChange}>
                <SelectTrigger id={`${id}-select`} aria-labelledby={labelId}
                  aria-describedby={descriptionIds}
                  className="h-auto min-h-11 min-w-0 flex-1 cursor-pointer gap-2 border-gray-300 bg-white text-left font-medium text-gray-900 transition-colors hover:border-blue-400 focus:ring-blue-500 disabled:cursor-not-allowed motion-reduce:transition-none [&>span]:line-clamp-none [&>svg]:shrink-0">
                  <span className="min-w-0 flex-1 whitespace-normal break-words"><SelectValue placeholder="Reiseweg auswählen">{basis?.label}</SelectValue></span>
                  <span className="shrink-0 border-l border-gray-200 pl-2 text-xs font-semibold text-blue-700">{basis ? "Ändern" : "Auswählen"}</span>
                </SelectTrigger>
                <SelectContent align="start" collisionPadding={12}
                  className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1.5rem)] motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none">
                  <SelectGroup>
                    <SelectLabel className="whitespace-normal text-xs text-gray-600">Auswahl gilt für alle Reisetage</SelectLabel>
                    {comparison.bases.map(item => (
                      <SelectItem key={item.id} value={item.id} textValue={item.label}
                        className="items-start py-2.5 data-[state=checked]:bg-blue-50 [&>span:last-child]:min-w-0">
                        <span className="block whitespace-normal break-words font-medium text-gray-900">{item.label}</span>
                        <span className="mt-0.5 block whitespace-normal text-xs leading-5 text-gray-600">
                          {formatFlexpreisTypicalDuration(item.typicalDurationMinutes)} · {formatFlexpreisTypicalTransfers(item.typicalTransfers)} · {formatFlexpreisBasisOccurrences(item, comparison.totalDays)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : <p className="min-w-0 break-words text-sm font-semibold text-gray-900">{basis?.label}</p>
          ) : (
            <p className="text-sm text-gray-600" role="status">
              {isLoading ? "Reisewege werden ermittelt …" : "Kein vergleichbarer Reiseweg gefunden."}
            </p>
          )}
        </div>
        {basis && comparison && <div id={factsId} className="border-t border-gray-200 pt-2 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0" role="group" aria-label="Gefundene Verbindungen dieses Reisewegs">
          <span className="sr-only">Treffer dieser Suche</span>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] leading-4 sm:grid-cols-4">
            <div>
              <dt className="mb-0.5 text-gray-500">Übliche Fahrzeit</dt>
              <dd><Badge className={`${factBadgeClassName} border-slate-200 bg-slate-100 text-slate-800`}><Clock className="h-3 w-3 shrink-0" aria-hidden="true" />{formatFlexpreisTypicalDuration(basis.typicalDurationMinutes)}</Badge></dd>
            </div>
            <div>
              <dt className="mb-0.5 text-gray-500">Umstiege</dt>
              <dd>{basis.typicalTransfers === 0 ? <DirectJourneyBadge /> :
                <Badge className={`${factBadgeClassName} border-blue-200 bg-blue-50 text-blue-700`}><Shuffle className="h-3 w-3 shrink-0" aria-hidden="true" />{formatFlexpreisTypicalTransfers(basis.typicalTransfers)}</Badge>
              }</dd>
            </div>
            <div>
              <dt className="mb-0.5 text-gray-500">Gefundene Fahrten</dt>
              <dd><Badge className={neutralFactBadgeClassName}><Train className="h-3 w-3 shrink-0" aria-hidden="true" />{basis.connectionCount}</Badge></dd>
            </div>
            <div>
              <dt className="mb-0.5 text-gray-500">Reisetage</dt>
              <dd><Badge className={neutralFactBadgeClassName}><CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />{basis.dayCount} von {comparison.totalDays}</Badge></dd>
            </div>
          </dl>
        </div>}
      </div>

      {showExplanation && <>
        <div className="mt-2 flex items-start gap-1.5 border-t border-gray-200 pt-1 text-xs leading-5 text-gray-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p id={noteId}>Andere tarifliche Streckenführungen oder Produktklassen können zu abweichenden Flexpreisen führen.</p>
        </div>
        <details className="group mt-1">
          <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 [&::-webkit-details-marker]:hidden">
            Hinweise zum Reiseweg
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="pb-1 pt-1 text-xs leading-5 text-gray-600">
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-y-2">
              <dt className="font-semibold text-gray-800">Vorauswahl</dt>
              <dd className="mb-2 sm:mb-0">Automatisch wählen wir den Reiseweg, den wir an den meisten Reisetagen finden. Bei Gleichstand den schnelleren.</dd>
              <dt className="font-semibold text-gray-800">Ticketgültigkeit</dt>
              <dd className="mb-2 sm:mb-0">Die genutzte Bahn-Schnittstelle liefert nicht die spätere VIA-Angabe des Tickets. Gefundene Zwischenhalte dienen als Orientierung, bestätigen aber keine Streckengültigkeit.</dd>
              <dt className="font-semibold text-gray-800">Preisvergleich</dt>
              <dd>Pro Tag prüfen wir eine konkrete Verbindung mit der gewählten Haltefolge und Produktklasse. Andere VIA-Strecken und Produktklassen (ICE, IC/EC) werden nicht vollständig geprüft, da jede weitere Verbindung eine eigene Preisabfrage benötigt.</dd>
            </dl>
            <p className="mt-3 border-t border-gray-200 pt-2">Die Angaben beziehen sich nur auf diese Suche. Die übliche Fahrzeit ist der Median; bei den Umstiegen zeigen wir die häufigste Anzahl, bei Gleichstand die niedrigere.</p>
          </div>
        </details>
      </>}
    </div>
  )
}
