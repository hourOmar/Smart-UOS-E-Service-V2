// Small display helpers for the Raise Capacity review page.

export const NOT_RECORDED = 'Not recorded'

/** "Oct 11, 2026, 14:05" in the viewer's time zone, or null. */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export const yesNo = (value: boolean | null | undefined, unknown = 'Unresolved') =>
  value === true ? 'Yes' : value === false ? 'No' : unknown

/** "1501211 Programming I", or the ID alone when no name is known. */
export function courseLabel(id: string | number, names: Map<string, string>) {
  const key = String(id)
  return [key, names.get(key)].filter(Boolean).join(' ')
}
