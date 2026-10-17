"use client"

import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { flushSync } from "react-dom"
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Info,
  Route,
  Settings,
  Ticket,
  User,
  X,
  Zap,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { getBerlinDateKey } from "@/lib/shared/berlin-date"

export const searchControlClass =
  "h-11 w-full min-w-0 max-w-full box-border px-3 text-base leading-tight rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

export const dateTimeControlClass =
  `${searchControlClass} px-2 text-[16px] appearance-none [-webkit-appearance:none] [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:p-0`

const TIME_PRESETS = [
  { id: "all-day", label: "Ganztägig", hint: "Keine zeitliche Einschränkung", departureFrom: "", departureUntil: "", arrivalFrom: "", arrivalUntil: "" },
  { id: "morning", label: "Morgens", hint: "Abfahrt ab 05:00 Uhr, Ankunft bis 12:00 Uhr", departureFrom: "05:00", departureUntil: "", arrivalFrom: "", arrivalUntil: "12:00" },
  { id: "daytime", label: "Tagsüber", hint: "Abfahrt ab 08:00 Uhr, Ankunft bis 20:00 Uhr", departureFrom: "08:00", departureUntil: "", arrivalFrom: "", arrivalUntil: "20:00" },
  { id: "evening", label: "Abends", hint: "Abfahrt ab 16:00 Uhr, Ankunft bis 23:59 Uhr", departureFrom: "16:00", departureUntil: "", arrivalFrom: "", arrivalUntil: "23:59" },
  { id: "night", label: "Nacht", hint: "Abfahrt ab 20:00 Uhr, Ankunft bis 08:00 Uhr", departureFrom: "20:00", departureUntil: "", arrivalFrom: "", arrivalUntil: "08:00" },
]

export interface TimeRestrictionValues {
  departureFrom: string
  departureUntil: string
  arrivalFrom: string
  arrivalUntil: string
}

function normalizeTimeValue(rawValue: string) {
  const value = rawValue.trim().replace(/[.,]/, ":")
  if (!value) return ""

  let hours: number
  let minutes: number

  if (/^\d{1,2}$/.test(value)) {
    hours = Number(value)
    minutes = 0
  } else if (/^\d{3,4}$/.test(value)) {
    hours = Number(value.slice(0, -2))
    minutes = Number(value.slice(-2))
  } else {
    const match = value.match(/^(\d{1,2}):(\d{0,2})$/)
    if (!match) return null
    hours = Number(match[1])
    minutes = match[2] ? Number(match[2]) : 0
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

export function getTimeRestrictionSummary(values: TimeRestrictionValues) {
  return TIME_PRESETS.find((preset) =>
    preset.departureFrom === values.departureFrom &&
    preset.departureUntil === values.departureUntil &&
    preset.arrivalFrom === values.arrivalFrom &&
    preset.arrivalUntil === values.arrivalUntil
  )?.label || "Individuell"
}

export function DateTimeControlStyle() {
  return (
    <style jsx global>{`
      input[type="date"], input[type="time"] {
        -webkit-appearance: none;
        appearance: none;
        font-size: 16px;
        line-height: 1.2;
      }
      input[type="date"]::-webkit-date-and-time-value,
      input[type="time"]::-webkit-date-and-time-value {
        min-height: 0;
        height: auto;
      }
      input[type="date"]::-webkit-calendar-picker-indicator,
      input[type="time"]::-webkit-clear-button {
        margin: 0;
        padding: 0;
      }
    `}</style>
  )
}

function TimeFilterInfoButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:border-blue-200 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Hinweis zu Zeitfiltern"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs leading-relaxed text-gray-700">
        Ankunftszeiten gelten für den Abfahrtstag. Für Nachtfahrten zum Beispiel Abfahrt frühestens 20:00 und Ankunft spätestens 08:00 setzen.
      </PopoverContent>
    </Popover>
  )
}

