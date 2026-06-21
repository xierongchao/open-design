/**
 * Cloud-schedule (云档期) authorization gate for the packaged Open Design
 * desktop runtime.
 *
 * The packaged entry (`apps/packaged/src/index.ts`) calls `runAuthGate` AFTER
 * the splash window is on screen and the daemon/web sidecars are up, but
 * BEFORE `runDesktopMain` creates the hidden main window. The gate shows a
 * codex-style authorization page; clicking the single CTA opens the real
 * cloud-schedule login page in the user's external browser. Once the browser
 * login succeeds, the cloud-schedule app redirects to
 * `od://cloud-schedule-auth?...`; the packaged entry receives that protocol
 * callback, validates the one-shot state, persists the token, and resolves so
 * the desktop runtime can proceed.
 *
 * The HTML for the authorization page is inlined (data URL), mirroring the
 * splash window strategy in `apps/desktop/src/main/runtime.ts` — it must render
 * before/independent of the web sidecar so cold boot never shows an empty
 * frame. The cloud-schedule login URL is a remote page and is opened outside
 * Electron so the user sees the OS "open this app?" confirmation.
 *
 * IPC-free signaling: the inline auth page has no preload (keeping the bundle
 * surface minimal). The CTA click is signaled to the main process via a
 * `console.log` with a well-known marker, observed through
 * `webContents.on('console-message')`. This avoids a second preload file while
 * remaining sandbox-safe.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { BrowserWindow } from "electron";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Base URL of the deployed cloud-schedule (云档期) web app. The login page is
 * served at `${CLOUD_SCHEDULE_BASE_URL}/login` and a successful login
 * redirects to `${CLOUD_SCHEDULE_BASE_URL}/` (root).
 *
 * Overridable via `OD_CLOUD_SCHEDULE_URL` so tests and staging environments
 * can repoint the gate without a rebuild.
 */
export const CLOUD_SCHEDULE_URL_ENV = "OD_CLOUD_SCHEDULE_URL";
export const DEFAULT_CLOUD_SCHEDULE_URL = "http://210.16.189.238:8083";

export const OPEN_DESIGN_PROTOCOL_SCHEME = "od";
export const OPEN_DESIGN_AUTH_CALLBACK_HOST = "cloud-schedule-auth";
export const OPEN_DESIGN_AUTH_CALLBACK_URL =
  `${OPEN_DESIGN_PROTOCOL_SCHEME}://${OPEN_DESIGN_AUTH_CALLBACK_HOST}`;
export const CLOUD_SCHEDULE_CALLBACK_QUERY_PARAM = "open_design_callback";
export const CLOUD_SCHEDULE_STATE_QUERY_PARAM = "open_design_state";
export const CLOUD_SCHEDULE_TOKEN_QUERY_PARAM = "token";
export const CLOUD_SCHEDULE_AUTH_STATE_QUERY_PARAM = "state";

/** Legacy sessionStorage key the cloud-schedule app stores its auth token under. */
export const CLOUD_SCHEDULE_TOKEN_KEY = "TB_token";

/**
 * Marker the inline auth page writes to the console when the CTA is clicked.
 * Observed by the main process via `webContents.on('console-message')`. Kept
 * as an exported constant so tests can pin the contract.
 */
export const AUTH_OPEN_LOGIN_MARKER = "__od_auth_open_login__";

export type AuthGateResult = {
  /** Whether the user completed authorization. `false` = cancelled/closed. */
  authorized: boolean;
  /** Harvested token when `authorized` is true; otherwise null. */
  token: string | null;
};

