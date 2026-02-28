/**
 * FZF-like fuzzy search implementation with:
 * - Smart case (case insensitive if query is lowercase, sensitive otherwise)
 * - Non-consecutive character matching
 * - Extended search syntax: space-separated terms (AND), ^prefix, suffix$, 'exact, !negation
 * - Scoring based on match quality (consecutive, word boundary, position)
 */

export interface FuzzyResult<T> {
  item: T;
  score: number;
  matches?: Array<[number, number]>; // Start and end indices of matches
}

interface MatchResult {
  score: number;
  matches: Array<[number, number]>;
}

/**
 * Check if query should be case sensitive (has uppercase letters)
 */
function isCaseSensitive(_query: string): boolean {
  // Always case-insensitive so uppercase letters also match
  return false;
}

/**
 * FZF-style fuzzy match with scoring
 * Higher scores are better, -1 means no match
 */
function fzfMatch(query: string, text: string): MatchResult | null {
  if (!query) return { score: 0, matches: [] };
  if (!text) return null;

  const caseSensitive = isCaseSensitive(query);
  const q = caseSensitive ? query : query.toLowerCase();
  const t = caseSensitive ? text : text.toLowerCase();
  const originalText = text;

  // Exact match gets highest score
  if (t === q) {
    return { score: 10000, matches: [[0, text.length]] };
  }

  // Check for exact substring match (high score)
  const exactIdx = t.indexOf(q);
  if (exactIdx !== -1) {
    let score = 5000;
    // Bonus for match at start
    if (exactIdx === 0) score += 1000;
    // Bonus for match at word boundary
    if (exactIdx === 0 || /[\s\-_\/.]/.test(originalText[exactIdx - 1])) {
      score += 500;
    }
    // Penalty for longer strings
    score -= (text.length - query.length) * 2;
    return { score, matches: [[exactIdx, exactIdx + query.length]] };
  }

  // Fuzzy match - find best path through characters
  const result = findBestMatch(q, t, originalText);
  return result;
}

/**
 * Find the best fuzzy match path using dynamic programming
 * Uses O(N*M) algorithm instead of exponential recursive backtracking
 */
function findBestMatch(
  query: string,
  text: string,
  originalText: string,
): MatchResult | null {
  const n = query.length;
  const m = text.length;

  if (n > m) return null;

  // Quick check: all query chars must exist in text
  for (let i = 0; i < n; i++) {
    if (text.indexOf(query[i]) === -1) return null;
  }

  // DP table: dp[i][j] = best score matching query[0..i-1] ending at text[j-1]
  // prev[i][j] = previous text position for backtracking
  const dp: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(-Infinity));
  const prev: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(-1));

  dp[0].fill(0); // Empty query matches with score 0

  for (let i = 1; i <= n; i++) {
    for (let j = i; j <= m; j++) {
      if (text[j - 1] !== query[i - 1]) continue;

      let bestPrevScore = -Infinity;
      let bestPrevPos = -1;

      // Find best previous state
      for (let k = i - 1; k < j; k++) {
        if (dp[i - 1][k] === -Infinity) continue;

        let score = dp[i - 1][k] + 10; // Base score

        // Consecutive match bonus
        if (k === j - 1) score += 40;

        // Word boundary bonus
        if (j === 1 || /[\s\-_\/.]/.test(originalText[j - 2])) score += 30;

        // CamelCase bonus
        if (
          j > 1 &&
          /[a-z]/.test(originalText[j - 2]) &&
          /[A-Z]/.test(originalText[j - 1])
        )
          score += 25;

        // First char bonus
        if (j === 1) score += 20;

        // Gap penalty
        if (k > 0) score -= (j - k - 1) * 2;

        // Start position penalty (for first char only)
        if (i === 1) score -= (j - 1) * 0.5;

        if (score > bestPrevScore) {
          bestPrevScore = score;
          bestPrevPos = k;
        }
      }

      if (bestPrevScore > dp[i][j]) {
        dp[i][j] = bestPrevScore;
        prev[i][j] = bestPrevPos;
      }
    }
  }

  // Find best ending position
  let bestScore = -Infinity;
  let bestEnd = -1;
  for (let j = n; j <= m; j++) {
    if (dp[n][j] > bestScore) {
      bestScore = dp[n][j];
      bestEnd = j;
    }
  }

  if (bestEnd === -1) return null;

  // Backtrack to get path
  const path: number[] = [];
  let j = bestEnd;
  for (let i = n; i > 0; i--) {
    path.unshift(j - 1);
    j = prev[i][j];
  }

  // Convert path to match ranges (merge consecutive)
  const matches: Array<[number, number]> = [];
  let start = path[0];
  let end = path[0] + 1;

  for (let i = 1; i < path.length; i++) {
    if (path[i] === end) {
      end++;
    } else {
      matches.push([start, end]);
      start = path[i];
      end = path[i] + 1;
    }
  }
  matches.push([start, end]);

  // Apply length penalty
  bestScore -= (m - n) * 0.5;

  return { score: bestScore, matches };
}

/**
 * Parse FZF extended search syntax
 * Supports: space-separated AND terms, ^prefix, suffix$, 'exact, !negation
 */
