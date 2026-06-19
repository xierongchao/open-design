import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const coreCss = readFileSync(new URL('../../src/styles/viewer/core.css', import.meta.url), 'utf8');

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(coreCss);
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[1] ?? '';
}

describe('GrapesJS icon library styles', () => {
  it('uses a larger responsive panel with ten icon columns on desktop screens', () => {
    const panel = cssBlock('.grapesjs-icon-library-panel');
    const grid = cssBlock('.grapesjs-icon-library-grid');

    expect(panel).toContain('width: min(1040px, calc(100vw - 48px));');
    expect(panel).toContain('height: min(720px, calc(100vh - 112px));');
    expect(grid).toContain('grid-template-columns: repeat(10, minmax(0, 1fr));');
  });

  it('keeps sparse search results packed at the top of the fixed-height grid', () => {
    const grid = cssBlock('.grapesjs-icon-library-grid');

    expect(grid).toContain('align-content: start;');
    expect(grid).toContain('grid-auto-rows: max-content;');
  });

  it('keeps the shortcut help panel free of close affordance and scrollbars', () => {
    const panel = cssBlock('.grapesjs-shortcut-help-panel');
    const tabs = cssBlock('.grapesjs-shortcut-help-tabs');

    expect(coreCss).not.toContain('.grapesjs-shortcut-help-close');
    expect(panel).toContain('overflow: visible;');
    expect(tabs).toContain('flex-wrap: wrap;');
    expect(tabs).not.toContain('overflow-x: auto;');
  });
});
