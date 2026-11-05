/** Canonical URL state for an explicit submit; no submission marker is stored in the URL. */
export function canonicalSearchQuery(value: string | object) {
  const query = typeof value === "string" || value instanceof URLSearchParams
    ? new URLSearchParams(value)
    : new URLSearchParams()
  if (typeof value !== "string" && !(value instanceof URLSearchParams)) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") query.append(key, item)
      else if (Array.isArray(item)) for (const entry of item) if (typeof entry === "string") query.append(key, entry)
    }
  }
  query.sort()
  return query.toString()
}

export function matchesSubmittedSearch(submitted: string | null, params: object) {
  return submitted !== null && submitted === canonicalSearchQuery(params)
}