function parseQuery(query: string): Array<{
  term: string;
  type: "fuzzy" | "exact" | "prefix" | "suffix";
  negate: boolean;
}> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return terms
    .map((term) => {
      let negate = false;
      let type: "fuzzy" | "exact" | "prefix" | "suffix" = "fuzzy";
      let cleanTerm = term;

      // Check for negation
      if (cleanTerm.startsWith("!")) {
        negate = true;
        cleanTerm = cleanTerm.slice(1);
      }

      // Check for exact match
      if (cleanTerm.startsWith("'")) {
        type = "exact";
        cleanTerm = cleanTerm.slice(1);
      }
      // Check for prefix match
      else if (cleanTerm.startsWith("^")) {
        type = "prefix";
        cleanTerm = cleanTerm.slice(1);
      }
      // Check for suffix match
      else if (cleanTerm.endsWith("$")) {
        type = "suffix";
        cleanTerm = cleanTerm.slice(0, -1);
      }

      return { term: cleanTerm, type, negate };
    })
    .filter((t) => t.term.length > 0);
}

/**
 * Match a single term against text
 */
function matchTerm(
  term: string,
  type: "fuzzy" | "exact" | "prefix" | "suffix",
  text: string,
): MatchResult | null {
  const caseSensitive = isCaseSensitive(term);
  const t = caseSensitive ? text : text.toLowerCase();
  const q = caseSensitive ? term : term.toLowerCase();

  switch (type) {
    case "exact": {
      const idx = t.indexOf(q);
      if (idx === -1) return null;
      return { score: 5000, matches: [[idx, idx + q.length]] };
    }
    case "prefix": {
      // Check if any word starts with the term
      const words = t.split(/[\s\-_\/.]+/);
      let pos = 0;
      for (const word of words) {
        if (word.startsWith(q)) {
          return { score: 6000, matches: [[pos, pos + q.length]] };
        }
        pos += word.length + 1;
      }
      // Also check if whole string starts with it
      if (t.startsWith(q)) {
        return { score: 6000, matches: [[0, q.length]] };
      }
      return null;
    }
    case "suffix": {
      if (t.endsWith(q)) {
        const start = t.length - q.length;
        return { score: 6000, matches: [[start, t.length]] };
      }
      return null;
    }
    case "fuzzy":
    default:
      return fzfMatch(term, text);
  }
}

/**
 * Calculate fuzzy match score between query and text
 * Returns score > 0 for match, -1 for no match
 */
export function fuzzyScore(query: string, text: string): number {
  const result = fzfMatch(query, text);
  return result ? result.score : -1;
}

/**
 * Fuzzy search through items with FZF-like behavior
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  getSearchableText: (item: T) => string[],
): FuzzyResult<T>[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return items.map((item) => ({ item, score: 0 }));
  }

  const parsedTerms = parseQuery(trimmedQuery);
  if (parsedTerms.length === 0) {
    return items.map((item) => ({ item, score: 0 }));
  }

  const results: FuzzyResult<T>[] = [];

  for (const item of items) {
    const texts = getSearchableText(item);
    let totalScore = 0;
    let allTermsMatch = true;
    const allMatches: Array<[number, number]> = [];

    // All terms must match (AND logic like fzf)
    for (const { term, type, negate } of parsedTerms) {
      let termMatched = false;
      let bestTermScore = -Infinity;

      for (const text of texts) {
        if (!text) continue;
        const result = matchTerm(term, type, text);

        if (negate) {
          // For negated terms, if it matches any text, exclude the item
          if (result) {
            termMatched = true;
            break;
          }
        } else {
          if (result && result.score > bestTermScore) {
            bestTermScore = result.score;
            termMatched = true;
            allMatches.push(...result.matches);
          }
        }
      }

      if (negate) {
        // Negated term: item should NOT match
        if (termMatched) {
          allTermsMatch = false;
          break;
        }
      } else {
        // Normal term: item MUST match
        if (!termMatched) {
          allTermsMatch = false;
          break;
        }
        totalScore += bestTermScore;
      }
    }

    if (allTermsMatch) {
      results.push({ item, score: totalScore, matches: allMatches });
    }
  }

  // Sort by score (highest first)
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Simple check if query fuzzy-matches text
 */
export function fuzzyMatch(query: string, text: string): boolean {
  return fuzzyScore(query, text) > 0;
}

/**
 * Highlight matched characters in text
 * Returns an array of { text, highlight } segments
 */
export function highlightMatches(
  text: string,
  matches: Array<[number, number]>,
): Array<{ text: string; highlight: boolean }> {
  if (!matches || matches.length === 0) {
    return [{ text, highlight: false }];
  }

  // Sort and merge overlapping matches
  const sorted = [...matches].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    if (merged.length === 0 || start > merged[merged.length - 1][1]) {
      merged.push([start, end]);
    } else {
      merged[merged.length - 1][1] = Math.max(
        merged[merged.length - 1][1],
        end,
      );
    }
  }

  const segments: Array<{ text: string; highlight: boolean }> = [];
  let pos = 0;

  for (const [start, end] of merged) {
    if (pos < start) {
      segments.push({ text: text.slice(pos, start), highlight: false });
    }
    segments.push({ text: text.slice(start, end), highlight: true });
    pos = end;
  }

  if (pos < text.length) {
    segments.push({ text: text.slice(pos), highlight: false });
  }

  return segments;
}
