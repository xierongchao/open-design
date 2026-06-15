import { expect, test } from '@playwright/test';
import { ensureRailOpen } from '@/playwright/rail';
import { routeMockAgents } from '@/playwright/mock-factory';
import type { Locator, Page } from '@playwright/test';
import { T } from '@/timeouts';

// Verifies the GrapesJS-driven HTML canvas behaviour that the PR3 fixes
// promised:
//   1. clicking an element shows GrapesJS's native selection affordance
//      (toolbar / resizer) in the host tool layer — the regression that the
//      capture-phase click interceptor + 9999px box-shadow caused;
//   2. the Figma-style canvas zoom (Cmd/Ctrl + wheel) drives
//      Canvas.setZoom and the zoom value actually changes;
//   3. Interactive (preview) mode lets an <a> click navigate the canvas
//      iframe — the prototype-demo use case.

const STORAGE_KEY = 'open-design:config';
// The GrapesJS canvas mounts inside .artifact-preview-grapesjs; the iframe it
// renders is tagged with data-od-render-mode="grapesjs".
const GRAPESJS_IFRAME_SELECTOR =
  'iframe[data-od-render-mode="grapesjs"]';

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'mock',
        skillId: null,
        designSystemId: null,
        onboardingCompleted: true,
        agentModels: {},
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, STORAGE_KEY);

  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: 'mock',
          skillId: null,
          designSystemId: null,
          agentModels: {},
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });
});

function plainHtml(): string {
  // Plain static HTML with no runtime <script> so shouldUseGrapesjs() returns
  // true (htmlHasRuntimeScript is false). Includes a hero + a link for the
  // interactive-navigation check.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>GrapesJS smoke</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; }
  .hero { background: #eef; padding: 32px; border-radius: 8px; }
  .hero h1 { margin: 0 0 8px; }
  .card { margin-top: 16px; padding: 16px; border: 1px solid #ddd; border-radius: 8px; }
</style>
</head>
<body>
  <div class="hero" data-od-id="hero">
    <h1>Hello GrapesJS</h1>
    <p>Click the heading to verify native selection.</p>
  </div>
  <div class="card" data-od-id="card">
    <p>Second block for resize-handle verification.</p>
  </div>
  <a href="#next-page" data-od-id="demo-link">Go to next page</a>
</body>
</html>`;
}

function flexSpacingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>GrapesJS flex spacing</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 40px; }
  .flex-row {
    display: flex;
    align-items: center;
    gap: 20px;
    margin: 16px;
    padding: 18px 24px;
    background: #f7f7fb;
  }
  .flex-item {
    width: 120px;
    height: 64px;
    display: grid;
    place-items: center;
    background: #d9d9df;
  }
</style>
</head>
<body>
  <div class="flex-row" data-od-id="flex-row">
    <div class="flex-item" data-od-id="item-a">A</div>
    <div class="flex-item" data-od-id="item-b">B</div>
    <div class="flex-item" data-od-id="item-c">C</div>
  </div>
</body>
</html>`;
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading Open Design…').waitFor({ state: 'hidden', timeout: T.medium });
}

async function createEmptyProject(page: Page, name: string): Promise<string> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve Open Design' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-new-project').click();
  await expect(page.getByTestId('new-project-modal')).toBeVisible();
  await page.getByTestId('new-project-name').fill(name);
  await page.getByTestId('create-project').click();
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//);
  const current = new URL(page.url());
  const [, projects, projectId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) throw new Error(`unexpected project route: ${current.pathname}`);
  return projectId;
}

async function seedHtmlArtifact(page: Page, projectId: string, fileName: string, content: string) {
  const resp = await page.request.post(`/api/projects/${projectId}/files`, {
    data: {
      name: fileName,
      content,
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: fileName,
        entry: fileName,
        renderer: 'html',
        exports: ['html'],
      },
    },
    timeout: 15_000,
  });
  expect(resp.ok()).toBeTruthy();
}

