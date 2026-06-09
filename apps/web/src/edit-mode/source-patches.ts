import { emptyManualEditStyles, MANUAL_EDIT_STYLE_PROPS, type ManualEditFields, type ManualEditPatch, type ManualEditRect, type ManualEditStyles } from './types';

export interface ManualEditPatchResult {
  ok: boolean;
  source: string;
  error?: string;
}

export function applyManualEditPatch(source: string, patch: ManualEditPatch): ManualEditPatchResult {
  if (patch.kind === 'set-full-source') return { ok: true, source: patch.source };

  const doc = parseSource(source);
  if (!doc) return { ok: false, source, error: 'Could not parse source.' };

  if (patch.kind === 'set-token') {
    const changed = setCssToken(doc, patch.token, patch.value);
    return changed
      ? { ok: true, source: serializeSource(doc, source) }
      : { ok: false, source, error: `Token not found: ${patch.token}` };
  }

  if (patch.kind === 'set-style-batch') {
    for (const item of patch.items) {
      const target = findEditableElement(doc, item.id);
      if (!target) return { ok: false, source, error: `Target not found: ${item.id}` };
      setInlineStyles(target as HTMLElement, item.styles);
    }
    return { ok: true, source: serializeSource(doc, source) };
  }

  if (patch.kind === 'align-elements') {
    const aligned = alignEditableElements(doc, patch);
    return aligned.ok
      ? { ok: true, source: serializeSource(doc, source) }
      : { ok: false, source, error: aligned.error };
  }

  const el = findEditableElement(doc, patch.id);
  if (!el) return { ok: false, source, error: `Target not found: ${patch.id}` };

  if (patch.kind === 'set-text') {
    if (hasElementChildren(el)) {
      return { ok: false, source, error: 'This element contains nested markup. Use the HTML tab instead.' };
    }
    el.textContent = patch.value;
  } else if (patch.kind === 'set-link') {
    if (hasElementChildren(el)) {
      const currentText = el.textContent?.trim() ?? '';
      if (patch.text.trim() !== currentText) {
        return { ok: false, source, error: 'This link contains nested markup. Use the HTML tab to change its label.' };
      }
    } else {
      el.textContent = patch.text;
    }
    el.setAttribute('href', patch.href);
  } else if (patch.kind === 'set-image') {
    el.setAttribute('src', patch.src);
    el.setAttribute('alt', patch.alt);
  } else if (patch.kind === 'set-style') {
    setInlineStyles(el as HTMLElement, patch.styles);
  } else if (patch.kind === 'set-attributes') {
    setAttributes(el, patch.attributes);
  } else if (patch.kind === 'set-outer-html') {
    const replaced = replaceOuterHtml(doc, el, patch.html);
    if (!replaced.ok) {
      return {
        ok: false,
        source,
        error: 'error' in replaced ? replaced.error : 'Could not replace element HTML.',
      };
    }
  } else if (patch.kind === 'move-element') {
    const moved = moveEditableElement(doc, el, patch.targetId, patch.position);
    if (!moved.ok) return { ok: false, source, error: moved.error };
  } else if (patch.kind === 'remove-element') {
    if (!el.parentElement) {
      return { ok: false, source, error: 'Cannot remove the root element.' };
    }
    if (el.parentElement === doc.body && doc.body.children.length === 1) {
      return { ok: false, source, error: 'Cannot remove the last element in the document.' };
    }
    el.remove();
  }

  return { ok: true, source: serializeSource(doc, source) };
}

export function readManualEditFields(source: string, id: string): ManualEditFields {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const kind = inferKind(el);
  if (kind === 'link') {
    return {
      text: el.textContent?.trim() ?? '',
      href: el.getAttribute('href') ?? '',
    };
  }
  if (kind === 'image') {
    return {
      src: el.getAttribute('src') ?? '',
      alt: el.getAttribute('alt') ?? '',
    };
  }
  return { text: el.textContent?.trim() ?? '' };
}

export function readManualEditStyles(source: string, id: string): ManualEditStyles {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return emptyManualEditStyles();
  const style = (el as HTMLElement).style;
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = (style[key as unknown as keyof CSSStyleDeclaration] as string | undefined) ?? '';
    return acc;
  }, {} as ManualEditStyles);
}

export function readManualEditAttributes(source: string, id: string): Record<string, string> {
  const doc = parseSource(source);
  const el = doc ? findEditableElement(doc, id) : null;
  if (!el) return {};
  const attrs: Record<string, string> = {};
  Array.from(el.attributes).forEach((attr) => {
    if (attr.name === 'data-od-runtime-id') return;
    attrs[attr.name] = attr.value;
  });
  return attrs;
}

