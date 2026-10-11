/**
 * Wipes all local state: every OPFS entry (DB files) and all of localStorage
 * (the sync engine keeps its metadata there, so both must go together).
 * `closeOpen` closes the DBs this tab holds (only the leader has any) before
 * their files are removed.
 */
export async function resetDevice(
  closeOpen?: () => Promise<void>,
): Promise<void> {
  await closeOpen?.();
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  for (const name of names) await root.removeEntry(name, { recursive: true });
  localStorage.clear();
}
