/**
 * Escapes a string for safe use inside a MongoDB $regex filter.
 *
 * Every search endpoint in this app builds a case-insensitive $regex from
 * raw user input (e.g. ?q=...). Without escaping, a search term containing
 * regex metacharacters — deliberately or not — is interpreted as a pattern:
 * something like `q=(a+)+$` against a large collection is a classic ReDoS
 * vector, and even accidental characters like `.` or `*` silently change
 * what "search" means. This turns the input into a literal string match.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
