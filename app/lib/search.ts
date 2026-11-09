/** Longest search text kept from `?q=`; anything longer is cut. */
export const MAX_SEARCH_LENGTH = 100;

/** Reads `?q=`, trimmed, with runs of whitespace collapsed. Empty means no search. */
export function parseSearch(searchParams: URLSearchParams): string {
  return (searchParams.get("q") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
}

/** Splits search text into lowercase words, keeping only letters and digits. */
function searchWords(search: string): string[] {
  return search
    .toLowerCase()
    .split(" ")
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
}

/**
 * Builds a Shopify product search query that matches titles containing words
 * that start with each word typed, e.g. "blue sh" → `title:blue* AND title:sh*`.
 * Punctuation is dropped so merchant input can't change the query's meaning.
 * Returns null when nothing searchable is left.
 */
export function titleSearchQuery(search: string): string | null {
  const words = searchWords(search);
  if (words.length === 0) return null;
  return words.map((word) => `title:${word}*`).join(" AND ");
}

/**
 * The same match done in memory, for lists that don't come from Shopify search:
 * every typed word must start some word in the title.
 */
export function titleMatches(title: string, search: string): boolean {
  const words = searchWords(search);
  if (words.length === 0) return true;
  const titleWords = searchWords(title.replace(/[^\p{L}\p{N}]+/gu, " "));
  return words.every((word) => titleWords.some((t) => t.startsWith(word)));
}