function TimeRestrictionFields({
  idPrefix,
  direction,
  values,
  onChange,
}: {
  idPrefix: string
  direction: "Hinfahrt" | "Rückfahrt"
  values: TimeRestrictionValues
  onChange: (values: TimeRestrictionValues) => void
}) {
  const activePreset = TIME_PRESETS.find((preset) =>
    preset.departureFrom === values.departureFrom &&
    preset.departureUntil === values.departureUntil &&
    preset.arrivalFrom === values.arrivalFrom &&
    preset.arrivalUntil === values.arrivalUntil
  )
  const [customMode, setCustomMode] = useState(!activePreset)
  const [customTimesOpen, setCustomTimesOpen] = useState(activePreset?.id !== "all-day")
  const [draftValues, setDraftValues] = useState<TimeRestrictionValues>(values)
  const [invalidFields, setInvalidFields] = useState<Partial<Record<keyof TimeRestrictionValues, boolean>>>({})
  const previousValues = useRef(values)

  useEffect(() => {
    setCustomMode(!activePreset)
    setCustomTimesOpen(activePreset?.id !== "all-day")
  }, [activePreset?.id])

  useEffect(() => {
    const changedFields = (Object.keys(values) as (keyof TimeRestrictionValues)[])
      .filter(field => previousValues.current[field] !== values[field])
    setDraftValues(current => {
      const next = { ...current }
      for (const field of changedFields) next[field] = values[field]
      return next
    })
    setInvalidFields(current => {
      const next = { ...current }
      for (const field of changedFields) delete next[field]
      return next
    })
    previousValues.current = values
  }, [values.arrivalFrom, values.arrivalUntil, values.departureFrom, values.departureUntil])

  const updateCustomValues = (nextValues: TimeRestrictionValues) => {
    setCustomMode(true)
    setCustomTimesOpen(true)
    onChange(nextValues)
  }

  const isReturn = direction === "Rückfahrt"
  const departurePlace = isReturn ? "am Zielbahnhof" : "am Startbahnhof"
  const arrivalPlace = isReturn ? "am Startbahnhof" : "am Zielbahnhof"

  const renderTimeInput = (
    field: keyof TimeRestrictionValues,
    label: string,
    ariaLabel: string
  ) => {
    const commitDraftValue = () => {
      const normalizedValue = normalizeTimeValue(draftValues[field])
      if (normalizedValue === null) {
        setInvalidFields((current) => ({ ...current, [field]: true }))
        return
      }

      setInvalidFields((current) => ({ ...current, [field]: false }))
      setDraftValues((current) => ({ ...current, [field]: normalizedValue }))
      if (normalizedValue !== values[field]) {
        updateCustomValues({ ...values, [field]: normalizedValue })
      }
    }

    return (
      <div className="min-w-0">
        <Label htmlFor={`${idPrefix}-${field}`} className="mb-1 block text-xs font-medium text-gray-600">
          {label}
        </Label>
        <div className="relative">
          <Input
            id={`${idPrefix}-${field}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            pattern="(?:[01]?[0-9]|2[0-3])(?::[0-5][0-9])?"
            value={draftValues[field]}
            placeholder="offen"
            onChange={(event) => {
              const nextValue = event.target.value
              if (/^[\d:.,]*$/.test(nextValue)) {
                setDraftValues((current) => ({ ...current, [field]: nextValue }))
                setInvalidFields((current) => ({ ...current, [field]: false }))
              }
            }}
            onBlur={commitDraftValue}
            onInvalid={() => setInvalidFields((current) => ({ ...current, [field]: true }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            className={`${dateTimeControlClass} pr-12 ${invalidFields[field] ? "border-red-500" : ""} ${draftValues[field] ? "" : "text-gray-500"}`}
            aria-label={ariaLabel}
            aria-invalid={invalidFields[field] || undefined}
            aria-describedby={invalidFields[field] ? `${idPrefix}-${field}-error` : undefined}
          />
          {draftValues[field] ? (
            <button
              type="button"
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraftValues((current) => ({ ...current, [field]: "" }))
                setInvalidFields((current) => ({ ...current, [field]: false }))
                updateCustomValues({ ...values, [field]: "" })
              }}
              aria-label={`${ariaLabel} zurücksetzen`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : <Clock className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />}
        </div>
        {invalidFields[field] && (
          <p id={`${idPrefix}-${field}-error`} role="alert" className="mt-1 text-xs text-red-700">
            Bitte eine Uhrzeit zwischen 00:00 und 23:59 eingeben.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-gray-700">Zeitfenster</legend>
        <p className="mb-2 text-xs text-gray-500">Die Auswahl begrenzt Abfahrt und Ankunft.</p>
        <div className="flex flex-wrap gap-2">
          {TIME_PRESETS.map((preset) => {
            const isActive = !customMode && activePreset?.id === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                className={`min-h-11 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isActive
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                    : "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                }`}
                onClick={() => {
                  const nextValues = {
                    departureFrom: preset.departureFrom,
                    departureUntil: preset.departureUntil,
                    arrivalFrom: preset.arrivalFrom,
                    arrivalUntil: preset.arrivalUntil,
                  }
                  setDraftValues(nextValues)
                  setInvalidFields({})
                  onChange(nextValues)
                  setCustomMode(false)
                  setCustomTimesOpen(preset.id !== "all-day")
                }}
                aria-pressed={isActive}
                title={preset.hint}
              >
                {preset.label}
              </button>
            )
          })}
          <button
            type="button"
            className={`min-h-11 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              customMode
                ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                : "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"
            }`}
            onClick={() => {
              setCustomMode(true)
              setCustomTimesOpen(true)
            }}
            aria-pressed={customMode}
          >
            Individuell
          </button>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {customMode ? "Individuelle Abfahrts- und Ankunftszeiten" : activePreset?.hint}
        </p>
        <TimeFilterInfoButton />
      </div>

      {(customTimesOpen || Object.values(draftValues).some(value => normalizeTimeValue(value) === null)) && (
        <div className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
              <Clock className="h-4 w-4 text-blue-500" />
              Abfahrt {departurePlace}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              {renderTimeInput("departureFrom", "frühestens", `${direction}: Abfahrt frühestens`)}
              <span className="mt-6 text-sm font-medium text-gray-400">–</span>
              {renderTimeInput("departureUntil", "spätestens", `${direction}: Abfahrt spätestens`)}
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
              <Clock className="h-4 w-4 text-blue-500" />
              Ankunft {arrivalPlace}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              {renderTimeInput("arrivalFrom", "frühestens", `${direction}: Ankunft frühestens`)}
              <span className="mt-6 text-sm font-medium text-gray-400">–</span>
              {renderTimeInput("arrivalUntil", "spätestens", `${direction}: Ankunft spätestens`)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function DirectionTimeFiltersModule({
  open,
  onOpenChange,
  includeReturn,
  summary,
  title = "Reisezeiten",
  outboundValues,
  onOutboundChange,
  returnValues,
  onReturnChange,
  outboundBefore,
  returnBefore,
  outboundContext,
  returnContext,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  includeReturn: boolean
  summary: string
  title?: string
  outboundValues: TimeRestrictionValues
  onOutboundChange: (values: TimeRestrictionValues) => void
  returnValues?: TimeRestrictionValues
  onReturnChange?: (values: TimeRestrictionValues) => void
  outboundBefore?: ReactNode
  returnBefore?: ReactNode
  outboundContext?: string
  returnContext?: string
}) {
  const [activeDirection, setActiveDirection] = useState<"outbound" | "return">("outbound")
  const moduleRef = useRef<HTMLDivElement>(null)

  const revealInvalidControl = (target: EventTarget, direction: "outbound" | "return") => {
    // Native validation reports every invalid field, but focuses the first one.
    if (target !== moduleRef.current?.querySelector("input:invalid, select:invalid, textarea:invalid")) return
    flushSync(() => {
      onOpenChange(true)
      setActiveDirection(direction)
    })
  }

  useEffect(() => {
    if (!includeReturn) setActiveDirection("outbound")
  }, [includeReturn])

  const outboundSummary = getTimeRestrictionSummary(outboundValues)
  const returnSummary = returnValues ? getTimeRestrictionSummary(returnValues) : "Ganztägig"
  const showingReturn = includeReturn && activeDirection === "return"

  return (
    <div ref={moduleRef} className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left sm:px-4"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <Clock className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold leading-5 text-gray-800">{title}</span>
            <span className="mt-0.5 block break-words text-xs leading-4 text-gray-500 sm:truncate">{summary}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-blue-700">
          <span className="hidden sm:inline">Optional</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      <div hidden={!open} className="border-t border-gray-100 p-3 sm:p-4">
        {includeReturn ? (
          <div className="mb-4 grid grid-cols-2 rounded-lg bg-gray-100 p-1" role="group" aria-label="Fahrtrichtung für Zeitfilter">
            <button
              type="button"
              aria-pressed={activeDirection === "outbound"}
              className={`rounded-md px-3 py-2 text-left transition ${
                activeDirection === "outbound"
                  ? "bg-white text-blue-800 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              onClick={() => setActiveDirection("outbound")}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <ArrowRight className="h-3.5 w-3.5" />
                Hinfahrt
              </span>
              <span className="mt-0.5 block text-xs opacity-75">
                {outboundContext ? `${outboundContext} · ` : ""}{outboundSummary}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={activeDirection === "return"}
              className={`rounded-md px-3 py-2 text-left transition ${
                activeDirection === "return"
                  ? "bg-white text-blue-800 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              onClick={() => setActiveDirection("return")}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <ArrowRight className="h-3.5 w-3.5 rotate-180" />
                Rückfahrt
              </span>
              <span className="mt-0.5 block text-xs opacity-75">
                {returnContext ? `${returnContext} · ` : ""}{returnSummary}
              </span>
            </button>
          </div>
        ) : null}

        {/* Keep each direction mounted so collapsed drafts retain native validation. */}
        <div
          hidden={showingReturn}
          className="space-y-5"
          onInvalidCapture={event => revealInvalidControl(event.target, "outbound")}
        >
          {outboundBefore}
          <div className={outboundBefore ? "border-t border-gray-100 pt-4" : ""}>
            <TimeRestrictionFields
              idPrefix="outbound"
              direction="Hinfahrt"
              values={outboundValues}
              onChange={onOutboundChange}
            />
          </div>
        </div>
        {includeReturn && (
          <div
            hidden={!showingReturn}
            className="space-y-5"
            onInvalidCapture={event => revealInvalidControl(event.target, "return")}
          >
            {returnBefore}
            <div className={returnBefore ? "border-t border-gray-100 pt-4" : ""}>
              <TimeRestrictionFields
                idPrefix="return"
                direction="Rückfahrt"
                values={returnValues || { departureFrom: "", departureUntil: "", arrivalFrom: "", arrivalUntil: "" }}
                onChange={onReturnChange || (() => {})}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function travelerSummary(age: string, discountType: string, discountClass: string, travelClass: string) {
  const ageText = {
    KIND: "Kind",
    JUGENDLICHER: "Jugendlicher",
    ERWACHSENER: "Erwachsener",
    SENIOR: "Senior",
  }[age] || "Reisender"
  const discountText = discountType === "KEINE_ERMAESSIGUNG"
    ? "keine BahnCard"
    : discountType === "BAHNCARD25"
      ? "BahnCard 25"
      : "BahnCard 50"

  const classText = travelClass === "KLASSE_1" ? "1." : "2."
  const discountClassText = discountType !== "KEINE_ERMAESSIGUNG" && discountClass !== travelClass
    ? ` (${discountClass === "KLASSE_1" ? "1." : "2."} Klasse)`
    : ""
  return `${ageText} · ${discountText}${discountClassText} · ${classText} Klasse`
}

export function FlexPriceComparisonControl({
  tarif,
  onTarifChange,
}: {
  tarif: string
  onTarifChange: (value: string) => void
}) {
  const [showNewBadge, setShowNewBadge] = useState(false)

  useEffect(() => {
    // Hide the introductory badge after four weeks, independently of future releases.
    setShowNewBadge(getBerlinDateKey() < "2026-11-14")
  }, [])

  const enabled = tarif === "FLEXPREIS"
  const description = enabled
      ? "Flexpreise ohne Zugbindung werden je Reisetag geprüft."
      : "Zusätzlich Flexpreise ohne Zugbindung vergleichen."

  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
          <Ticket className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <Label
            htmlFor="compare-flex-prices"
            className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold leading-5 text-gray-800"
          >
            <span>Flexpreise vergleichen</span>
            {showNewBadge && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 text-xs font-medium leading-5 text-violet-700">
                Neu
              </span>
            )}
          </Label>
          <span id="compare-flex-prices-description" className="mt-0.5 block text-xs leading-4 text-gray-500">
            {description}
          </span>
        </span>
      </div>
      <Switch
        id="compare-flex-prices"
        checked={enabled}
        onCheckedChange={(checked) => onTarifChange(checked ? "FLEXPREIS" : "SPARPREIS")}
        aria-describedby="compare-flex-prices-description"
        aria-label="Flexpreise vergleichen"
      />
    </div>
  )
}

export function TravelerOptionsModule({
  open,
  onOpenChange,
  age,
  onAgeChange,
  discountType,
  discountClass,
  onDiscountChange,
  travelClass,
  onTravelClassChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  age: string
  onAgeChange: (value: string) => void
  discountType: string
  discountClass: string
  onDiscountChange: (type: string, discountClass: string) => void
  travelClass: string
  onTravelClassChange: (value: string) => void
}) {
  const fieldId = useId()
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <User className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold leading-5 text-gray-800">Reisender &amp; BahnCard</span>
            <span className="mt-0.5 block break-words text-xs leading-4 text-gray-500 sm:truncate">
              {travelerSummary(age, discountType, discountClass, travelClass)}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-blue-700">
          <span className="hidden sm:inline">Ändern</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${fieldId}-age`} className="mb-1 block text-sm font-medium text-gray-600">
                Alter
              </Label>
              <Select value={age} onValueChange={onAgeChange}>
                <SelectTrigger id={`${fieldId}-age`} className={searchControlClass}>
                  <SelectValue placeholder="Alter wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KIND">Kind (6–14 Jahre)</SelectItem>
                  <SelectItem value="JUGENDLICHER">Jugendlicher (15–26 Jahre)</SelectItem>
                  <SelectItem value="ERWACHSENER">Erwachsener (27–64 Jahre)</SelectItem>
                  <SelectItem value="SENIOR">Senior (ab 65 Jahre)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${fieldId}-discount`} className="mb-1 block text-sm font-medium text-gray-600">
                BahnCard
              </Label>
              <Select
                value={JSON.stringify({ art: discountType, klasse: discountClass })}
                onValueChange={(value) => {
                  try {
                    const parsed = JSON.parse(value)
                    onDiscountChange(parsed.art, parsed.klasse)
                  } catch {}
                }}
              >
                <SelectTrigger id={`${fieldId}-discount`} className={searchControlClass}>
                  <SelectValue placeholder="BahnCard wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={JSON.stringify({ art: "KEINE_ERMAESSIGUNG", klasse: "KLASSENLOS" })}>Keine BahnCard</SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD25", klasse: "KLASSE_2" })}>BahnCard 25, 2. Klasse</SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD25", klasse: "KLASSE_1" })}>BahnCard 25, 1. Klasse</SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD50", klasse: "KLASSE_2" })}>BahnCard 50, 2. Klasse</SelectItem>
                  <SelectItem value={JSON.stringify({ art: "BAHNCARD50", klasse: "KLASSE_1" })}>BahnCard 50, 1. Klasse</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="mt-3">
            <legend className="mb-2 block text-sm font-medium text-gray-600">Reiseklasse</legend>
            <div className="flex gap-3">
              {["KLASSE_1", "KLASSE_2"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    travelClass === value
                      ? "border-blue-400 bg-blue-100 text-blue-900"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50"
                  }`}
                  onClick={() => onTravelClassChange(value)}
                  aria-pressed={travelClass === value}
                >
                  <span className="flex items-center justify-center gap-2">
                    <Check className={`h-4 w-4 ${travelClass === value ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                    {value === "KLASSE_1" ? "1. Klasse" : "2. Klasse"}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

        </div>
      )}
    </div>
  )
}

