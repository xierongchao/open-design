import { expect, test } from '@playwright/test';
import { ensureRailOpen } from '@/playwright/rail';
import { routeAgents } from '@/playwright/mock-factory';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

const STORAGE_KEY = 'open-design:config';
const ACTIVE_ARTIFACT_PREVIEW_SELECTOR = '[data-testid="artifact-preview-frame"]:visible, [data-testid="artifact-preview-frame-url-load"]:visible, [data-testid="artifact-preview-frame-srcdoc"]:visible, [data-testid="live-artifact-preview-frame"]:visible';

test.describe.configure({ timeout: 30_000 });

function artifactPreview(page: Page) {
  return page.locator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR).first();
}

function artifactPreviewFrame(page: Page) {
  return page.frameLocator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR);
}

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

test('preview toolbar keeps share, download, comment, and zoom actions reachable', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Preview toolbar smoke');
  await seedHtmlArtifact(page, projectId, 'toolbar-preview.html', previewToolsHtml());
  await page.goto(`/projects/${projectId}/files/toolbar-preview.html`);
  await openDesignFile(page, 'toolbar-preview.html');

  await expect(page.getByTestId('artifact-preview-frame')).toBeVisible();
  await expect(
    page.getByRole('tablist', { name: 'View mode' }).getByRole('tab', { name: 'Preview' }),
  ).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: /^Share$/ }).click();
  const shareMenu = page.locator('.share-menu-popover[role="menu"]');
  await expect(shareMenu).toBeVisible();
  await expect(shareMenu).toContainText('PUBLISH ONLINE');
  await expect(shareMenu).toContainText('SOCIAL SHARE');
  await page.keyboard.press('Escape');
  await expect(shareMenu).toHaveCount(0);

  await page.getByRole('button', { name: /^Download$/ }).click();
  const downloadMenu = page.locator('.share-menu-popover[role="menu"]');
  await expect(downloadMenu).toBeVisible();
  await expect(downloadMenu.getByRole('menuitem', { name: /Export as PDF/ })).toBeVisible();
  await expect(downloadMenu.getByRole('menuitem', { name: /Download as \.zip/ })).toBeVisible();
  await expect(downloadMenu.getByRole('menuitem', { name: /Export as standalone HTML/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(downloadMenu).toHaveCount(0);

  await page.getByRole('button', { name: /^Comment$/ }).click();
  await expect(page.getByTestId('board-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Comment$/ }).click();
  await expect(page.getByTestId('board-mode-toggle')).toHaveAttribute('aria-pressed', 'false');

  const zoomButton = page.locator('.viewer-toolbar-zoom .zoom-trigger');
  await expect(zoomButton).toHaveText('100%');
  await zoomButton.click();
  const zoomMenu = page.locator('.zoom-menu-popover[role="menu"]');
  await expect(zoomMenu).toBeVisible();
  await zoomMenu.getByRole('menuitem', { name: '150%' }).click();
  await expect(zoomButton).toHaveText('150%');
});

test('[P1] HTML preview toolbar exposes screenshot, comments, and mark workflows', async ({ page }) => {
  test.setTimeout(60_000);

  await page.addInitScript(() => {
    class TestClipboardItem {
      constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {}
    }
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async () => undefined,
        writeText: async () => undefined,
      },
    });
  });

  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Preview tools smoke');
  await seedHtmlArtifact(page, projectId, 'preview-tools.html', withSnapshotBridge(previewToolsHtml()));
  const conversationId = await latestConversationId(page, projectId);
  await page.goto(`/projects/${projectId}/conversations/${conversationId}/files/preview-tools.html`);
  await openDesignFile(page, 'preview-tools.html');

  await expect(artifactPreview(page)).toBeVisible();
  await expect(artifactPreviewFrame(page).getByRole('heading', { name: 'Original Hero' })).toBeVisible();

  await page.getByTestId('screenshot-copy-button').click();
  await expect(
    page.getByText(/Screenshot copied to clipboard|Browser blocked clipboard access|Could not capture the preview|Preview is still loading/),
  ).toBeVisible();

  await page.getByTestId('board-mode-toggle').click();
  await expect(page.getByTestId('board-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
  await artifactPreviewFrame(page).locator('[data-od-id="hero-title"]').click();
  await expect(page.getByTestId('comment-popover')).toBeVisible();
  await page.getByTestId('comment-popover-input').fill('Panel-level comment');
  await page.getByTestId('comment-popover').getByRole('button', { name: /^Comment$/ }).click();
  await expect(page.getByTestId('comment-saved-marker-hero-title')).toBeVisible();

  await expect(page.getByTestId('comment-side-panel')).toBeVisible();
  await expect(page.getByTestId('comment-side-panel')).toContainText('Panel-level comment');
  await expect(page.getByTestId('comment-panel-toggle')).toContainText('1');
  await page.getByTestId('comment-panel-toggle').click();
  await expect(page.getByTestId('chat-composer')).toBeVisible();

  await holdNextRunOpen(page);
  await sendPrompt(page, 'Keep the current preview run active');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

  await page.getByTestId('draw-overlay-toggle').click();
  await expect(page.getByTestId('draw-overlay-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Box select' })).toBeVisible();
  await page.getByPlaceholder('Add a note for this mark').fill('Mark this hero crop');
  await expect(page.getByRole('button', { name: 'Add to input' })).toBeEnabled();

  const previewBox = await artifactPreview(page).boundingBox();
  expect(previewBox).not.toBeNull();
  await page.mouse.move(previewBox!.x + 80, previewBox!.y + 80);
  await page.mouse.down();
  await page.mouse.move(previewBox!.x + 220, previewBox!.y + 170);
  await page.mouse.up();
  const queueButton = page.getByRole('button', { name: 'Queue' });
  await expect(queueButton).toBeEnabled();
  await queueButton.click();
  const queuedStrip = page.getByTestId('chat-queued-send-strip');
  await expect(queuedStrip).toBeVisible();
  await expect(queuedStrip).toContainText('Mark this hero crop');
  await expect(queuedStrip).toContainText('1 mark');
});

test('[P0] deck-shaped HTML keeps deck navigation available', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'HTML deck smoke');
  await seedDeckArtifact(page, projectId, 'html-deck.html', 'HTML Deck', ['Slide One', 'Slide Two']);
  await page.goto(`/projects/${projectId}/files/html-deck.html`);
  await openDesignFile(page, 'html-deck.html');

  const frame = artifactPreviewFrame(page);
  await expect(frame.getByText('Slide One')).toBeVisible();
  await page.getByLabel('Next slide').click();
  await expect(frame.getByText('Slide Two')).toBeVisible();
});