export function readManualEditOuterHtml(source: string, id: string): string {
  const doc = parseSource(source);
  return (doc ? findEditableElement(doc, id)?.outerHTML : '') ?? '';
}

function parseSource(source: string): Document | null {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(source, 'text/html');
  }
  if (typeof document !== 'undefined') {
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = source;
    return doc;
  }
  return null;
}

function serializeSource(doc: Document, originalSource: string): string {
  if (!isManualEditFullHtmlDocument(originalSource)) return doc.body.innerHTML;
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function isManualEditFullHtmlDocument(source: string): boolean {
  const normalized = firstSourceToken(source).slice(0, 32).toLowerCase();
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html');
}

function firstSourceToken(source: string): string {
  let rest = source.trimStart();
  while (rest.startsWith('<!--') || rest.startsWith('<?')) {
    const close = rest.startsWith('<!--') ? '-->' : '?>';
    const end = rest.indexOf(close);
    if (end === -1) return rest;
    rest = rest.slice(end + close.length).trimStart();
  }
  return rest;
}

function inferKind(el: Element): 'text' | 'link' | 'image' | 'container' {
  const explicit = el.getAttribute('data-od-edit');
  if (explicit === 'text' || explicit === 'link' || explicit === 'image' || explicit === 'container') return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'img') return 'image';
  if (['section', 'main', 'nav', 'div', 'article', 'header', 'footer'].includes(tag)) return 'container';
  return 'text';
}

function findEditableElement(doc: Document, id: string): Element | null {
  if (id === '__body__') return doc.body;
  return (
    doc.querySelector(`[data-od-id="${cssEscape(id)}"]`) ??
    doc.querySelector(`[data-od-runtime-id="${cssEscape(id)}"]`) ??
    doc.querySelector(`[data-od-source-path="${cssEscape(id)}"]`) ??
    findElementByPath(doc, id)
  );
}

function findElementByPath(doc: Document, id: string): Element | null {
  if (!id.startsWith('path-')) return null;
  const indexes = id
    .slice('path-'.length)
    .split('-')
    .map((part) => Number(part));
  if (indexes.some((index) => !Number.isInteger(index) || index < 0)) return null;
  let current: Element | null = doc.body;
  for (const index of indexes) {
    current = current?.children.item(index) ?? null;
    if (!current) return null;
  }
  return current;
}

function hasElementChildren(el: Element): boolean {
  return Array.from(el.children).some((child) => child.nodeType === 1);
}

function setInlineStyles(el: HTMLElement, styles: Partial<ManualEditStyles>): void {
  for (const [name, value] of Object.entries(styles)) {
    const cssName = camelToKebab(name);
    if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
    else el.style.setProperty(cssName, value.trim());
  }
}

