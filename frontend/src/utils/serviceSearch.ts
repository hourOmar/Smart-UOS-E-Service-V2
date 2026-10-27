// Quick search of the request catalog, ranked as in the final prototype
// (Smart UoS E-Service v3.dc.html): a match in the service name beats one
// in its keywords, which beats one in its description. Queries shorter than
// three letters only match the start of the name or of a word in it.

const words = (text: string) => text.split(/[^a-z0-9']+/).filter(Boolean)

/** 0 means no match; with an empty query every service scores 1. */
export function scoreService(
  query: string,
  name: string,
  keywords = '',
  description = '',
): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1

  const n = name.toLowerCase()
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  if (words(n).some((word) => word.startsWith(q))) return 60
  if (q.length < 3) return 0
  if (n.includes(q)) return 50

  const kws = keywords.toLowerCase().split(/\s+/).filter(Boolean)
  if (kws.some((word) => word.startsWith(q))) return 40
  if (kws.some((word) => word.includes(q))) return 30

  const d = description.toLowerCase()
  if (words(d).some((word) => word.startsWith(q))) return 20
  if (d.includes(q)) return 10
  return 0
}

/**
 * The matching items, best match first; items with the same score keep
 * their catalog order.
 */
export function rankServices<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}
