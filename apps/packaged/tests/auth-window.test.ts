/**
 * Unit coverage for the pure helpers in apps/packaged/src/auth-window.ts.
 *
 * The auth gate's Electron shell (BrowserWindow construction, ipcMain, etc.)
 * lives in auth-runtime.ts and is not exercised here — this file pins the
 * testable core: URL resolution, login-success detection, token unwrap,
 * persistence round-trip, and the inline HTML/data-URL builders.
 *
 * Mirrors the split used by protocol.test.ts (pure core) vs. the packaged
 * entry (Electron shell).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import {
  AUTH_OPEN_LOGIN_MARKER,
  CLOUD_SCHEDULE_CALLBACK_QUERY_PARAM,
  CLOUD_SCHEDULE_STATE_QUERY_PARAM,
  CLOUD_SCHEDULE_TOKEN_KEY,
  CLOUD_SCHEDULE_URL_ENV,
  DEFAULT_CLOUD_SCHEDULE_URL,
  OPEN_DESIGN_AUTH_CALLBACK_URL,
  buildAuthPageDataUrl,
  buildAuthPageHtml,
  buildCloudScheduleLoginUrl,
  cloudAuthFilePath,
  clearCloudAuthToken,
  isCloudScheduleLoginSuccess,
  loadCloudAuthToken,
  parseCloudScheduleAuthCallback,
  resolveCloudScheduleUrl,
  runAuthGateStateMachine,
  saveCloudAuthToken,
  unwrapQuotedToken,
} from '../src/auth-window.js';

class FakeAuthWindow extends EventEmitter {
  private destroyed = false;

  close(): void {
    this.destroyed = true;
    this.emit('closed');
  }

  focus(): void {
    // no-op test double
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

describe('resolveCloudScheduleUrl', () => {
  const originalEnv = process.env[CLOUD_SCHEDULE_URL_ENV];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[CLOUD_SCHEDULE_URL_ENV];
    } else {
      process.env[CLOUD_SCHEDULE_URL_ENV] = originalEnv;
    }
  });

  it('returns the option override when provided', () => {
    expect(resolveCloudScheduleUrl('https://staging.example.com/')).toBe(
      'https://staging.example.com',
    );
  });

  it('reads the env override when no option is given', () => {
    process.env[CLOUD_SCHEDULE_URL_ENV] = 'http://10.0.0.1:9000/';
    expect(resolveCloudScheduleUrl()).toBe('http://10.0.0.1:9000');
  });

  it('falls back to the default when neither option nor env is set', () => {
    delete process.env[CLOUD_SCHEDULE_URL_ENV];
    expect(resolveCloudScheduleUrl()).toBe(DEFAULT_CLOUD_SCHEDULE_URL);
  });

  it('trims trailing slashes regardless of source', () => {
    expect(resolveCloudScheduleUrl('http://x////')).toBe('http://x');
  });
});

describe('isCloudScheduleLoginSuccess', () => {
  const base = 'http://210.16.189.238:8083';

  it('treats root navigation as a successful login', () => {
    expect(isCloudScheduleLoginSuccess(base, `${base}/`)).toBe(true);
  });

  it('treats any non-/login same-origin path as success', () => {
    expect(isCloudScheduleLoginSuccess(base, `${base}/home`)).toBe(true);
    expect(isCloudScheduleLoginSuccess(base, `${base}/dashboard/overview`)).toBe(true);
  });

  it('rejects the login page itself', () => {
    expect(isCloudScheduleLoginSuccess(base, `${base}/login`)).toBe(false);
    expect(isCloudScheduleLoginSuccess(base, `${base}/login/`)).toBe(false);
    expect(isCloudScheduleLoginSuccess(base, `${base}/login/pwd-login`)).toBe(false);
  });

  it('rejects a different origin', () => {
    expect(isCloudScheduleLoginSuccess(base, 'http://evil.example.com/')).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(isCloudScheduleLoginSuccess(base, 'not-a-url')).toBe(false);
  });
});

describe('unwrapQuotedToken', () => {
  it('returns null for null/undefined/empty', () => {
    expect(unwrapQuotedToken(null)).toBeNull();
    expect(unwrapQuotedToken(undefined)).toBeNull();
    expect(unwrapQuotedToken('')).toBeNull();
    expect(unwrapQuotedToken('   ')).toBeNull();
  });

  it('strips JSON double-quoting from the cloud-schedule storage layer', () => {
    const token = 'abc123';
    const quoted = JSON.stringify(token); // '"abc123"'
    expect(unwrapQuotedToken(quoted)).toBe(token);
  });

  it('passes through an unquoted raw token', () => {
    expect(unwrapQuotedToken('raw-token-value')).toBe('raw-token-value');
  });

  it('returns null when the JSON unwrap yields an empty string', () => {
    expect(unwrapQuotedToken(JSON.stringify(''))).toBeNull();
  });

  it('returns the trimmed input when JSON.parse fails on a quoted-looking value', () => {
    // Starts and ends with a quote but is not valid JSON — fall through.
    expect(unwrapQuotedToken('"unterminated')).toBe('"unterminated');
  });
});

describe('buildCloudScheduleLoginUrl', () => {
  it('appends /login to the base', () => {
    expect(buildCloudScheduleLoginUrl('http://h:80')).toBe('http://h:80/login');
  });

  it('adds the Open Design callback URL and state when building a desktop auth login', () => {
    const url = new URL(
      buildCloudScheduleLoginUrl('http://h:80', {
        callbackUrl: OPEN_DESIGN_AUTH_CALLBACK_URL,
        state: 'state-123',
      }),
    );

    expect(buildCloudScheduleLoginUrl('http://h:80', {
      callbackUrl: OPEN_DESIGN_AUTH_CALLBACK_URL,
      state: 'state-123',
    })).toBe(
      'http://h:80/login?open_design_callback=od%3A%2F%2Fcloud-schedule-auth&open_design_state=state-123',
    );
    expect(url.searchParams.get(CLOUD_SCHEDULE_CALLBACK_QUERY_PARAM)).toBe(OPEN_DESIGN_AUTH_CALLBACK_URL);
    expect(url.searchParams.get(CLOUD_SCHEDULE_STATE_QUERY_PARAM)).toBe('state-123');
  });
});

describe('parseCloudScheduleAuthCallback', () => {
  it('extracts a token from a matching od callback URL with the expected state', () => {
    expect(
      parseCloudScheduleAuthCallback(
        'od://cloud-schedule-auth?token=token-xyz&state=state-123',
        'state-123',
      ),
    ).toBe('token-xyz');
  });

  it('unwraps JSON-quoted token values from callback URLs', () => {
    const quoted = encodeURIComponent(JSON.stringify('token-quoted'));

    expect(
      parseCloudScheduleAuthCallback(
        `od://cloud-schedule-auth?token=${quoted}&state=state-123`,
        'state-123',
      ),
    ).toBe('token-quoted');
  });

  it('rejects callbacks with a wrong state, wrong host, or missing token', () => {
    expect(
      parseCloudScheduleAuthCallback(
        'od://cloud-schedule-auth?token=token-xyz&state=wrong',
        'state-123',
      ),
    ).toBeNull();
    expect(
      parseCloudScheduleAuthCallback(
        'od://app?token=token-xyz&state=state-123',
        'state-123',
      ),
    ).toBeNull();
    expect(
      parseCloudScheduleAuthCallback(
        'od://cloud-schedule-auth?state=state-123',
        'state-123',
      ),
    ).toBeNull();
  });
});

describe('cloudAuthFilePath', () => {
  it('places the file under the data root', () => {
    expect(cloudAuthFilePath('/data/root')).toBe(
      join('/data', 'root', 'cloud-auth.json'),
    );
  });
});

describe('token persistence round-trip', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'od-auth-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('saves and loads a token through the plaintext default codec', async () => {
    await saveCloudAuthToken({ dataRoot }, 'token-xyz');
    const loaded = await loadCloudAuthToken({ dataRoot });
    expect(loaded).toBe('token-xyz');
  });

  it('round-trips through a custom encrypt/decrypt codec', async () => {
    // Simple reverse cipher as a stand-in for safeStorage.
    const encrypt = (plaintext: string): Buffer =>
      Buffer.from(Buffer.from(plaintext, 'utf8').reverse());
    const decrypt = (encoded: Buffer): string =>
      Buffer.from(Buffer.from(encoded).reverse()).toString('utf8');

    await saveCloudAuthToken({ dataRoot, encrypt }, 'secret-token');
    const loaded = await loadCloudAuthToken({ dataRoot, decrypt });
    expect(loaded).toBe('secret-token');
  });

  it('writes the file even when the data root does not yet exist', async () => {
    const nested = join(dataRoot, 'nested', 'dir');
    await saveCloudAuthToken({ dataRoot: nested }, 't');
    expect(await loadCloudAuthToken({ dataRoot: nested })).toBe('t');
  });

  it('returns null when no token file exists', async () => {
    expect(await loadCloudAuthToken({ dataRoot })).toBeNull();
  });

  it('returns null when the file fails to decrypt', async () => {
    await writeFile(cloudAuthFilePath(dataRoot), 'not-json-or-encrypted');
    expect(await loadCloudAuthToken({ dataRoot })).toBeNull();
  });

  it('clearCloudAuthToken removes the file (best-effort)', async () => {
    await saveCloudAuthToken({ dataRoot }, 't');
    await clearCloudAuthToken({ dataRoot });
    expect(await loadCloudAuthToken({ dataRoot })).toBeNull();
  });

  it('clearCloudAuthToken is a no-op when the file is absent', async () => {
    await expect(clearCloudAuthToken({ dataRoot })).resolves.toBeUndefined();
  });

  it('stores token + savedAt metadata as JSON', async () => {
    await saveCloudAuthToken({ dataRoot }, 'meta-token');
    const raw = await readFile(cloudAuthFilePath(dataRoot), 'utf8');
    const parsed = JSON.parse(raw) as { token: string; savedAt: string };
    expect(parsed.token).toBe('meta-token');
    expect(typeof parsed.savedAt).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.savedAt))).toBe(false);
  });
});

describe('buildAuthPageHtml', () => {
  it('embeds a raster logo <img> when a data URL is provided', () => {
    const html = buildAuthPageHtml({ logoDataUrl: 'data:image/png;base64,AAAA' });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('<img class="auth-logo auth-logo--img"');
    expect(html).not.toContain('<span class="auth-logo auth-logo--svg"');
  });

  it('uses the bundled 拓者 wordmark SVG when no logo is provided', () => {
    const html = buildAuthPageHtml({});
    expect(html).toContain('auth-logo--svg');
    expect(html).toContain('aria-label="Open Design"');
    expect(html).toContain('viewBox="0 0 169.3 83.14"');
  });

  it('renders a custom inline SVG when logoSvg is provided', () => {
    const custom = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>';
    const html = buildAuthPageHtml({ logoSvg: custom });
    expect(html).toContain('auth-logo--svg');
    expect(html).toContain('<circle cx="5" cy="5" r="4"');
  });

  it('uses the dark background and authorization copy', () => {
    const html = buildAuthPageHtml({});
    expect(html).toContain('--bg: #0d0d0d');
    expect(html).toContain('欢迎使用 Open Design');
    expect(html).toContain('使用云档期授权登录');
  });

  it('omits any register button (single CTA only)', () => {
    const html = buildAuthPageHtml({});
    const buttonMatches = html.match(/<button/g) ?? [];
    expect(buttonMatches).toHaveLength(1);
    expect(html.toLowerCase()).not.toContain('注册');
    expect(html.toLowerCase()).not.toContain('register');
  });

  it('emits the open-login console marker on CTA click', () => {
    const html = buildAuthPageHtml({});
    expect(html).toContain(AUTH_OPEN_LOGIN_MARKER);
  });

  it('uses the repository ease-out curve for entry animation', () => {
    const html = buildAuthPageHtml({});
    expect(html).toContain('cubic-bezier(0.23, 1, 0.32, 1)');
  });
});

describe('runAuthGateStateMachine', () => {
  it('opens cloud-schedule login in the external browser and resolves from an od callback', async () => {
    const authWindow = new FakeAuthWindow();
    let openLoginRequest: (() => void) | null = null;
    let authCallback: ((url: string) => void) | null = null;
    const openExternalLogin = vi.fn();
    const save = vi.fn(async () => undefined);

    const result = runAuthGateStateMachine(
      {
        authState: 'state-123',
        cloudScheduleUrl: 'http://210.16.189.238:8083',
        createAuthWindow: () => authWindow as unknown as BrowserWindow,
        onAuthCallback(callback) {
          authCallback = callback;
          return () => {
            authCallback = null;
          };
        },
        onOpenLoginRequest(_window, callback) {
          openLoginRequest = callback;
          return () => {
            openLoginRequest = null;
          };
        },
        openExternalLogin,
        parseAuthCallback: parseCloudScheduleAuthCallback,
      },
      { save },
    );

    const requestLogin = openLoginRequest as unknown as () => void;
    requestLogin();

    expect(openExternalLogin).toHaveBeenCalledWith({
      loginUrl: 'http://210.16.189.238:8083/login?open_design_callback=od%3A%2F%2Fcloud-schedule-auth&open_design_state=state-123',
    });

    const completeAuth = authCallback as unknown as (url: string) => void;
    completeAuth('od://cloud-schedule-auth?token=token-xyz&state=state-123');

    await expect(result).resolves.toEqual({ authorized: true, token: 'token-xyz' });
    expect(save).toHaveBeenCalledWith('token-xyz');
    expect(authWindow.isDestroyed()).toBe(true);
  });

  it('ignores od callbacks that do not match the current auth state', async () => {
    const authWindow = new FakeAuthWindow();
    let authCallback: ((url: string) => void) | null = null;

    const result = runAuthGateStateMachine({
      authState: 'state-123',
      cloudScheduleUrl: 'http://210.16.189.238:8083',
      createAuthWindow: () => authWindow as unknown as BrowserWindow,
      onAuthCallback(callback) {
        authCallback = callback;
        return () => undefined;
      },
      onOpenLoginRequest() {
        return () => undefined;
      },
      openExternalLogin: vi.fn(),
      parseAuthCallback: parseCloudScheduleAuthCallback,
    });

    const completeAuth = authCallback as unknown as (url: string) => void;
    completeAuth('od://cloud-schedule-auth?token=wrong&state=wrong');
    authWindow.close();

    await expect(result).resolves.toEqual({ authorized: false, token: null });
  });
});

describe('buildAuthPageDataUrl', () => {
  it('produces a data:text/html URL containing the HTML', () => {
    const url = buildAuthPageDataUrl({ logoDataUrl: 'data:image/png;base64,BB' });
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    const decoded = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    expect(decoded).toContain('使用云档期授权登录');
  });
});

describe('constants', () => {
  it('uses the cloud-schedule sessionStorage token key', () => {
    expect(CLOUD_SCHEDULE_TOKEN_KEY).toBe('TB_token');
  });
});
