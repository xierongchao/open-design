import { chromium } from '@playwright/test';

const CHROMIUM_PATH = '/Users/xierongchao/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell';

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:55574', { waitUntil: 'load', timeout: 30_000 });

  // Fetch the CSS file directly and search for the grid rule
  const cssUrl = 'http://127.0.0.1:55574/_next/static/chunks/apps_web_src_0d4d_.h._.css';
  const cssText = await page.evaluate(async (url: string) => {
    const resp = await fetch(url);
    return await resp.text();
  }, cssUrl);

  // Search for "pp-dock-active" with grid or display
  const idx1 = cssText.indexOf('.manual-edit-workspace.pp-dock-active');
  console.log('pp-dock-active grid rule at index:', idx1);
  if (idx1 >= 0) {
    console.log('Context:', cssText.substring(idx1, idx1 + 500));
  }

  // Search for display: grid in properties-panel context
  const gridIdx = cssText.indexOf('display: grid');
  const allGridIndices: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = cssText.indexOf('display: grid', searchFrom);
    if (idx === -1) break;
    allGridIndices.push(idx);
    searchFrom = idx + 1;
  }
  console.log('\ndisplay: grid occurrences:', allGridIndices.length);
  for (const idx of allGridIndices.slice(0, 10)) {
    const ctx = cssText.substring(Math.max(0, idx - 200), idx + 100);
    // Extract the selector (look backwards for the nearest closing brace + selector)
    const prevBrace = ctx.lastIndexOf('}');
    const selector = ctx.substring(prevBrace + 1).trim().split('{')[0]?.trim();
    console.log(`  At ${idx}: selector="${selector}"`);
  }

  // Also search for "pp-dock-active" specifically  
  const ppDockActiveIdx = cssText.indexOf('pp-dock-active');
  console.log('\npp-dock-active first occurrence:', ppDockActiveIdx);
  if (ppDockActiveIdx >= 0) {
    const ctx = cssText.substring(Math.max(0, ppDockActiveIdx - 100), ppDockActiveIdx + 500);
    console.log('Context around pp-dock-active:', ctx);
  }

  await browser.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
