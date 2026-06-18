import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const designFilesCss = readFileSync(
  new URL('../../src/styles/workspace/design-files.css', import.meta.url),
  'utf8',
);
const routinesCss = readFileSync(
  new URL('../../src/styles/viewer/routines.css', import.meta.url),
  'utf8',
);

function cssDeclarations(css: string, selector: string): string {
  const blocks: string[] = [];
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  if (blocks.length === 0) throw new Error(`Missing CSS block for ${selector}`);
  return blocks.join('\n');
}

function ruleValue(block: string, property: string): string {
  const matches = [...block.matchAll(new RegExp(`(?:^|[;\\n])\\s*${property}:\\s*([^;]+);`, 'g'))];
  const match = matches.at(-1);
  if (!match) throw new Error(`Missing CSS property ${property}`);
  return match[1]!.trim();
}

describe('Design Files preview list styles', () => {
  it('keeps rows readable without a side preview column', () => {
    const panel = cssDeclarations(designFilesCss, '.df-panel');
    const nameCell = cssDeclarations(designFilesCss, '.df-cell-name');
    const rowSub = cssDeclarations(designFilesCss, '.df-row-sub');
    const rowSubPart = cssDeclarations(designFilesCss, '.df-row-sub > span');

    expect(ruleValue(panel, 'grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(ruleValue(nameCell, 'max-width')).toBe('0');
    expect(ruleValue(rowSub, 'flex-wrap')).toBe('nowrap');
    expect(ruleValue(rowSub, 'overflow')).toBe('hidden');
    expect(ruleValue(rowSubPart, 'text-overflow')).toBe('ellipsis');
  });

  it('keeps the file list toolbar on a single row in the management rail', () => {
    const main = cssDeclarations(designFilesCss, '.df-main');
    const topbar = cssDeclarations(designFilesCss, '.df-topbar');
    const actions = cssDeclarations(designFilesCss, '.df-actions');
    const topbarLeft = cssDeclarations(designFilesCss, '.df-topbar-left');

    expect(ruleValue(main, 'border-right')).toBe('none');
    expect(ruleValue(topbar, 'flex-wrap')).toBe('nowrap');
    expect(ruleValue(actions, 'flex-wrap')).toBe('nowrap');
    expect(ruleValue(actions, 'flex-shrink')).toBe('0');
    expect(ruleValue(topbarLeft, 'min-width')).toBe('0');
  });

  it('collapses toolbar actions to icons-only on a narrow list column', () => {
    const main = cssDeclarations(designFilesCss, '.df-main');
    // The list column is its own query container so the toolbar reacts to
    // the column width (chat/preview split), not the viewport.
    expect(ruleValue(main, 'container-type')).toBe('inline-size');
    // Below the labelled-actions wrap threshold the button text is hidden
    // (icons remain) so the toolbar stays on one row instead of wrapping
    // the actions below the breadcrumb.
    expect(designFilesCss).toMatch(
      /@container[^{]*max-width:\s*620px[^{]*\{[\s\S]*?\.df-actions button\s*>\s*span\s*\{\s*display:\s*none/,
    );
  });

  it('keeps the file tree resize handle and content pane on one row when narrow', () => {
    const treePane = cssDeclarations(designFilesCss, '.df-tree-pane');
    const resizeHandle = cssDeclarations(designFilesCss, '.df-tree-resize-handle');
    const contentPane = cssDeclarations(designFilesCss, '.df-content-pane');

    expect(ruleValue(treePane, 'grid-column')).toBe('1');
    expect(ruleValue(resizeHandle, 'grid-column')).toBe('2');
    expect(ruleValue(contentPane, 'grid-column')).toBe('3');
    expect(designFilesCss).toMatch(
      /@container[^{]*max-width:\s*620px[^{]*\{[\s\S]*?\.df-browser\s*\{\s*grid-template-columns:\s*minmax\(0,\s*var\(--df-tree-pane-width,\s*280px\)\)\s+5px\s+minmax\(0,\s*1fr\);/,
    );
    expect(designFilesCss).not.toContain('grid-template-columns: minmax(170px, 42%) minmax(0, 1fr);');
  });

  it('lets the project split follow the resizable project panel tracks', () => {
    const split = cssDeclarations(routinesCss, '.app .split:not(.split-focus)');

    const cols = ruleValue(split, 'grid-template-columns');
    expect(cols).toContain('var(--project-workspace-panel-track, minmax(0, 1fr))');
    expect(cols).toContain('var(--project-chat-panel-width, 760px)');
  });

  it('lets the project side chat fill the resized panel width', () => {
    const splitChatSlot = cssDeclarations(routinesCss, '.app .split-chat-slot');
    const splitPane = cssDeclarations(routinesCss, '.app .split-chat-slot > .pane');
    const sidePanel = cssDeclarations(routinesCss, '.app .workspace-side-panel-shell');
    const chatLogWrap = cssDeclarations(routinesCss, '.app .chat-log-wrap');
    const composerSlot = cssDeclarations(routinesCss, '.app .chat-composer-slot');

    expect(ruleValue(splitChatSlot, 'justify-content')).toBe('stretch');
    expect(ruleValue(splitPane, 'width')).toBe('100%');
    expect(ruleValue(splitPane, 'max-width')).toBe('none');
    expect(ruleValue(sidePanel, 'width')).toBe('100%');
    expect(ruleValue(sidePanel, 'min-width')).toBe('0');
    expect(ruleValue(chatLogWrap, 'width')).toBe('100%');
    expect(ruleValue(chatLogWrap, 'max-width')).toBe('none');
    expect(ruleValue(composerSlot, 'width')).toBe('100%');
    expect(ruleValue(composerSlot, 'max-width')).toBe('none');
  });

  it('opens the working directory menu below the top chrome instead of behind it', () => {
    const menu = cssDeclarations(routinesCss, '.app .working-dir-pill-menu');

    expect(ruleValue(menu, 'top')).toBe('calc(100% + 6px)');
    expect(ruleValue(menu, 'right')).toBe('0');
    expect(ruleValue(menu, 'z-index')).toBe('220');
  });

  it('flips the working directory menu upward when hosted in the composer toolbar', () => {
    // The pill now lives in the composer's bottom toolbar, so the base
    // "open downward" rule would drop the menu off the bottom of the viewport.
    // The composer-row override anchors it above the trigger and left-aligned.
    const override = cssDeclarations(routinesCss, '.app .composer-row .working-dir-pill-menu');

    expect(ruleValue(override, 'bottom')).toBe('calc(100% + 6px)');
    expect(ruleValue(override, 'top')).toBe('auto');
    expect(ruleValue(override, 'left')).toBe('0');
    expect(ruleValue(override, 'right')).toBe('auto');
  });
});