export type AuthGateOptions = {
  /**
   * Absolute path under which the encrypted token is persisted
   * (`<dataRoot>/cloud-auth.json`). Callers must derive this from the
   * namespace-scoped data root — never a cwd-relative fallback — per the
   * Daemon data directory contract in the root AGENTS.md.
   */
  dataRoot: string;
  /** Preloaded logo PNG buffer to inline as the page logo (base64). */
  logoBuffer?: Buffer | null;
  /** Override the cloud-schedule base URL (tests / staging). */
  cloudScheduleUrl?: string;
  /** One-shot state used to validate the browser protocol callback. */
  authState?: string;
  /**
   * Subscribe to `od://cloud-schedule-auth` URLs received by the packaged
   * entry. The packaged entry owns the OS protocol listeners and queues URLs
   * that arrive before the auth gate has mounted.
   */
  onAuthCallback?: (callback: (url: string) => void) => () => void;
  /**
   * The pre-created brand splash window. The gate hides it while the auth
   * page is on screen (the small centered auth window would otherwise render
   * under the 1280x900 frameless splash). The caller restores the splash
   * after the gate resolves.
   */
  splashWindow?: BrowserWindow | null;
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — no Electron dependency)
// ---------------------------------------------------------------------------

/** Resolve the cloud-schedule base URL from option or env, with trailing trim. */
export function resolveCloudScheduleUrl(optionOverride?: string): string {
  const raw =
    optionOverride?.trim() ||
    process.env[CLOUD_SCHEDULE_URL_ENV]?.trim() ||
    DEFAULT_CLOUD_SCHEDULE_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * Decide whether a navigation URL indicates a successful cloud-schedule
 * login. The cloud-schedule app redirects from `/login` to `/` on success,
 * so the gate treats any same-origin navigation that is NOT under `/login`
 * as the authenticated state. Hash-mode router paths are also accepted.
 *
 * Kept pure so the packaged workspace can pin the policy in vitest without
 * a real Electron runtime.
 */
export function isCloudScheduleLoginSuccess(baseUrl: string, navigatedUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(navigatedUrl);
  } catch {
    return false;
  }
  const baseHost = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return null;
    }
  })();
  if (baseHost == null || parsed.host !== baseHost) return false;
  // The login page lives under `/login` (and `/login/<module>`). Anything
  // else on the same origin means the user has been routed past it.
  const path = parsed.pathname.replace(/\/+$/, "");
  return path !== "/login" && !path.startsWith("/login/");
}

/**
 * Strip the JSON double-quoting the cloud-schedule storage layer wraps around
 * token values (its `createStorage` JSON.stringify's every value). Mirrors the
 * `unwrapQuotedValue` the cloud-schedule sub-app uses for the same reason.
 */
export function unwrapQuotedToken(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const unwrapped = JSON.parse(trimmed);
      if (typeof unwrapped === "string") {
        return unwrapped.length > 0 ? unwrapped : null;
      }
    } catch {
      // fall through to return trimmed below
    }
  }
  return trimmed.length > 0 ? trimmed : null;
}

/** Path of the encrypted token file under the namespace data root. */
export function cloudAuthFilePath(dataRoot: string): string {
  return join(dataRoot, "cloud-auth.json");
}

/** Build the cloud-schedule login URL from a base URL. */
export function buildCloudScheduleLoginUrl(
  baseUrl: string,
  options: { callbackUrl?: string | null; state?: string | null } = {},
): string {
  const loginUrl = `${baseUrl.replace(/\/+$/, "")}/login`;
  if (!options.callbackUrl || !options.state) return loginUrl;
  const params = new URLSearchParams({
    [CLOUD_SCHEDULE_CALLBACK_QUERY_PARAM]: options.callbackUrl,
    [CLOUD_SCHEDULE_STATE_QUERY_PARAM]: options.state,
  });
  return `${loginUrl}?${params.toString()}`;
}

export function isCloudScheduleAuthCallbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === `${OPEN_DESIGN_PROTOCOL_SCHEME}:` &&
    parsed.hostname === OPEN_DESIGN_AUTH_CALLBACK_HOST
  );
}

export function parseCloudScheduleAuthCallback(
  callbackUrl: string,
  expectedState: string,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return null;
  }
  if (!isCloudScheduleAuthCallbackUrl(callbackUrl)) return null;
  if (parsed.searchParams.get(CLOUD_SCHEDULE_AUTH_STATE_QUERY_PARAM) !== expectedState) return null;
  return unwrapQuotedToken(parsed.searchParams.get(CLOUD_SCHEDULE_TOKEN_QUERY_PARAM));
}

