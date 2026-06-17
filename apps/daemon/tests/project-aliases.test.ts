import type http from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// Regression coverage for the file-alias persistence bug: the generic file
// write endpoint sanitizes `.open-design` to `_open-design` (sanitizeName
// strips leading dots), so writing aliases through it landed at the wrong
// path while the read looked at `.open-design` — aliases vanished on reload.
// The dedicated /aliases routes use direct fs and must keep the leading dot.
describe('project aliases route', () => {
  let server: http.Server;
  let baseUrl: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function importFolder(folder: string) {
    const resp = await fetch(`${baseUrl}/api/import/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDir: folder }),
    });
    expect(resp.status).toBe(200);
    const { project } = (await resp.json()) as { project: { id: string } };
    return project.id;
  }

  it('round-trips aliases and persists under .open-design/ (leading dot preserved)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-aliases-'));
    tempDirs.push(dir);
    const projectId = await importFolder(dir);

    const put = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: { '页面/平台端/test.html': '我的页面' } }),
    });
    expect(put.status).toBe(200);

    // The regression guard: the file must land at the dotted metadata path,
    // not the sanitized `_open-design/` the generic endpoint would produce.
    const expected = path.join(dir, '.open-design', 'aliases.json');
    const sanitized = path.join(dir, '_open-design', 'aliases.json');
    expect(existsSync(expected)).toBe(true);
    expect(existsSync(sanitized)).toBe(false);
    expect(JSON.parse(await readFile(expected, 'utf8'))).toEqual({
      '页面/平台端/test.html': '我的页面',
    });

    const get = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`);
    expect(get.status).toBe(200);
    const body = (await get.json()) as { aliases: Record<string, string> };
    expect(body.aliases).toEqual({ '页面/平台端/test.html': '我的页面' });
  });

  it('returns an empty map before any aliases are written', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-aliases-empty-'));
    tempDirs.push(dir);
    const projectId = await importFolder(dir);

    const get = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`);
    expect(get.status).toBe(200);
    const body = (await get.json()) as { aliases: Record<string, string> };
    expect(body.aliases).toEqual({});
  });

  // The alias value format was upgraded from a bare string (display name) to
  // an object { name?, viewport? }. Old string values must keep working
  // (backward compatibility — no migration step), and the new object shape
  // must round-trip with only known fields retained (malformed payloads are
  // stripped so they can't bloat or corrupt the shared aliases.json).
  it('round-trips the new object value shape {name, viewport}', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-aliases-obj-'));
    tempDirs.push(dir);
    const projectId = await importFolder(dir);

    const put = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aliases: {
          'page.html': { name: '我的页面', viewport: 'mobile' },
          'only-vp.html': { viewport: 'tablet' },
          'only-name.html': { name: '仅名称' },
        },
      }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`);
    const body = (await get.json()) as { aliases: Record<string, unknown> };
    expect(body.aliases['page.html']).toEqual({ name: '我的页面', viewport: 'mobile' });
    expect(body.aliases['only-vp.html']).toEqual({ viewport: 'tablet' });
    expect(body.aliases['only-name.html']).toEqual({ name: '仅名称' });
  });

  it('mixes legacy string values and new object values in one map', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-aliases-mix-'));
    tempDirs.push(dir);
    const projectId = await importFolder(dir);

    await fetch(`${baseUrl}/api/projects/${projectId}/aliases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aliases: {
          'legacy.html': '旧名称',
          'new.html': { name: '新名称', viewport: 'desktop' },
        },
      }),
    });

    const get = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`);
    const body = (await get.json()) as { aliases: Record<string, unknown> };
    // Legacy string is preserved verbatim.
    expect(body.aliases['legacy.html']).toBe('旧名称');
    // New object is preserved verbatim.
    expect(body.aliases['new.html']).toEqual({ name: '新名称', viewport: 'desktop' });
  });

  it('drops malformed object values (unknown fields, bad viewport, empty object)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-aliases-bad-'));
    tempDirs.push(dir);
    const projectId = await importFolder(dir);

    const put = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aliases: {
          // Unknown field only — should be dropped entirely (empty result).
          'unknown-only.html': { bogus: 'x' },
          // Invalid viewport enum — viewport dropped, name kept.
          'bad-vp.html': { name: '保留', viewport: 'watch' },
          // Empty object — dropped.
          'empty.html': {},
          // Number/array values — dropped.
          'num.html': 42,
          'arr.html': ['x'],
        },
      }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/projects/${projectId}/aliases`);
    const body = (await get.json()) as { aliases: Record<string, unknown> };
    expect(body.aliases['unknown-only.html']).toBeUndefined();
    expect(body.aliases['bad-vp.html']).toEqual({ name: '保留' });
    expect(body.aliases['empty.html']).toBeUndefined();
    expect(body.aliases['num.html']).toBeUndefined();
    expect(body.aliases['arr.html']).toBeUndefined();
  });
});