async function openDesignFile(page: Page, fileName: string) {
  await page.goto(`/projects/${await currentProjectId(page)}/files/${fileName}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForLoadingToClear(page);
}

async function currentProjectId(page: Page): Promise<string> {
  const current = new URL(page.url());
  const [, projects, projectId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) throw new Error(`not on a project route: ${current.pathname}`);
  return projectId;
}

function grapesjsIframe(page: Page) {
  return page.locator(GRAPESJS_IFRAME_SELECTOR).first();
}

test('[P0] GrapesJS canvas shows native selection toolbar on click', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS selection smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-smoke.html', plainHtml());
  await openDesignFile(page, 'gjs-smoke.html');

  // The GrapesJS canvas iframe must mount (proves shouldUseGrapesjs returned
  // true and the editor booted).
  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  await expect(iframe).toHaveAttribute('data-od-render-mode', 'grapesjs');

  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const heroHeading = frame.getByRole('heading', { name: 'Hello GrapesJS' });
  await expect(heroHeading).toBeVisible({ timeout: 15_000 });

  // Click a real artifact element. GrapesJS should select the underlying
  // component and render its native selection affordance in the host tool
  // layer (.gjs-toolbar / .gjs-resizer live outside the iframe, in the
  // .gjs-tools overlay). Before the fix, the capture-phase click interceptor
  // + 9999px box-shadow masked this — so asserting the toolbar appears is the
  // direct regression check.
  await heroHeading.click({ force: true });

  // The toolbar carries action buttons (move, copy, delete) and appears in
  // the host document's .gjs-tools overlay once a selectable component is
  // selected.
  const toolbar = page.locator('.gjs-toolbar').first();
  await expect(toolbar).toBeVisible({ timeout: 10_000 });

  // PERSISTENCE: wait well past the emitChange debounce (150ms) + the
  // host→prop→setComponents round trip. The selection-loop bug rebuilt the
  // whole canvas (editor.setComponents) ~300-500ms after each click because
  // emitChange didn't sync lastExternalHtmlRef, so the host's echoed html was
  // treated as new external content. That wiped the selection toolbar. This
  // wait + re-assertion is the direct guard against the regression.
  await page.waitForTimeout(900);
  await expect(toolbar).toBeVisible();

  // RIGHT PANEL: clicking an element must populate the right-hand Edit tab.
  // The selection callback forwards data-od-id(s) to the host, which builds an
  // InspectTarget (from the live selected component, not a by-id tree walk)
  // and renders it in the grapesjs-sidebar. Two earlier regressions left the
  // sidebar showing its empty placeholder: (1) the selection-loop wiped the
  // selection, (2) findComponentByOdId missed components whose data-od-id
  // GrapesJS stripped from the model. Assert the empty placeholder is GONE,
  // which proves an inspect target materialised.
  const sidebar = page.getByTestId('grapesjs-sidebar');
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  await expect(sidebar).not.toContainText('Select an element to inspect.', { timeout: 10_000 });
});

test('[P0] GrapesJS canvas zoom responds to Ctrl/Cmd + wheel', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS zoom smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-zoom.html', plainHtml());
  await openDesignFile(page, 'gjs-zoom.html');

  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  await expect(frame.getByRole('heading', { name: 'Hello GrapesJS' })).toBeVisible({ timeout: 15_000 });

  // The canvas container exposes the live zoom as data-od-canvas-zoom (set by
  // GrapesjsEditor on every zoom change). Initial zoom should be 100.
  const grapesjsRoot = page.locator('.artifact-preview-grapesjs').first();
  await expect(grapesjsRoot).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => grapesjsRoot.getAttribute('data-od-canvas-zoom'), { timeout: 10_000 }).toBe('100');

  // Ctrl/Cmd + wheel down over the canvas to zoom out.
  const canvasBox = await iframe.boundingBox();
  if (!canvasBox) throw new Error('canvas iframe has no bounding box');
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(mod);
  await page.mouse.wheel(0, 120);
  await page.keyboard.up(mod);
  await page.waitForTimeout(500);

  // Zoom should have decreased below 100 (we wheeled down = zoom out).
  await expect.poll(async () => {
    const v = await grapesjsRoot.getAttribute('data-od-canvas-zoom');
    return v ? Number(v) : NaN;
  }, { timeout: 10_000 }).toBeLessThan(100);

  // Ctrl/Cmd + 0 resets to 100.
  await page.keyboard.press(`${mod}+Digit0`);
  await page.waitForTimeout(500);
  await expect.poll(async () => grapesjsRoot.getAttribute('data-od-canvas-zoom'), { timeout: 10_000 }).toBe('100');
});

test('[P0] GrapesJS canvas uses fine-grained cursor-anchored wheel zoom', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS anchored zoom smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-anchored-zoom.html', plainHtml());
  await openDesignFile(page, 'gjs-anchored-zoom.html');

  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const heading = frame.getByRole('heading', { name: 'Hello GrapesJS' });
  await expect(heading).toBeVisible({ timeout: 15_000 });

  const grapesjsRoot = page.locator('.artifact-preview-grapesjs').first();
  await expect.poll(async () => grapesjsRoot.getAttribute('data-od-canvas-zoom'), { timeout: 10_000 }).toBe('100');

  const before = await heading.boundingBox();
  if (!before) throw new Error('heading has no bounding box');
  const anchor = {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  };
  await page.mouse.move(anchor.x, anchor.y);

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(mod);
  await page.mouse.wheel(0, 4);
  await page.keyboard.up(mod);

  const zoom = await expect.poll(async () => {
    const value = await grapesjsRoot.getAttribute('data-od-canvas-zoom');
    return value ? Number(value) : NaN;
  }, { timeout: 10_000 }).toBeLessThan(100);
  void zoom;

  const nextZoom = Number(await grapesjsRoot.getAttribute('data-od-canvas-zoom'));
  expect(nextZoom).toBeGreaterThan(98);

  const after = await heading.boundingBox();
  if (!after) throw new Error('heading has no bounding box after zoom');
  const afterCenter = {
    x: after.x + after.width / 2,
    y: after.y + after.height / 2,
  };
  expect(Math.abs(afterCenter.x - anchor.x)).toBeLessThan(2);
  expect(Math.abs(afterCenter.y - anchor.y)).toBeLessThan(2);
});

test('[P0] Interactive mode renders a plain iframe (no editor) and links navigate', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS interactive smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-interactive.html', plainHtml());
  await openDesignFile(page, 'gjs-interactive.html');

  // Edit mode: GrapesJS canvas is mounted.
  const editFrame = grapesjsIframe(page);
  await expect(editFrame).toBeVisible({ timeout: 20_000 });
  const editContent = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  await expect(editContent.getByRole('heading', { name: 'Hello GrapesJS' })).toBeVisible({ timeout: 15_000 });

  // Switch to Interactive mode — the editor unmounts and a plain iframe takes
  // over for pure prototype demo (no selection / no editing chrome).
  const interactiveButton = page.getByTestId('grapesjs-interactive-toggle');
  await interactiveButton.click();
  await expect(interactiveButton).toHaveAttribute('aria-pressed', 'true');

  // The plain interactive iframe must appear; the GrapesJS editor iframe is gone.
  const interactiveFrame = page.getByTestId('grapesjs-interactive-frame');
  await expect(interactiveFrame).toBeVisible({ timeout: 10_000 });
  // The sidebar (StylePanel) must be hidden in interactive mode.
  await expect(page.getByTestId('grapesjs-sidebar')).toHaveCount(0);

  // Links inside the plain iframe navigate natively (no GrapesJS interception).
  const viewContent = page.frameLocator('[data-testid="grapesjs-interactive-frame"]');
  const link = viewContent.locator('a[data-od-id="demo-link"]');
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click({ force: true });
  await expect.poll(
    async () => interactiveFrame.evaluate((el: HTMLIFrameElement) => el.contentWindow?.location.hash ?? ''),
    { timeout: 10_000 },
  ).toBe('#next-page');

  // Switching back to edit mode remounts the GrapesJS editor.
  await interactiveButton.click();
  await expect(interactiveButton).toHaveAttribute('aria-pressed', 'false');
  await expect(grapesjsIframe(page)).toBeVisible({ timeout: 15_000 });
});

test('[P0] Space+drag pan persists after Space release (no snap-back)', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS pan smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-pan.html', plainHtml());
  await openDesignFile(page, 'gjs-pan.html');

  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  await expect(frame.getByRole('heading', { name: 'Hello GrapesJS' })).toBeVisible({ timeout: 15_000 });

  const grapesjsRoot = page.locator('.artifact-preview-grapesjs').first();
  await expect(grapesjsRoot).toBeVisible({ timeout: 10_000 });
  // Initial coords should be 0,0.
  await expect.poll(async () => grapesjsRoot.getAttribute('data-od-canvas-coords'), { timeout: 10_000 }).toBe('0,0');

  const canvasBox = await iframe.boundingBox();
  if (!canvasBox) throw new Error('canvas iframe has no bounding box');
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.mouse.move(cx, cy);
  await page.keyboard.down(mod);
  await page.mouse.wheel(0, 40);
  await page.keyboard.up(mod);
  await expect.poll(async () => {
    const value = await grapesjsRoot.getAttribute('data-od-canvas-zoom');
    return value ? Number(value) : NaN;
  }, { timeout: 10_000 }).toBeLessThan(100);

  const heading = frame.getByRole('heading', { name: 'Hello GrapesJS' });
  await heading.click({ force: true });
  await expect(page.locator('.gjs-toolbar').first()).toBeVisible({ timeout: 10_000 });

  // Hold Space, drag the canvas, release the mouse, THEN release Space. The
  // regression was that releasing Space snapped the canvas back to 0,0 because
  // the browser's default Space-scroll fired and reset the scrollable canvas.
  await page.keyboard.down('Space');
  await page.waitForTimeout(100);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 80, { steps: 8 });
  // Read the panned coords BEFORE releasing Space, while the left button is
  // still held. Releasing Space must end the pan immediately.
  const coordsBeforeSpaceUp = await grapesjsRoot.getAttribute('data-od-canvas-coords');
  expect(coordsBeforeSpaceUp, 'pan should have moved coords away from 0,0').not.toBe('0,0');

  // Release Space — the regression snap-back happens here.
  await page.keyboard.up('Space');
  await page.mouse.move(cx + 170, cy + 120, { steps: 4 });
  await page.waitForTimeout(400);

  // Coords must neither snap back nor keep following the still-held mouse.
  const coordsAfterSpaceUp = await grapesjsRoot.getAttribute('data-od-canvas-coords');
  expect(coordsAfterSpaceUp, 'coords must persist after Space release (no snap-back)').toBe(coordsBeforeSpaceUp);
  await page.mouse.up();
});

test('[P0] middle-mouse pan keeps the current DOM selection stable', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS middle pan smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-middle-pan.html', plainHtml());
  await openDesignFile(page, 'gjs-middle-pan.html');

  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const heading = frame.getByRole('heading', { name: 'Hello GrapesJS' });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  await heading.click({ force: true });

  const sidebar = page.getByTestId('grapesjs-sidebar');
  await expect(sidebar.locator('strong').first()).toContainText('H1', { timeout: 10_000 });
  const grapesjsRoot = page.locator('.artifact-preview-grapesjs').first();
  const [beforeX = 0, beforeY = 0] = (await grapesjsRoot.getAttribute('data-od-canvas-coords') ?? '0,0')
    .split(',')
    .map(Number);

  const canvasBox = await iframe.boundingBox();
  if (!canvasBox) throw new Error('canvas iframe has no bounding box');
  const startX = canvasBox.x + canvasBox.width * 0.75;
  const startY = canvasBox.y + canvasBox.height * 0.75;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(startX + 80, startY + 50, { steps: 6 });
  await expect(sidebar.locator('strong').first()).toContainText('H1');
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(350);
  await expect(sidebar.locator('strong').first()).toContainText('H1');
  const [afterX = 0, afterY = 0] = (await grapesjsRoot.getAttribute('data-od-canvas-coords') ?? '0,0')
    .split(',')
    .map(Number);
  expect(afterX - beforeX).toBeCloseTo(80, -1);
  expect(afterY - beforeY).toBeCloseTo(50, -1);
});

test('[P0] Delete removes the selected element, Undo restores it', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS keyboard smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-keys.html', plainHtml());
  await openDesignFile(page, 'gjs-keys.html');

  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const heroHeading = frame.getByRole('heading', { name: 'Hello GrapesJS' });
  await expect(heroHeading).toBeVisible({ timeout: 15_000 });

  // Select the heading.
  await heroHeading.click({ force: true });
  const toolbar = page.locator('.gjs-toolbar').first();
  await expect(toolbar).toBeVisible({ timeout: 10_000 });

  // Delete it via the Delete key.
  await page.keyboard.press('Delete');
  await expect(heroHeading).toHaveCount(0);

  // Undo the delete via Cmd/Ctrl+Z. GrapesJS 0.23 ships core:undo but no
  // default keymap binding, so this verifies our explicit keymap handler
  // restored the heading.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+z`);
  await expect(heroHeading).toBeVisible({ timeout: 10_000 });
});