export function findCloudScheduleAuthCallbackUrl(args: readonly string[]): string | null {
  return args.find((arg) => isCloudScheduleAuthCallbackUrl(arg)) ?? null;
}

export type CloudScheduleAuthCallbackBroker = {
  emit(url: string): boolean;
  subscribe(callback: (url: string) => void): () => void;
};

export function createCloudScheduleAuthCallbackBroker(): CloudScheduleAuthCallbackBroker {
  const subscribers = new Set<(url: string) => void>();
  const pending: string[] = [];

  return {
    emit(url) {
      if (!isCloudScheduleAuthCallbackUrl(url)) return false;
      if (subscribers.size === 0) {
        pending.push(url);
        return true;
      }
      for (const subscriber of subscribers) {
        subscriber(url);
      }
      return true;
    },
    subscribe(callback) {
      subscribers.add(callback);
      while (pending.length > 0) {
        const url = pending.shift();
        if (url) callback(url);
      }
      return () => {
        subscribers.delete(callback);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Inline authorization page HTML (self-contained, no external assets)
// ---------------------------------------------------------------------------

/**
 * The default brand logo as an inline SVG markup string (拓者 white wordmark).
 * The fill is `#fff` so it reads on the `#0d0d0d` dark background. Embedded
 * directly so the authorization page is fully self-contained (no external
 * asset fetch before the web sidecar is up).
 */
export const DEFAULT_AUTH_LOGO_SVG =
  '<svg viewBox="0 0 169.3 83.14" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Open Design"><polygon fill="#fff" points="95.35 45.32 95.58 45.32 116.88 45.32 119.41 21.33 167.04 21.33 169.3 0 100.28 0 98.18 21.33 96.24 38.89 51.3 38.91 53.13 21.33 88.3 21.33 90.52 0 2.3 0 0 21.33 29.13 21.33 26.77 45.32 25.53 58.42 49.27 58.42 94.73 58.42 94.12 58.42 93.44 64.73 48.61 64.73 24.81 64.73 22.72 82.9 46.72 82.9 47.94 71.16 92.88 71.16 91.62 83.14 160.49 83.14 162.44 64.69 130.91 64.69 130.91 64.73 114.83 64.71 116.18 51.96 94.88 51.96 94.87 51.99 49.92 52 50.62 45.32 95.35 45.32"/></svg>';

/**
 * Build the HTML for the inline authorization page. The page is self-contained:
 * no external assets, no fetch — it renders the brand surface (拓者 white logo)
 * on a dark background and a single CTA to start cloud-schedule authorization.
 *
 * Animation philosophy follows the root AGENTS.md: enter ~200ms with
 * `cubic-bezier(0.23, 1, 0.32, 1)`, never scale from 0.
 */
export function buildAuthPageHtml(options: {
  logoDataUrl?: string | null;
  logoSvg?: string | null;
}): string {
  const logoSvg = options.logoSvg ?? DEFAULT_AUTH_LOGO_SVG;
  const logoHtml = options.logoDataUrl
    ? `<img class="auth-logo auth-logo--img" src="${options.logoDataUrl}" alt="Open Design" />`
    : `<span class="auth-logo auth-logo--svg">${logoSvg}</span>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Open Design</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d0d0d;
    --text: #f5f5f5;
    --text-muted: #a8a8a8;
    --accent: #ffffff;
    --accent-hover: #e8e8e8;
    --border: #2a2a2a;
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    user-select: none;
  }
  .auth-page {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 40px;
    gap: 28px;
  }
  .auth-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    opacity: 0;
    transform: translateY(10px);
    animation: auth-enter 420ms var(--ease-out) 80ms forwards;
  }
  .auth-logo {
    display: block;
  }
  /* Horizontal wordmark (拓者 white logo) — sized by height. */
  .auth-logo--svg {
    height: 56px;
    width: auto;
    display: block;
  }
  .auth-logo--svg svg {
    height: 100%;
    width: auto;
    display: block;
  }
  .auth-logo--img {
    width: 76px;
    height: 76px;
    border-radius: 18px;
    object-fit: contain;
  }
  .auth-titles {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }
  .auth-welcome {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.2px;
  }
  .auth-subtitle {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.5;
    max-width: 360px;
  }
  .auth-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
    max-width: 320px;
    opacity: 0;
    transform: translateY(10px);
    animation: auth-enter 420ms var(--ease-out) 180ms forwards;
  }
  .auth-btn {
    width: 100%;
    height: 46px;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #0d0d0d;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: background 200ms var(--ease-out), transform 140ms var(--ease-out);
    font-family: inherit;
  }
  .auth-btn:hover { background: var(--accent-hover); }
  .auth-btn:active { transform: scale(0.98); }
  .auth-btn:disabled {
    background: #3a3a3a;
    color: var(--text-muted);
    cursor: not-allowed;
    transform: none;
  }
  .auth-hint {
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.7;
  }
  @keyframes auth-enter {
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
<div class="auth-page">
  <div class="auth-brand">
    ${logoHtml}
    <div class="auth-titles">
      <h1 class="auth-welcome">欢迎使用 Open Design</h1>
      <p class="auth-subtitle">使用云档期账号授权登录以继续</p>
    </div>
  </div>
  <div class="auth-actions">
    <button class="auth-btn" id="login-btn" type="button">使用云档期授权登录</button>
    <p class="auth-hint">点击后将打开云档期登录页面完成授权</p>
  </div>
</div>
<script>
  (function () {
    var btn = document.getElementById('login-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '正在打开登录页...';
      // Signal the main main process via a console marker (no preload required).
      // The main process observes console-message for this exact string.
      console.log('${AUTH_OPEN_LOGIN_MARKER}');
    });
  })();
</script>
</body>
</html>`;
}

/** Encode the auth page HTML as a `data:text/html` URL ready for `loadURL`. */
export function buildAuthPageDataUrl(options: {
  logoDataUrl?: string | null;
  logoSvg?: string | null;
}): string {
  const html = buildAuthPageHtml(options);
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// ---------------------------------------------------------------------------
// Token persistence (encrypted at rest via safeStorage when available)
// ---------------------------------------------------------------------------

type PersistedAuth = { token: string; savedAt: string };

/**
 * Persist the harvested token. The blob is written under the namespace data
 * root and encrypted with Electron `safeStorage` when the platform supports
 * it (macOS Keychain / Windows DPAPI / Linux libsecret). On platforms without
 * a backend the plaintext is stored; that matches how the cloud-schedule app
 * itself treats the token (sessionStorage), so we do not regress the threat
 * model — but callers should prefer `safeStorage.isEncryptionAvailable()`.
 */
export async function saveCloudAuthToken(
  deps: {
    dataRoot: string;
    encrypt?: (plaintext: string) => Buffer;
    writeFileImpl?: typeof writeFile;
    mkdirImpl?: typeof mkdir;
  },
  token: string,
): Promise<void> {
  const filePath = cloudAuthFilePath(deps.dataRoot);
  const mkdirImpl = deps.mkdirImpl ?? mkdir;
  const writeFileImpl = deps.writeFileImpl ?? writeFile;
  const encrypt = deps.encrypt ?? ((plaintext: string) => Buffer.from(plaintext, "utf8"));
  const payload: PersistedAuth = { token, savedAt: new Date().toISOString() };
  const encoded = encrypt(JSON.stringify(payload));
  await mkdirImpl(dirname(filePath), { recursive: true });
  await writeFileImpl(filePath, encoded, "utf8");
}

/**
 * Read and decrypt a previously persisted token. Returns null when the file
 * is absent, unreadable, or fails to decode (treat as "not authorized").
 */
export async function loadCloudAuthToken(
  deps: {
    dataRoot: string;
    decrypt?: (encoded: Buffer) => string;
    readFileImpl?: typeof readFile;
  },
): Promise<string | null> {
  const filePath = cloudAuthFilePath(deps.dataRoot);
  const readFileImpl = deps.readFileImpl ?? readFile;
  const decrypt = deps.decrypt ?? ((encoded: Buffer) => encoded.toString("utf8"));
  let encoded: Buffer;
  try {
    encoded = await readFileImpl(filePath);
  } catch {
    return null;
  }
  try {
    const json = decrypt(encoded);
    const parsed = JSON.parse(json) as PersistedAuth;
    if (typeof parsed.token === "string" && parsed.token.length > 0) return parsed.token;
    return null;
  } catch {
    return null;
  }
}

/** Remove the persisted token file (best-effort). Used on explicit logout. */
export async function clearCloudAuthToken(
  deps: { dataRoot: string; unlinkImpl?: (path: string) => Promise<void> },
): Promise<void> {
  const filePath = cloudAuthFilePath(deps.dataRoot);
  const unlinkImpl = deps.unlinkImpl ?? (async (path: string) => {
    const { unlink } = await import("node:fs/promises");
    await unlink(path);
  });
  try {
    await unlinkImpl(filePath);
  } catch {
    // best-effort — missing file is a no-op
  }
}

// ---------------------------------------------------------------------------
// Gate state machine (pure, testable)
// ---------------------------------------------------------------------------

export type AuthGateRuntimeDeps = {
  /** Factory for the primary auth (codex-style) window. */
  createAuthWindow(): BrowserWindow;
  /** Open the cloud-schedule login URL outside Electron. */
  openExternalLogin(options: { loginUrl: string }): Promise<void> | void;
  /**
   * Wire the "CTA clicked" signal from the auth window to the callback.
   * Returns a disposer. The signal source is runtime-specific (ipcMain or
   * console-message observation).
   */
  onOpenLoginRequest(authWindow: BrowserWindow, callback: () => void): () => void;
  /** Subscribe to OS-level `od://cloud-schedule-auth` callback URLs. */
  onAuthCallback(callback: (url: string) => void): () => void;
};

/**
 * Run the full authorization gate state machine. Shows the inline auth page;
 * when the CTA is signaled, opens the cloud-schedule login URL in the system
 * browser and waits for the browser to call back through `od://`.
 *
 * Resolves with `{ authorized: false }` if the user closes the auth window
 * without completing login (treated as app exit by the caller).
 *
 * Pure in the sense that all Electron interactions are behind `deps`, so the
 * packaged workspace can drive it with stub windows in vitest.
 */
export function runAuthGateStateMachine(
  deps: AuthGateRuntimeDeps & {
    authState: string;
    cloudScheduleUrl: string;
    parseAuthCallback: (callbackUrl: string, expectedState: string) => string | null;
  },
  persistence?: { save: (token: string) => Promise<void> },
): Promise<AuthGateResult> {
  const { authState, cloudScheduleUrl, parseAuthCallback } = deps;
  const loginUrl = buildCloudScheduleLoginUrl(cloudScheduleUrl, {
    callbackUrl: OPEN_DESIGN_AUTH_CALLBACK_URL,
    state: authState,
  });

  return new Promise<AuthGateResult>((resolve) => {
    let settled = false;
    let disposeOpenLogin: (() => void) | null = null;
    let disposeAuthCallback: (() => void) | null = null;

    const finish = (result: AuthGateResult): void => {
      if (settled) return;
      settled = true;
      disposeOpenLogin?.();
      disposeOpenLogin = null;
      disposeAuthCallback?.();
      disposeAuthCallback = null;
      try {
        authWindow.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const authWindow = deps.createAuthWindow();
    // User closes the auth window without completing login → authorized=false.
    // Guard with the `settled` flag so our own `finish()` close doesn't recurse.
    authWindow.on("closed", () => {
      if (!settled) finish({ authorized: false, token: null });
    });

    disposeAuthCallback = deps.onAuthCallback((url) => {
      const token = parseAuthCallback(url, authState);
      if (token == null) return;
      void (async () => {
        if (persistence) {
          try {
            await persistence.save(token);
          } catch {
            // persistence is best-effort; proceed with in-memory token
          }
        }
        finish({ authorized: true, token });
      })();
    });

    disposeOpenLogin = deps.onOpenLoginRequest(authWindow, () => {
      void Promise.resolve(deps.openExternalLogin({ loginUrl })).catch(() => {
        // The button remains available, so the user can retry if the OS launch
        // fails or the browser is closed before completing authorization.
      });
    });
  });
}
