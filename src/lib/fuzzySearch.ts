/**
 * Fuzzy search implementation that supports:
 * - Non-consecutive character matching (e.g., "fllx" matches "flux")
 * - Case-insensitive matching
 * - Scoring based on match quality
 */

export interface FuzzyResult<T> {
  item: T
  score: number
}

/**
 * Calculate fuzzy match score between query and text
 * Returns a score between 0 and 1 (1 being a perfect match)
 * Returns -1 if no match found
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1
  if (!text) return -1

  const q = query.toLowerCase()
  const t = text.toLowerCase()

  // Exact match gets highest score
  if (t === q) return 1

  // Contains gets high score
  if (t.includes(q)) {
    // Bonus for match at start of word
    const words = t.split(/[\s\-_\/]+/)
    for (const word of words) {
      if (word.startsWith(q)) return 0.95
    }
    return 0.9
  }

  // Fuzzy match - characters must appear in order
  let qIdx = 0
  let score = 0
  let consecutiveBonus = 0
  let lastMatchIdx = -2

  for (let tIdx = 0; tIdx < t.length && qIdx < q.length; tIdx++) {
    if (t[tIdx] === q[qIdx]) {
      // Bonus for consecutive matches
      if (tIdx === lastMatchIdx + 1) {
        consecutiveBonus += 0.1
      }
      // Bonus for matching at start of word
      if (tIdx === 0 || /[\s\-_\/]/.test(t[tIdx - 1])) {
        score += 0.15
      }
      score += 0.1
      lastMatchIdx = tIdx
      qIdx++
    }
  }

  // All query characters must be found
  if (qIdx !== q.length) return -1

  // Calculate final score
  const baseScore = score + consecutiveBonus
  const lengthPenalty = q.length / t.length * 0.3
  const finalScore = Math.min(0.85, baseScore + lengthPenalty)

  return finalScore
}

/**
 * Fuzzy search through items
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  getSearchableText: (item: T) => string[]
): FuzzyResult<T>[] {
  if (!query.trim()) {
    return items.map(item => ({ item, score: 1 }))
  }

  const results: FuzzyResult<T>[] = []

  for (const item of items) {
    const texts = getSearchableText(item)
    let bestScore = -1

    for (const text of texts) {
      if (!text) continue
      const score = fuzzyScore(query, text)
      if (score > bestScore) {
        bestScore = score
      }
    }

    if (bestScore > 0) {
      results.push({ item, score: bestScore })
    }
  }

  // Sort by score (highest first)
  return results.sort((a, b) => b.score - a.score)
}

/**
 * Simple check if query fuzzy-matches text
 */
export function fuzzyMatch(query: string, text: string): boolean {
  return fuzzyScore(query, text) > 0
}
