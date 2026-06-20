import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const runtimeSource = readFileSync(new URL("../../src/main/runtime.ts", import.meta.url), "utf8");

describe("desktop BrowserWindow chrome options", () => {
  test("hides Electron's native menu bar in the Windows/Linux app window", () => {
    const browserWindowBlock = /const window = new BrowserWindow\(\{([\s\S]*?)webPreferences:/.exec(runtimeSource)?.[0] ?? "";

    expect(browserWindowBlock).toContain("autoHideMenuBar: true");
  });

  test("reserves native macOS traffic-light space without drawing fake controls", () => {
    expect(runtimeSource).toContain("padding-top: 0 !important;");
    expect(runtimeSource).toContain(".workspace-shell[data-client-type=\"desktop\"] .df-tree-head");
    expect(runtimeSource).not.toContain(".workspace-shell[data-client-type=\"desktop\"] .df-tree-head::before");
    expect(runtimeSource).not.toContain("#ff5f57");
    expect(runtimeSource).toContain("padding-left: 96px !important;");
    expect(runtimeSource).toContain("--df-tree-pane-width: 0px !important;");
    expect(runtimeSource).toContain("width: 96px !important;");
    expect(runtimeSource).toContain("--app-chrome-traffic-space: 96px !important;");
    expect(runtimeSource).toContain("--app-chrome-traffic-margin: 12px !important;");
    expect(runtimeSource).toContain("flex: 0 0 96px !important;");
    expect(runtimeSource).toContain(".workspace-shell[data-client-type=\"desktop\"] .workspace-side-tab-rail");
    expect(runtimeSource).toContain(".workspace-shell[data-client-type=\"desktop\"] .entry-main__topbar");
    expect(runtimeSource).toContain(".workspace-shell[data-client-type=\"desktop\"] .entry-nav-rail.is-open");
    expect(runtimeSource).toContain(".workspace-shell[data-client-type=\"desktop\"] .split.split-edit-focus .viewer-toolbar");
  });

  test("keeps the visible renderer responsive when Chromium misclassifies visibility", () => {
    const browserWindowBlock = /const window = new BrowserWindow\(\{([\s\S]*?)width: 1280,/.exec(runtimeSource)?.[0] ?? "";

    expect(browserWindowBlock).toContain("backgroundThrottling: false");
  });
});