test('[P0] arrow keys swap a selected child through a flex row', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS flex reorder');
  await seedHtmlArtifact(page, projectId, 'gjs-flex-reorder.html', flexSpacingHtml());
  await openDesignFile(page, 'gjs-flex-reorder.html');

  await expect(grapesjsIframe(page)).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const itemB = frame.locator('[data-od-id="item-b"]');
  await expect(itemB).toBeVisible({ timeout: 15_000 });
  // A plain click selects the nearest flex frame. Double-click enters that
  // frame and selects the child, matching the editor's nested-selection model.
  await itemB.dblclick({ force: true });
  await expect(page.getByTestId('grapesjs-sidebar').locator('code').first()).toContainText('flex-item');

  const itemOrder = () => frame.locator('.flex-item').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-od-id')),
  );
  await expect.poll(itemOrder).toEqual(['item-a', 'item-b', 'item-c']);

  await page.keyboard.press('ArrowRight');
  await expect.poll(itemOrder).toEqual(['item-a', 'item-c', 'item-b']);

  await page.keyboard.press('ArrowLeft');
  await expect.poll(itemOrder).toEqual(['item-a', 'item-b', 'item-c']);
});

test('[P0] gap guides belong to a selected flex container and sit between every child', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS gap guides');
  await seedHtmlArtifact(page, projectId, 'gjs-gap-guides.html', flexSpacingHtml());
  await openDesignFile(page, 'gjs-gap-guides.html');

  await expect(grapesjsIframe(page)).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const flex = frame.locator('[data-od-id="flex-row"]');
  await expect(flex).toBeVisible({ timeout: 15_000 });
  await flex.click({ position: { x: 6, y: 6 }, force: true });

  const gapHandles = page.locator('[data-od-spacing-kind="gap"]:visible');
  await expect(gapHandles).toHaveCount(2);

  const childBoxes = await Promise.all([
    frame.locator('[data-od-id="item-a"]').boundingBox(),
    frame.locator('[data-od-id="item-b"]').boundingBox(),
    frame.locator('[data-od-id="item-c"]').boundingBox(),
  ]);
  if (childBoxes.some((box) => !box)) throw new Error('flex child has no bounding box');
  const handleBoxes = await gapHandles.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    }),
  );
  const [a, b, c] = childBoxes as [
    NonNullable<(typeof childBoxes)[number]>,
    NonNullable<(typeof childBoxes)[number]>,
    NonNullable<(typeof childBoxes)[number]>,
  ];
  expect(handleBoxes[0]!.x + handleBoxes[0]!.width / 2).toBeCloseTo((a.x + a.width + b.x) / 2, 0);
  expect(handleBoxes[1]!.x + handleBoxes[1]!.width / 2).toBeCloseTo((b.x + b.width + c.x) / 2, 0);

  await frame.locator('[data-od-id="item-b"]').dblclick({ force: true });
  await expect(page.locator('[data-od-spacing-kind="gap"]:visible')).toHaveCount(0);
});

