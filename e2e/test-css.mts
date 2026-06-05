import { chromium } from '@playwright/test';

const CHROMIUM_PATH = '/Users/xierongchao/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('http://127.0.0.1:55574', { waitUntil: 'load', timeout: 30_000 });
  await page.waitForTimeout(5000);

  // Click project
  await page.locator('button.recent-projects__card').first().click({ force: true });
  await page.waitForTimeout(5000);

  // Click Edit button
  const editBtn = page.locator('button[title="Edit"]').first();
  await editBtn.click({ force: true });
  await page.waitForTimeout(3000);

  // Check CSS loading
  const cssInfo = await page.evaluate(() => {
    // Check if properties-panel.css loaded
    const sheets = Array.from(document.styleSheets);
    const ppSheetInfo: Array<{href: string | null, hasPpDockActive: boolean, hasManualEditWorkspace: boolean}> = [];
    for (const sheet of sheets) {
      try {
        const rules = sheet.cssRules;
        const text = Array.from(rules).map(r => r.cssText).join('\n');
        const hasPpDockActive = text.includes('pp-dock-active');
        const hasManualEditWorkspace = text.includes('manual-edit-workspace');
        if (hasPpDockActive || hasManualEditWorkspace) {
          ppSheetInfo.push({
            href: sheet.href?.substring(0, 200) ?? 'inline',
            hasPpDockActive,
            hasManualEditWorkspace,
          });
        }
      } catch { /* cross-origin */ }
    }

    // Check computed styles on the workspace
    const workspace = document.querySelector('.manual-edit-workspace.pp-dock-active');
    const computedWorkspace = workspace ? window.getComputedStyle(workspace) : null;
    const workspaceStyles = workspace ? {
      display: computedWorkspace?.display,
      gridTemplateColumns: computedWorkspace?.gridTemplateColumns,
      width: (workspace as HTMLElement).offsetWidth,
      height: (workspace as HTMLElement).offsetHeight,
      classes: (workspace as HTMLElement).className,
    } : null;

    // Check the pp-dock aside
    const dock = document.querySelector('.pp-dock');
    const computedDock = dock ? window.getComputedStyle(dock) : null;
    const dockStyles = dock ? {
      display: computedDock?.display,
      flexDirection: computedDock?.flexDirection,
      width: (dock as HTMLElement).offsetWidth,
      height: (dock as HTMLElement).offsetHeight,
      borderLeft: computedDock?.borderLeft,
      background: computedDock?.background?.substring(0, 50),
    } : null;

    // Check the canvas
    const canvas = document.querySelector('.manual-edit-canvas');
    const canvasStyles = canvas ? {
      display: window.getComputedStyle(canvas).display,
      order: window.getComputedStyle(canvas).order,
      width: (canvas as HTMLElement).offsetWidth,
      height: (canvas as HTMLElement).offsetHeight,
      position: window.getComputedStyle(canvas).position,
      overflow: window.getComputedStyle(canvas).overflow,
    } : null;

    // Check for iframe inside canvas
    const iframeInCanvas = canvas?.querySelector('iframe');
    const iframeStyles = iframeInCanvas ? {
      src: iframeInCanvas.src?.substring(0, 200),
      srcdoc: iframeInCanvas.srcdoc?.substring(0, 200),
      width: iframeInCanvas.offsetWidth,
      height: iframeInCanvas.offsetHeight,
    } : null;

    // Check what's inside manual-edit-canvas
    const canvasChildren = canvas ? Array.from(canvas.children).map(c => ({
      tag: c.tagName,
      cls: (c as HTMLElement).className?.substring(0, 100),
      w: (c as HTMLElement).offsetWidth,
      h: (c as HTMLElement).offsetHeight,
      children: c.children.length,
    })) : null;

    return { ppSheetInfo, workspaceStyles, dockStyles, canvasStyles, iframeStyles, canvasChildren };
  });

  console.log('CSS sheets with edit classes:', JSON.stringify(cssInfo.ppSheetInfo, null, 2));
  console.log('\nWorkspace styles:', JSON.stringify(cssInfo.workspaceStyles, null, 2));
  console.log('\nDock styles:', JSON.stringify(cssInfo.dockStyles, null, 2));
  console.log('\nCanvas styles:', JSON.stringify(cssInfo.canvasStyles, null, 2));
  console.log('\nIframe in canvas:', JSON.stringify(cssInfo.iframeStyles, null, 2));
  console.log('\nCanvas children:', JSON.stringify(cssInfo.canvasChildren, null, 2));

  await browser.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
