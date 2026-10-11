import { describe, expect, it } from 'vitest';
import { resetDevice } from '#/handheld/reset';

function fakeEnv(names: string[], failing: string[] = []) {
  const log: string[] = [];
  const root = {
    async *keys() {
      for (const n of names) yield n;
    },
    async removeEntry(name: string) {
      if (failing.includes(name)) throw new Error(`locked ${name}`);
      log.push(`rm:${name}`);
    },
  };
  return {
    log,
    deps: {
      storage: { getDirectory: async () => root as never },
      localStorage: { clear: () => log.push('ls:clear') },
    },
  };
}

describe('resetDevice', () => {
  it('closes DBs first, removes every entry, clears localStorage', async () => {
    const { log, deps } = fakeEnv(['a.db', 'b.db']);
    await resetDevice(async () => void log.push('close'), deps);
    expect(log).toEqual(['close', 'rm:a.db', 'rm:b.db', 'ls:clear']);
  });

  it('keeps going when one removal fails, still clears, throws aggregate', async () => {
    const { log, deps } = fakeEnv(['a.db', 'b.db', 'c.db'], ['b.db']);
    const err = await resetDevice(async () => {}, deps).catch((e) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect(err.message).toBe('RESET_INCOMPLETE');
    expect(err.errors).toHaveLength(1);
    expect(log).toEqual(['rm:a.db', 'rm:c.db', 'ls:clear']);
  });
});