test('[P0] simple deck keeps the active slide stable across preview mode switches', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Simple deck navigation state');
  await seedDeckArtifact(page, projectId, 'simple-deck.html', 'Simple Deck', ['Slide One', 'Slide Two', 'Slide Three']);
  await page.goto(`/projects/${projectId}/files/simple-deck.html`);
  await openDesignFile(page, 'simple-deck.html');

  const frame = artifactPreviewFrame(page);
  const viewModeTabs = page.getByRole('tablist', { name: 'View mode' });

  await expect(frame.getByText('Slide One')).toBeVisible();
  await page.getByLabel('Next slide').click();
  await expect(frame.getByText('Slide Two')).toBeVisible();

  await viewModeTabs.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.viewer-source')).toContainText('Slide Three');
  await viewModeTabs.getByRole('tab', { name: 'Preview' }).click();

  await expect(frame.getByText('Slide Two')).toBeVisible();
  await page.getByLabel('Next slide').click();
  await expect(frame.getByText('Slide Three')).toBeVisible();
});

test('[P0] @critical HTML preview stays rendered after switching from Preview to Code and back', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'HTML preview toggle regression');
  await seedHtmlArtifact(
    page,
    projectId,
    'toggle-preview.html',
    '<!doctype html><html><body><main><h1>Toggle Preview Stable</h1><p>Still visible after tab switches.</p></main></body></html>',
  );
  await page.goto(`/projects/${projectId}`);
  await openDesignFile(page, 'toggle-preview.html');

  const previewFrame = artifactPreview(page);
  await expect(previewFrame).toBeVisible();
  await expect(
    artifactPreviewFrame(page).getByRole('heading', { name: 'Toggle Preview Stable' }),
  ).toBeVisible();

  const viewModeTabs = page.getByRole('tablist', { name: 'View mode' });
  await viewModeTabs.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.viewer-source')).toContainText('Toggle Preview Stable');

  await viewModeTabs.getByRole('tab', { name: 'Preview' }).click();
  await expect(previewFrame).toBeVisible();
  await expect(
    artifactPreviewFrame(page).getByRole('heading', { name: 'Toggle Preview Stable' }),
  ).toBeVisible();
  await expect(
    artifactPreviewFrame(page).getByText('Still visible after tab switches.'),
  ).toBeVisible();
});

async function routeMockAgents(page: Page) {
  await routeAgents(page, [
    {
      id: 'mock',
      name: 'Mock Agent',
      bin: 'mock-agent',
      available: true,
      version: 'test',
      models: [{ id: 'default', label: 'Default' }],
    },
  ]);
}

async function createEmptyProject(page: Page, name: string): Promise<string> {
  await gotoEntryHome(page);
  await openNewProjectModal(page);
  await page.getByTestId('new-project-name').fill(name);
  await page.getByTestId('create-project').click();
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//);
  const current = new URL(page.url());
  const [, projects, projectId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) throw new Error(`unexpected project route: ${current.pathname}`);
  return projectId;
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve Open Design' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function openNewProjectModal(page: Page) {
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-new-project').click();
  await expect(page.getByTestId('new-project-modal')).toBeVisible();
  await expect(page.getByTestId('new-project-panel')).toBeVisible();
}

