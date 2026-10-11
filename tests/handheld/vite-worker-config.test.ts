import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

describe('vite worker config', () => {
  it('builds workers as ES modules (sync-wasm spawns a module worker)', () => {
    expect(config.worker?.format).toBe('es');
  });
});
