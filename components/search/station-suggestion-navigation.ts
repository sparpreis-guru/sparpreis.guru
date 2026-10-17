import type { KeyboardEvent } from "react"

export function handleStationSuggestionKeyDown<T>({
  event,
  suggestions,
  open,
  activeIndex,
  onOpenChange,
  onActiveIndexChange,
  onSelect,
  getOptionId,
}: {
  event: KeyboardEvent<HTMLInputElement>
  suggestions: T[]
  open: boolean
  activeIndex: number
  onOpenChange: (open: boolean) => void
  onActiveIndexChange: (index: number) => void
  onSelect: (suggestion: T) => void
  getOptionId: (index: number) => string
}) {
  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape" && open) event.preventDefault()
    onOpenChange(false)
    onActiveIndexChange(-1)
    return
  }

  if (suggestions.length === 0) return

  const activate = (index: number) => {
    onActiveIndexChange(index)
    window.requestAnimationFrame(() => {
      document.getElementById(getOptionId(index))?.scrollIntoView({ block: "nearest" })
    })
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    onOpenChange(true)
    activate(event.key === "ArrowDown"
      ? (activeIndex + 1) % suggestions.length
      : activeIndex > 0 ? activeIndex - 1 : suggestions.length - 1)
  } else if (open && (event.key === "Home" || event.key === "End")) {
    event.preventDefault()
    activate(event.key === "Home" ? 0 : suggestions.length - 1)
  } else if (open && event.key === "Enter" && activeIndex >= 0 && activeIndex < suggestions.length) {
    event.preventDefault()
    onSelect(suggestions[activeIndex])
  }
}