async function seedHtmlArtifact(page: Page, projectId: string, fileName: string, content: string) {
  const resp = await page.request.post(
    `/api/projects/${projectId}/files`,
    {
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
    },
  );
  expect(resp.ok()).toBeTruthy();
}

async function latestConversationId(page: Page, projectId: string): Promise<string> {
  const response = await page.request.get(`/api/projects/${projectId}/conversations`, { timeout: 15_000 });
  expect(response.ok()).toBeTruthy();
  const { conversations } = (await response.json()) as {
    conversations: Array<{ id: string; updatedAt: number }>;
  };
  const latest = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!latest) throw new Error(`no conversations found for project ${projectId}`);
  return latest.id;
}

async function holdNextRunOpen(page: Page) {
  let runCount = 0;
  await page.route('**/api/runs', async (route) => {
    runCount += 1;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ runId: `preview-tools-run-${runCount}` }),
    });
  });
  await page.route('**/api/runs/*/events', async () => {
    await new Promise(() => undefined);
  });
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByTestId('chat-composer-input');
  const sendButton = page.getByTestId('chat-send');
  await expect(input).toBeVisible({ timeout: T.short });
  await input.click();
  await input.fill(prompt);
  await expect(input).toHaveText(prompt, { timeout: T.short });
  await expect(sendButton).toBeEnabled({ timeout: T.short });
  await Promise.all([
    page.waitForResponse(isCreateRunResponse, { timeout: 5_000 }),
    sendButton.evaluate((button: HTMLButtonElement) => button.click()),
  ]);
}

function isCreateRunResponse(resp: { url(): string; request(): { method(): string } }): boolean {
  const url = new URL(resp.url());
  return url.pathname === '/api/runs' && resp.request().method() === 'POST';
}

function withSnapshotBridge(html: string): string {
  const bridge = `
<script>
window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'od:snapshot') return;
  event.source?.postMessage({
    type: 'od:snapshot:result',
    id: data.id,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    w: 1,
    h: 1,
  }, '*');
});
</script>`;
  return html.replace('</body>', `${bridge}</body>`);
}

async function seedDeckArtifact(
  page: Page,
  projectId: string,
  fileName: string,
  title: string,
  slides: string[],
) {
  const slideHtml = slides
    .map((slide, index) => `<section class="slide" data-od-id="slide-${index + 1}"${index === 0 ? '' : ' hidden'}><h1>${slide}</h1></section>`)
    .join('\n');
  const resp = await page.request.post(
    `/api/projects/${projectId}/files`,
    {
      data: {
        name: fileName,
        content: `<!doctype html><html><body>${slideHtml}</body></html>`,
        artifactManifest: {
          version: 1,
          kind: 'deck',
          title,
          entry: fileName,
          renderer: 'deck-html',
          exports: ['html', 'pptx'],
        },
      },
      timeout: 15_000,
    },
  );
  expect(resp.ok()).toBeTruthy();
}

async function openDesignFile(page: Page, fileName: string) {
  const preview = artifactPreview(page);
  try {
    await preview.waitFor({ state: 'visible', timeout: 5_000 });
    return;
  } catch {
    // Not yet visible; try opening via tab or file list
  }

  const filePattern = new RegExp(fileName.replace(/\./g, '\\.'), 'i');
  const fileTabButton = page.getByRole('tab', { name: filePattern }).first();
  let tabFound = true;
  try {
    await fileTabButton.waitFor({ state: 'visible', timeout: 2_000 });
  } catch {
    tabFound = false;
  }

  if (tabFound) {
    await fileTabButton.click();
  } else {
    const fileButton = page.getByRole('button', { name: filePattern });
    await fileButton.click();
    await page.getByTestId('design-file-preview').getByRole('button', { name: 'Open' }).click();
  }
  await expect(preview).toBeVisible();
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading Open Design…').waitFor({ state: 'hidden', timeout: T.medium });
}

function previewToolsHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>HTML Preview</title>
    <style>
      .responsive-pair { display: flex; gap: 24px; }
      .responsive-pair > div { flex: 1 1 0; min-height: 40px; }
      @media (max-width: 700px) {
        .responsive-pair { flex-direction: column; }
      }
    </style>
  </head>
  <body style="font-family: Inter, system-ui, sans-serif; font-size: 16px; letter-spacing: 0.01em;">
    <main>
      <section data-od-id="responsive-pair" data-od-label="Responsive pair" class="responsive-pair">
        <div data-od-id="pair-a">Left panel</div>
        <div data-od-id="pair-b">Right panel</div>
      </section>
      <section data-od-id="hero" data-od-label="Hero section" style="display:flex;gap:8px;align-items:center;">
        <h1 data-od-id="hero-title" data-od-label="Hero title">Original Hero</h1>
        <a data-od-id="cta" data-od-label="Primary CTA" href="/start">Start now</a>
        <img data-od-id="hero-image" data-od-label="Hero image" src="/hero.png" alt="Hero" style="width:64px;height:64px;">
      </section>
    </main>
  </body>
</html>`;
}