test('[P0] spacing guides reveal stripes and values on hover and drag without moving the component', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS spacing drag');
  await seedHtmlArtifact(page, projectId, 'gjs-spacing-drag.html', flexSpacingHtml());
  await openDesignFile(page, 'gjs-spacing-drag.html');

  await expect(grapesjsIframe(page)).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const flex = frame.locator('[data-od-id="flex-row"]');
  await expect(flex).toBeVisible({ timeout: 15_000 });
  await flex.click({ position: { x: 6, y: 6 }, force: true });

  const paddingHandle = page.locator(
    '[data-od-spacing-kind="padding"][data-od-spacing-prop="padding-left"]:visible',
  );
  const paddingBand = page.locator(
    '[data-od-spacing-band-kind="padding"][data-od-spacing-prop="padding-left"]:visible',
  );
  await expect(paddingHandle).toHaveCount(1);
  await expect(paddingBand).toHaveCSS('background-image', 'none');

  await paddingHandle.hover();
  await expect(paddingBand).toHaveCSS('background-image', /repeating-linear-gradient/);
  const spacingTip = page.locator('[data-od-spacing-tip="true"]');
  await expect(spacingTip).toBeVisible();
  await expect(spacingTip).toContainText('24');

  const dragBy = async (locator: Locator, dx: number, dy: number) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('spacing handle has no bounding box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
  };
  const computedNumber = (property: 'gap' | 'padding-left' | 'margin-right') =>
    flex.evaluate((element, prop) => parseFloat(getComputedStyle(element).getPropertyValue(prop)), property);
  const selectedOrder = () => frame.locator('.flex-item').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-od-id')),
  );

  await dragBy(paddingHandle, 12, 0);
  await expect.poll(() => computedNumber('padding-left')).toBeCloseTo(36, 0);

  const gapHandle = page.locator('[data-od-spacing-kind="gap"][data-od-spacing-index="0"]:visible');
  await dragBy(gapHandle, 24, 0);
  await expect.poll(() => computedNumber('gap')).toBeCloseTo(44, 0);

  const marginHandle = page.locator(
    '[data-od-spacing-kind="margin"][data-od-spacing-prop="margin-right"]:visible',
  );
  await dragBy(marginHandle, 10, 0);
  await expect.poll(() => computedNumber('margin-right')).toBeCloseTo(26, 0);
  await expect.poll(selectedOrder).toEqual(['item-a', 'item-b', 'item-c']);
});

