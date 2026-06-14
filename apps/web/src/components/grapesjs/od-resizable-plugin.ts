import type { Component, Editor } from 'grapesjs';

/**
 * OD Resizable plugin for GrapesJS.
 *
 * GrapesJS ships resize handles off by default (`Component.resizable` is
 * `false`, grapes.mjs:27036); only image/svg/frame opt in. For a Figma-style
 * editor every selectable element should be resizable, so this plugin flips
 * `resizable: true` on every component. The Resizer itself already defaults
 * to all 8 handles (tl/tc/tr/cl/cr/bl/bc/br), so `true` is enough — no need
 * to spell out the handle map.
 *
 * `true` (vs an object) is intentional: `CommandSelectComponent.initResize`
 * treats a truthy non-object `resizable` as "use the resizer defaults"
 * (grapes.mjs:49619), which is exactly the 8-handle layout we want.
 */

const PLUGIN_KEY = 'od-resizable';

function setResizable(comp: Component): void {
  try {
    if (comp.get('resizable')) return;
    comp.set('resizable', true);
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
