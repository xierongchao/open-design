/**
 * Electron runtime binding for the cloud-schedule authorization gate.
 *
 * `apps/packaged/src/auth-window.ts` holds the pure, testable core (URL
 * policy, token unwrap, HTML builder, persistence, gate state machine). This
 * module is the thin Electron shell: it constructs real `BrowserWindow`
 * instances and wires the CTA signal, then delegates to the core.
 *
 * Split this way so the packaged workspace's vitest can pin the gate's
 * behaviour without booting a full Electron runtime — mirroring how
 * `protocol.ts` (pure) and the packaged entry (Electron) are separated.
 */

import { randomUUID } from "node:crypto";

import { BrowserWindow, safeStorage, shell } from "electron";

import {
  AUTH_OPEN_LOGIN_MARKER,
  buildAuthPageDataUrl,
  loadCloudAuthToken,
  parseCloudScheduleAuthCallback,
  resolveCloudScheduleUrl,
  runAuthGateStateMachine,
  saveCloudAuthToken,
  type AuthGateOptions,
  type AuthGateResult,
} from "./auth-window.js";

/** Encrypt a plaintext token string using safeStorage when available. */
function encryptToken(plaintext: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext);
  }
  return Buffer.from(plaintext, "utf8");
}

/** Decrypt an encoded token buffer using safeStorage when available. */
function decryptToken(encoded: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(encoded);
    } catch {
      // fall through to plaintext
    }
  }
  return encoded.toString("utf8");
}

/**
 * Run the authorization gate against the real Electron runtime.
 *
 * Callers MUST invoke this after `app.whenReady()` and with the splash window
 * already on screen (the gate window layers on top of the splash). The data
 * root must be the namespace-scoped data root — never a cwd-relative path.
 */
export async function runAuthGate(options: AuthGateOptions): Promise<AuthGateResult> {
  const cloudScheduleUrl = resolveCloudScheduleUrl(options.cloudScheduleUrl);

  // Pre-check: a previously persisted token skips the gate entirely so
  // returning users are not asked to re-authorize on every launch.
  const existing = await loadCloudAuthToken({
    dataRoot: options.dataRoot,
    decrypt: decryptToken,
  });
  if (existing != null) {
    return { authorized: true, token: existing };
  }

  return runAuthGateStateMachine(
    {
      authState: options.authState ?? randomUUID(),
      cloudScheduleUrl,
      parseAuthCallback: parseCloudScheduleAuthCallback,
      createAuthWindow() {
        // The brand splash (1280x900, frameless, show:true) is already on
        // screen when the gate runs. A small centered auth window would
        // render underneath it and be invisible. Hide the splash while the
        // gate is active so the auth page is the sole surface; the splash
        // is restored when the gate resolves (see the index.ts caller).
        if (options.splashWindow != null && !options.splashWindow.isDestroyed()) {
          options.splashWindow.hide();
        }
        const win = new BrowserWindow({
          width: 900,
          height: 640,
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          frame: true,
          title: "Open Design",
          backgroundColor: "#fbfbfa",
          show: true,
          autoHideMenuBar: true,
          center: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        win.focus();
        // No logo options passed → buildAuthPageHtml uses the bundled Open
        // Design mark and a self-contained light authorization page.
        void win.loadURL(buildAuthPageDataUrl({}));
        return win;
      },
      async openExternalLogin({ loginUrl }) {
        await shell.openExternal(loginUrl);
      },
      onAuthCallback(callback) {
        return options.onAuthCallback?.(callback) ?? (() => undefined);
      },
      onOpenLoginRequest(authWindow, callback) {
        // The inline auth page emits the CTA signal as a console.log with a
        // well-known marker (see buildAuthPageHtml). Observe it here. This
        // avoids a dedicated preload file for a single button.
        //
        // Electron 41 changed `console-message` to emit a single
        // Event<WebContentsConsoleMessageEventParams> whose `.message` holds
        // the logged string (the old `(_event, level, message)` positional
        // signature is deprecated). Read `.message` off the event object.
        const handler = (details: { message?: string }): void => {
          const message = typeof details?.message === "string" ? details.message : "";
          if (message.trim() === AUTH_OPEN_LOGIN_MARKER) callback();
        };
        authWindow.webContents.on("console-message", handler);
        return () => {
          authWindow.webContents.removeListener("console-message", handler);
        };
      },
    },
    {
      async save(token) {
        await saveCloudAuthToken(
          {
            dataRoot: options.dataRoot,
            encrypt: encryptToken,
          },
          token,
        );
      },
    },
  );
}
