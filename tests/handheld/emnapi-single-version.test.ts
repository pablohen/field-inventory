import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Packages followed while walking the dependency graph of the Turso engine.
const WALKED = [/^@tursodatabase\//, /^@napi-rs\/wasm-runtime$/, /^@emnapi\//];
const WATCHED = ['@emnapi/core', '@emnapi/wasi-threads'];

type Manifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

function readManifest(dir: string): Manifest {
  return JSON.parse(
    readFileSync(join(dir, 'package.json'), 'utf8'),
  ) as Manifest;
}

// Resolve `name` as Node would from the dependent package's directory (pnpm
// symlinks siblings into the dependent's own node_modules), returning the real
// package directory.
function resolveDir(fromDir: string, name: string): string | null {
  const req = createRequire(join(fromDir, 'package.json'));
  for (const base of req.resolve.paths(name) ?? []) {
    const candidate = join(base, name);
    if (existsSync(join(candidate, 'package.json')))
      return realpathSync(candidate);
  }
  return null;
}

function collectVersions(rootName: string): Map<string, Set<string>> {
  const rootDir = resolveDir(process.cwd(), rootName);
  if (!rootDir) throw new Error(`cannot resolve ${rootName}`);
  const versions = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const visit = (dir: string) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const manifest = readManifest(dir);
    if (WATCHED.includes(manifest.name)) {
      const set = versions.get(manifest.name) ?? new Set<string>();
      set.add(manifest.version);
      versions.set(manifest.name, set);
    }
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (!WALKED.some((re) => re.test(dep))) continue;
      const depDir = resolveDir(dir, dep);
      if (depDir) visit(depDir);
    }
  };
  visit(rootDir);
  return versions;
}

describe('emnapi runtime under @tursodatabase/sync-wasm', () => {
  const versions = collectVersions('@tursodatabase/sync-wasm');

  it.each(WATCHED)('resolves exactly one version of %s', (name) => {
    const found = [...(versions.get(name) ?? [])].sort();
    expect(
      found.length,
      `${name} versions: ${found.join(', ') || 'none'}`,
    ).toBe(1);
  });
});
