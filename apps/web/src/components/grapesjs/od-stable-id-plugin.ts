import type { Component, Editor } from 'grapesjs';

/**
 * OD Stable ID plugin for GrapesJS.
 *
 * Mirrors the data-od-id / data-od-source-path / data-od-runtime-id
 * conventions used by the legacy manual-edit bridge
 * (see apps/web/src/edit-mode/bridge.ts). Components that the AI already
 * tagged with `data-od-id` keep that id; everything else gets a path-style
 * id derived from its position in the Component tree so AI follow-up
 * turns can still locate the element after the user reorders things in
 * the canvas.
 *
 * The generated id format `path-0-1-2` matches bridge.ts:domPath so the
 * existing findById / source-patch pipelines don't need to change.
 */

const HOST_BRIDGE_ATTRS = new Set([
  'data-od-sandbox-shim',
  'data-od-deck-bridge',
  'data-od-comment-bridge',
  'data-od-edit-bridge',
  'data-od-comment-bridge-style',
  'data-od-edit-bridge-style',
  'data-od-deck-fix',
]);

const PLUGIN_KEY = 'od-stable-id';

export interface OdStableIdPluginOptions {
  /** Skip host-injected bridge nodes when computing path indices. */
  skipHostNodes?: boolean;
}

/**
 * GrapesJS models every node — including text nodes — as a Component, and
 * during the initial `load` event some of those text components still have
 * an undefined attributes bag. Callers must null-check before reading.
 */
function readAttrs(comp: Component): Record<string, unknown> | null {
  if (!comp) return null;
  let attrs: Record<string, unknown> | undefined;
  try {
    attrs = comp.getAttributes() as Record<string, unknown> | undefined;
  } catch {
    return null;
  }
  return attrs ?? null;
}

function isHostBridgeComponent(comp: Component): boolean {
  const attrs = readAttrs(comp);
  if (!attrs) return false;
  for (const key of HOST_BRIDGE_ATTRS) {
    if (key in attrs) return true;
  }
  return false;
}

/**
 * Compute a stable path-style id by walking up the Component tree and
 * recording each ancestor's index among its non-host siblings. Returns
 * the empty string for the wrapper root so we don't tag the synthetic
 * top-level container.
 */
function computePathId(comp: Component, skipHost: boolean): string {
  const parts: number[] = [];
  let node: Component | undefined = comp;
  while (node) {
    const parent = node.parent();
    if (!parent) break;
    const allChildren = parent.components();
    const siblings: Component[] = [];
    for (let i = 0; i < allChildren.length; i += 1) {
      const child = allChildren.get(i);
      if (!child) continue;
      if (skipHost && isHostBridgeComponent(child)) continue;
      siblings.push(child);
    }
    const idx = siblings.indexOf(node);
    if (idx === -1) break;
    parts.unshift(idx);
    node = parent;
  }
  return parts.length ? `path-${parts.join('-')}` : '';
}

function readStableId(comp: Component): string | null {
  const attrs = readAttrs(comp);
  if (!attrs) return null;
  const explicit = attrs['data-od-id'];
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const sourcePath = attrs['data-od-source-path'];
  if (typeof sourcePath === 'string' && sourcePath.length > 0) return sourcePath;
  const runtime = attrs['data-od-runtime-id'];
  if (typeof runtime === 'string' && runtime.length > 0) return runtime;
  return null;
}

function assignStableId(comp: Component, id: string): void {
  if (!id) return;
  const attrs = readAttrs(comp);
  if (!attrs) return;
  if (attrs['data-od-id'] === id) return;
  try {
    comp.setAttributes({ ...attrs, 'data-od-id': id });
  } catch {
    // ignore — best-effort.
  }
}

function ensureStableId(comp: Component, skipHost: boolean): string | null {
  if (isHostBridgeComponent(comp)) return null;
  const existing = readStableId(comp);
  if (existing) return existing;
  const id = computePathId(comp, skipHost);
  if (!id) return null;
  assignStableId(comp, id);
  return id;
}

function walkComponents(root: Component, visit: (comp: Component) => void): void {
  visit(root);
  const stack: Component[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const children = node.components();
    for (let i = 0; i < children.length; i += 1) {
      const child = children.get(i) as Component;
      visit(child);
      stack.push(child);
    }
  }
}

function refreshAllIds(editor: Editor, skipHost: boolean): void {
  const wrapper = editor.Components.getComponents();
  for (let i = 0; i < wrapper.length; i += 1) {
    const root = wrapper.get(i) as Component;
    walkComponents(root, (c) => {
      // Only regenerate path-based ids; keep explicit data-od-id as-is.
      if (readStableId(c)) return;
      const id = computePathId(c, skipHost);
      if (id) assignStableId(c, id);
    });
  }
}

export function odStableIdPlugin(editor: Editor, options: OdStableIdPluginOptions = {}): void {
  const skipHost = options.skipHostNodes !== false;

  // Tag every component that lacks a stable id when it is created. This
  // fires for both initial load (after setComponents) and user-driven
  // additions from future Blocks UI.
  editor.on('component:create', (comp: Component) => {
    if (isHostBridgeComponent(comp)) return;
    if (readStableId(comp)) return;
    const id = computePathId(comp, skipHost);
    if (id) assignStableId(comp, id);
  });

  // After the initial load, re-derive path-based ids once so any AI-shipped
  // components that already had explicit data-od-id stay intact while the
  // rest get deterministic path ids consistent with the bridge's scheme.
  editor.on('load', () => {
    refreshAllIds(editor, skipHost);
  });

  // When components move (reorder/drag), their path-based ids may go stale.
  // Re-derive them but leave explicit data-od-id untouched.
  editor.on('component:move', (comp: Component) => {
    if (isHostBridgeComponent(comp)) return;
    // Re-walk from the moved subtree outward — the moved component and
    // everything below it need fresh path ids.
    walkComponents(comp, (c) => {
      const attrs = readAttrs(c);
      const existing = attrs?.['data-od-id'];
      if (existing && !String(existing).startsWith('path-')) {
        return;
      }
      const id = computePathId(c, skipHost);
      if (id) assignStableId(c, id);
    });
  });

  // Expose a small command surface for tests / future bridges.
  editor.Commands?.add?.(`${PLUGIN_KEY}:refresh`, () => {
    refreshAllIds(editor, skipHost);
  });
}

export default odStableIdPlugin;

export const odStableIdPluginKey = PLUGIN_KEY;
export const odStableIdHostBridgeAttrs = Array.from(HOST_BRIDGE_ATTRS);
