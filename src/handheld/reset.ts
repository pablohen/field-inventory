export interface ResetDeps {
  storage: { getDirectory(): Promise<FileSystemDirectoryHandle> };
  localStorage: { clear(): void };
}

/**
 * Wipes all local state: every OPFS entry (DB files) and all of localStorage
 * (the sync engine keeps its metadata there, so both must go together).
 *
 * MUST run on the leader tab: only the leader holds the OPFS handles, and
 * followers' removals would hit locked files. Task 9 exposes this as a
 * LeaderApi method so followers route it to the leader. `closeOpen` closes the
 * DBs the leader holds and runs before any removal.
 *
 * Every entry is attempted; localStorage is always cleared. If any removal
 * failed, throws `AggregateError(failures, 'RESET_INCOMPLETE')`.
 */
export async function resetDevice(
  closeOpen: () => Promise<void>,
  deps: ResetDeps = { storage: navigator.storage, localStorage },
): Promise<void> {
  await closeOpen();
  const failures: unknown[] = [];
  try {
    const root = await deps.storage.getDirectory();
    const names: string[] = [];
    for await (const name of root.keys()) names.push(name);
    for (const name of names) {
      try {
        await root.removeEntry(name, { recursive: true });
      } catch (err) {
        failures.push(err);
      }
    }
  } catch (err) {
    failures.push(err);
  } finally {
    deps.localStorage.clear();
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'RESET_INCOMPLETE');
}