test('[P0] Style panel shows the selected element\'s properties', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS style panel smoke');
  await seedHtmlArtifact(page, projectId, 'gjs-style.html', plainHtml());
  await openDesignFile(page, 'gjs-style.html');

  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const heroHeading = frame.getByRole('heading', { name: 'Hello GrapesJS' });
  await expect(heroHeading).toBeVisible({ timeout: 15_000 });

  // Select the heading — this drives onSelectionChange which feeds the
  // StylePanel's computed-style snapshot.
  await heroHeading.click({ force: true });
  await expect(page.locator('.gjs-toolbar').first()).toBeVisible({ timeout: 10_000 });
  // Give the selection callback + rAF snapshot time to run.
  await page.waitForTimeout(500);

  // The Figma-style StylePanel renders inside the sidebar. It must show the
  // selected element's tag name and the fixed Figma-style property groups.
  // The regression was an empty panel.
  const sidebar = page.getByTestId('grapesjs-sidebar');
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  // The panel header shows the element's tag name in uppercase.
  await expect(sidebar.locator('strong').first()).toContainText('H1', { timeout: 10_000 });
  // At least one section (位置/自动布局/外观/填充/描边/效果) must render.
  const sectionHeaders = sidebar.getByRole('heading', { name: /位置|自动布局|外观|填充|描边|效果/i });
  await expect(sectionHeaders.first()).toBeVisible({ timeout: 10_000 });
});

