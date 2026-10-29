/**
 * Product de-duplication helpers, used by the products CSV import so
 * it agrees with itself on what "same product" means. Mirrors the
 * pattern in lib/contacts/dedupe.ts, but keyed on normalized title
 * instead of phone.
 */

/** Canonical de-dup key for a product title (trimmed, lowercased, collapsed spaces). */
export function normalizeKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when a racing or format-equal insert slips
 * past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/**
 * De-duplicate parsed CSV rows by normalized title, keeping the first
 * occurrence of each. Rows with an empty normalized title are dropped
 * (they can't be a valid product — parseProductCsv already filters
 * these, but this stays defensive). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByTitle<T extends { title: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.title);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}