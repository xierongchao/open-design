import type { Component, Editor } from 'grapesjs';

/**
 * OD Resizable plugin for GrapesJS.
 *
 * GrapesJS ships resize handles off by default (`Component.resizable` is
 * `false`, grapes.mjs:27036); only image/svg/frame opt in. For a Figma-style
 * editor every selectable element should be resizable. We keep all 8 GrapesJS
 * handles, but turn `ratioDefault` on so corner handles preserve aspect ratio
 * by default while center-edge handles still resize one axis.
 */

const PLUGIN_KEY = 'od-resizable';

const RESIZABLE_OPTIONS = {
  ratioDefault: true,
  tl: true,
  tc: true,
  tr: true,
  cl: true,
  cr: true,
  bl: true,
  bc: true,
  br: true,
} as const;

function setResizable(comp: Component): void {
  try {
    const current = comp.get('resizable');
    if (
      current &&
      typeof current === 'object' &&
      (current as { ratioDefault?: unknown }).ratioDefault === true
    ) {
      return;
    }
    comp.set('resizable', RESIZABLE_OPTIONS);
  } catch {
    // ignore — some synthetic components reject the write.
  }
}

function walkAndSet(root: Component): void {
  setResizable(root);
  const stack: Component[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const children = node.components();
    for (let i = 0; i < children.length; i += 1) {
      const child = children.get(i) as Component;
      setResizable(child);
      stack.push(child);
    }
  }
}

export function odResizablePlugin(editor: Editor): void {
  // Tag every component created from now on (initial load + future additions
  // from a Blocks UI). Setting on create avoids a full-tree walk per click.
  editor.on('component:create', (comp: Component) => {
    setResizable(comp);
  });

  // After the initial load, backfill any component that was parsed before the
  // plugin's create handler ran (the wrapper + its initial children).
  editor.on('load', () => {
    const roots = editor.Components.getComponents();
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots.get(i) as Component | undefined;
      if (root) walkAndSet(root);
    }
  });

  editor.Commands?.add?.(`${PLUGIN_KEY}:refresh`, () => {
    const roots = editor.Components.getComponents();
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots.get(i) as Component | undefined;
      if (root) walkAndSet(root);
    }
  });
}

export default odResizablePlugin;

export const odResizablePluginKey = PLUGIN_KEY;
