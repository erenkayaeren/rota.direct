/**
 * Keeps the module boundaries the case study asks to be "clearly visible in code" honest:
 *   - domain code is pure (no framework, no database driver, no outer layers);
 *   - application code depends on ports, never on adapters or the HTTP framework;
 *   - the inventory module may use tenancy's domain types and nothing else of tenancy;
 *   - tenancy never depends on inventory or reservation;
 *   - inventory never depends on reservation;
 *   - reservation uses inventory's domain/application/infra and tenancy's domain, never their HTTP layers.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? listTypeScriptFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

interface ImportEdge {
  /** Path of the importing file relative to src, with forward slashes. */
  from: string;
  /** Relative-to-src path for local imports, or the bare package name. */
  to: string;
  local: boolean;
}

function importsOf(file: string): ImportEdge[] {
  const source = readFileSync(file, 'utf8');
  const from = path.relative(SRC, file).split(path.sep).join('/');
  const edges: ImportEdge[] = [];
  for (const match of source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1] as string;
    if (specifier.startsWith('.')) {
      const resolved = path.relative(SRC, path.resolve(path.dirname(file), specifier)).split(path.sep).join('/');
      edges.push({ from, to: resolved, local: true });
    } else {
      edges.push({ from, to: specifier, local: false });
    }
  }
  return edges;
}

const edges = listTypeScriptFiles(SRC).flatMap(importsOf);
const FRAMEWORK_PACKAGES = ['fastify', 'pg', 'zod'];

function offenders(predicate: (edge: ImportEdge) => boolean): string[] {
  return edges.filter(predicate).map((edge) => `${edge.from} -> ${edge.to}`);
}

describe('architecture boundaries', () => {
  it('found source files to check', () => {
    expect(edges.length).toBeGreaterThan(20);
  });

  it('domain code and shared code import no framework, driver or outer layer', () => {
    const bad = offenders(
      (edge) =>
        (edge.from.includes('/domain/') || edge.from.startsWith('shared/')) &&
        (FRAMEWORK_PACKAGES.includes(edge.to) ||
          (edge.local && /(^|\/)(application|infra|http|platform)(\/|$)/.test(edge.to))),
    );
    expect(bad).toEqual([]);
  });

  it('application code does not import adapters, the HTTP layer, the database layer or frameworks', () => {
    const bad = offenders(
      (edge) =>
        edge.from.includes('/application/') &&
        (FRAMEWORK_PACKAGES.includes(edge.to) ||
          (edge.local && /(^|\/)(infra|http|platform)(\/|$)/.test(edge.to))),
    );
    expect(bad).toEqual([]);
  });

  it('inventory reaches into tenancy only through its domain types', () => {
    const bad = offenders(
      (edge) =>
        edge.from.startsWith('modules/inventory/') &&
        edge.local &&
        edge.to.startsWith('modules/tenancy/') &&
        !edge.to.startsWith('modules/tenancy/domain/'),
    );
    expect(bad).toEqual([]);
  });

  it('tenancy does not depend on inventory', () => {
    const bad = offenders(
      (edge) => edge.from.startsWith('modules/tenancy/') && edge.local && edge.to.startsWith('modules/inventory/'),
    );
    expect(bad).toEqual([]);
  });

  it('tenancy does not depend on reservation', () => {
    const bad = offenders(
      (edge) => edge.from.startsWith('modules/tenancy/') && edge.local && edge.to.startsWith('modules/reservation/'),
    );
    expect(bad).toEqual([]);
  });

  it('inventory does not depend on reservation', () => {
    const bad = offenders(
      (edge) => edge.from.startsWith('modules/inventory/') && edge.local && edge.to.startsWith('modules/reservation/'),
    );
    expect(bad).toEqual([]);
  });

  it("reservation reaches into other modules only through tenancy's domain and inventory's domain, ports and adapters", () => {
    const bad = offenders(
      (edge) =>
        edge.from.startsWith('modules/reservation/') &&
        edge.local &&
        ((edge.to.startsWith('modules/tenancy/') && !edge.to.startsWith('modules/tenancy/domain/')) ||
          edge.to.startsWith('modules/inventory/http/')),
    );
    expect(bad).toEqual([]);
  });
});