export function ConnectionOptionsModule({
  open,
  onOpenChange,
  fastConnections,
  onFastConnectionsChange,
  transferOption,
  onTransferOptionChange,
  transferTime,
  onTransferTimeChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  fastConnections: boolean
  onFastConnectionsChange: (active: boolean) => void
  transferOption: string
  onTransferOptionChange: (value: string) => void
  transferTime: string
  onTransferTimeChange: (value: string) => void
}) {
  const direct = transferOption === "direkt"
  const fieldId = useId()
  const lastNonDirectOption = useRef(direct ? "alle" : transferOption)

  useEffect(() => {
    if (!direct) lastNonDirectOption.current = transferOption
  }, [direct, transferOption])

  const connectionSummary = direct
    ? "Nur direkt"
    : transferOption === "alle"
      ? "Beliebig viele Umstiege"
      : `Maximal ${transferOption} ${transferOption === "1" ? "Umstieg" : "Umstiege"}`

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
            <Settings className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold leading-5 text-gray-800">Verbindungseinstellungen</span>
            <span className="mt-0.5 block break-words text-xs leading-4 text-gray-500 sm:truncate">
              {connectionSummary}{fastConnections ? " · schnellste bevorzugt" : ""}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700">
          <span className="hidden sm:inline">Weitere Optionen</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="grid grid-cols-1 items-end gap-3 border-t border-gray-100 p-3 sm:grid-cols-2 sm:p-4">
          <button
            type="button"
            role="switch"
            aria-checked={fastConnections}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-left text-sm font-medium text-gray-700"
            onClick={() => onFastConnectionsChange(!fastConnections)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Zap className="h-4 w-4 text-blue-500" />
              Schnellste Verbindungen bevorzugen
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${fastConnections ? "bg-blue-600" : "bg-gray-300"}`} aria-hidden="true">
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${fastConnections ? "translate-x-5" : "translate-x-0.5"}`} />
            </span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={direct}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-left text-sm font-medium text-gray-700"
            onClick={() => onTransferOptionChange(direct ? lastNonDirectOption.current : "direkt")}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Route className="h-4 w-4 text-blue-500" />
              Nur Direktverbindungen
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${direct ? "bg-blue-600" : "bg-gray-300"}`} aria-hidden="true">
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${direct ? "translate-x-5" : "translate-x-0.5"}`} />
            </span>
          </button>

          <div>
            <Label htmlFor={`${fieldId}-transfers`} className="mb-1 block text-sm font-medium text-gray-600">Maximale Umstiege</Label>
            <Select
              value={direct ? "alle" : transferOption}
              onValueChange={onTransferOptionChange}
              disabled={direct}
            >
              <SelectTrigger id={`${fieldId}-transfers`} className={`${searchControlClass} ${direct ? "opacity-50" : ""}`}>
                <SelectValue>{direct ? "Keine Umstiege" : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Beliebig viele</SelectItem>
                {[1, 2, 3, 4, 5].map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    Maximal {count} {count === 1 ? "Umstieg" : "Umstiege"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor={`${fieldId}-transfer-time`} className="mb-1 block text-sm font-medium text-gray-600">Mindest-Umstiegszeit</Label>
            <Select value={transferTime} onValueChange={onTransferTimeChange} disabled={direct}>
              <SelectTrigger id={`${fieldId}-transfer-time`} className={`${searchControlClass} ${direct ? "opacity-50" : ""}`}>
                <SelectValue>{direct ? "Entfällt bei Direktfahrt" : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                {[5, 10, 15, 20, 25, 30, 35, 40, 45].map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>{minutes} Minuten</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}
