/** The value if it is an array, else `[]`: an unexpected server-fn result must never crash a page. */
export function asList<T>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