function setAttributes(el: Element, attributes: Record<string, string>): void {
  const protectedAttrs = new Set(['data-od-id', 'data-od-edit', 'data-od-label', 'data-od-runtime-id']);
  for (const [name, value] of Object.entries(attributes)) {
    if (!isSafeAttributeName(name) || protectedAttrs.has(name)) continue;
    if (value.trim() === '') el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
}

function replaceOuterHtml(doc: Document, el: Element, html: string): { ok: true } | { ok: false; error: string } {
  const template = doc.createElement('template');
  template.innerHTML = html.trim();
  const elements = Array.from(template.content.children);
  if (elements.length !== 1) return { ok: false, error: 'Replacement HTML must contain exactly one root element.' };
  const next = elements[0]!;
  if (el.getAttribute('data-od-id') && !next.getAttribute('data-od-id')) {
    next.setAttribute('data-od-id', el.getAttribute('data-od-id') ?? '');
  }
  if (el.getAttribute('data-od-edit') && !next.getAttribute('data-od-edit')) {
    next.setAttribute('data-od-edit', el.getAttribute('data-od-edit') ?? '');
  }
  el.replaceWith(next);
  return { ok: true };
}

function moveEditableElement(
  doc: Document,
  el: Element,
  targetId: string,
  position: Extract<ManualEditPatch, { kind: 'move-element' }>['position'],
): { ok: true } | { ok: false; error: string } {
  if (!el.parentElement) return { ok: false, error: 'Cannot move the root element.' };
  const target = findEditableElement(doc, targetId);
  if (!target) return { ok: false, error: `Target not found: ${targetId}` };
  if (target === el) return { ok: false, error: 'Cannot move an element onto itself.' };
  if (el.contains(target)) return { ok: false, error: 'Cannot move an element into its own descendant.' };

  if (position === 'inside-start') {
    target.insertBefore(el, target.firstChild);
    return { ok: true };
  }
  if (position === 'inside-end') {
    target.appendChild(el);
    return { ok: true };
  }

  const targetParent = target.parentElement;
  if (!targetParent) return { ok: false, error: 'Cannot move relative to the root element.' };
  if (position === 'before') {
    targetParent.insertBefore(el, target);
    return { ok: true };
  }
  targetParent.insertBefore(el, target.nextSibling);
  return { ok: true };
}

function alignEditableElements(
  doc: Document,
  patch: Extract<ManualEditPatch, { kind: 'align-elements' }>,
): { ok: true } | { ok: false; error: string } {
  const items = patch.ids.map((id) => ({
    id,
    el: findEditableElement(doc, id) as HTMLElement | null,
    rect: patch.rects[id],
  }));
  const missingElement = items.find((item) => !item.el);
  if (missingElement) return { ok: false, error: `Target not found: ${missingElement.id}` };
  const missingRect = items.find((item) => !item.rect);
  if (missingRect) return { ok: false, error: `Target rect not found: ${missingRect.id}` };
  if (items.length < 2) return { ok: true };

  const rects = items.map((item) => item.rect as ManualEditRect);
  const bounds = selectionBounds(rects);

  if (patch.mode === 'distribute-x') {
    distributeAlongAxis(items as Array<{ id: string; el: HTMLElement; rect: ManualEditRect }>, 'x', bounds);
    return { ok: true };
  }
  if (patch.mode === 'distribute-y') {
    distributeAlongAxis(items as Array<{ id: string; el: HTMLElement; rect: ManualEditRect }>, 'y', bounds);
    return { ok: true };
  }

  for (const item of items) {
    const el = item.el as HTMLElement;
    const rect = item.rect as ManualEditRect;
    if (patch.mode === 'left') setAbsolutePosition(el, 'left', bounds.left);
    else if (patch.mode === 'center-x') setAbsolutePosition(el, 'left', bounds.centerX - rect.width / 2);
    else if (patch.mode === 'right') setAbsolutePosition(el, 'left', bounds.right - rect.width);
    else if (patch.mode === 'top') setAbsolutePosition(el, 'top', bounds.top);
    else if (patch.mode === 'center-y') setAbsolutePosition(el, 'top', bounds.centerY - rect.height / 2);
    else if (patch.mode === 'bottom') setAbsolutePosition(el, 'top', bounds.bottom - rect.height);
  }
  return { ok: true };
}

function selectionBounds(rects: ManualEditRect[]) {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
  };
}

function distributeAlongAxis(
  items: Array<{ el: HTMLElement; rect: ManualEditRect }>,
  axis: 'x' | 'y',
  bounds: ReturnType<typeof selectionBounds>,
): void {
  if (items.length < 3) return;
  const sorted = [...items].sort((a, b) => (
    axis === 'x' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y
  ));
  const totalSize = sorted.reduce((sum, item) => sum + (axis === 'x' ? item.rect.width : item.rect.height), 0);
  const span = axis === 'x' ? bounds.right - bounds.left : bounds.bottom - bounds.top;
  const gap = (span - totalSize) / (sorted.length - 1);
  let cursor = axis === 'x' ? bounds.left : bounds.top;
  for (const item of sorted) {
    setAbsolutePosition(item.el, axis === 'x' ? 'left' : 'top', cursor);
    cursor += (axis === 'x' ? item.rect.width : item.rect.height) + gap;
  }
}

function setAbsolutePosition(el: HTMLElement, prop: 'left' | 'top', value: number): void {
  if (!el.style.position || el.style.position === 'static') el.style.position = 'absolute';
  el.style.setProperty(prop, `${Math.round(value)}px`);
}

function setCssToken(doc: Document, token: string, value: string): boolean {
  const styles = Array.from(doc.querySelectorAll('style'));
  const pattern = new RegExp(`(${escapeRegExp(token)}\\s*:\\s*)([^;]+)(;)`);
  for (const style of styles) {
    const text = style.textContent ?? '';
    if (!pattern.test(text)) continue;
    style.textContent = text.replace(pattern, `$1${value}$3`);
    return true;
  }
  return false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function isSafeAttributeName(value: string): boolean {
  return /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(value);
}