test('[P0] canvas edits auto-save and survive a reload', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'GrapesJS autosave smoke');
  const fileName = 'gjs-autosave.html';
  await seedHtmlArtifact(page, projectId, fileName, plainHtml());
  await openDesignFile(page, fileName);

  const iframe = grapesjsIframe(page);
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  const heroHeading = frame.getByRole('heading', { name: 'Hello GrapesJS' });
  await expect(heroHeading).toBeVisible({ timeout: 15_000 });

  // Double-click the heading to enter inline text edit, then type a marker
  // string GrapesJS will persist into the component (and thus into the
  // exported HTML / saved file).
  await heroHeading.dblclick({ force: true });
  await page.waitForTimeout(300);
  // Select-all within the editable text node and replace.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type('EditedAndSaved');
  // Click elsewhere to commit the text edit.
  await page.mouse.click(10, 10);
  await page.waitForTimeout(300);

  // Wait for the 1500ms auto-save debounce to fire and complete the write.
  await expect.poll(
    async () => {
      const resp = await page.request.get(`/api/projects/${projectId}/files/${fileName}`);
      if (!resp.ok()) return false;
      const source = await resp.text();
      return source.includes('EditedAndSaved');
    },
    { timeout: 15_000 },
  ).toBe(true);

  // Reload the file and confirm the edit survived.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await expect(grapesjsIframe(page)).toBeVisible({ timeout: 20_000 });
  const reloadedFrame = page.frameLocator(GRAPESJS_IFRAME_SELECTOR);
  await expect(reloadedFrame.getByText('EditedAndSaved')).toBeVisible({ timeout: 15_000 });
});
