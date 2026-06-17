export interface ParsedDocument {
  doctype: string;
  htmlOpen: string;
  head: string;
  bodyOpen: string;
  bodyInner: string;
  bodyClose: string;
  htmlClose: string;
}

export interface CanvasStylesheetLink {
  href: string;
  media?: string;
}

export interface CanvasHeadAssets {
  inlineCss: string;
  stylesheetLinks: CanvasStylesheetLink[];
}

export interface CanvasUrlEnvironment {
  origin: string;
  protocol: string;
}

const DEFAULT_DOCTYPE = '<!doctype html>';

export function parseHtmlDocument(source: string): ParsedDocument {
  // Extract doctype, html tag, head block, body tag, body inner HTML.
  // We keep this tolerant because AI-generated HTML is usually well-formed,
  // but the editor should not crash on partial fragments.
  const doctypeMatch = source.match(/<!doctype[^>]*>/i);
  const doctype = doctypeMatch ? doctypeMatch[0] : DEFAULT_DOCTYPE;

  const htmlOpenMatch = source.match(/<html\b[^>]*>/i);
  const htmlOpen = htmlOpenMatch ? htmlOpenMatch[0] : '<html>';

  const headMatch = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch ? headMatch[0] : '';

  const bodyMatch = source.match(/<body\b[^>]*>/i);
  const bodyOpen = bodyMatch ? bodyMatch[0] : '<body>';

  const bodyInnerMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyInner = bodyInnerMatch?.[1] ?? '';

  const htmlCloseMatch = source.match(/<\/html>\s*$/i);
  const htmlClose = htmlCloseMatch ? htmlCloseMatch[0] : '</html>';

  return {
    doctype,
    htmlOpen,
    head,
    bodyOpen,
    bodyInner,
    bodyClose: '</body>',
    htmlClose,
  };
}

export function reassembleDocument(
  parsed: ParsedDocument,
  bodyHtml: string,
  css: string,
  bodyStyle?: Record<string, string>,
): string {
  const styleBlock = css.trim() ? `<style>\n${css}\n</style>\n` : '';
  const head = parsed.head
    ? parsed.head.replace(/<\/head>\s*$/i, `${styleBlock}</head>`)
    : `<head>\n${styleBlock}</head>`;
  // Rebuild the <body> open tag so canvas-level styles (background colour,
  // padding, etc. set on the wrapper component via setCanvasStyles) round-trip
  // into the saved file. Without this, reassembleDocument would reuse the
  // original bodyOpen (which has no inline style) and drop the body background
  // colour the user just set — the "画板背景色没保存" bug.
  const bodyOpen = bodyStyle && Object.keys(bodyStyle).length > 0
    ? rebuildBodyOpenTag(parsed.bodyOpen, bodyStyle)
    : parsed.bodyOpen;
  return [
    parsed.doctype,
    parsed.htmlOpen,
    head,
    bodyOpen,
    bodyHtml,
    parsed.bodyClose,
    parsed.htmlClose,
  ].join('\n');
}

export function readCanvasBodyStyleOverrides(parsed: ParsedDocument | null): Record<string, string> {
  if (!parsed) return {};
  const styles: Record<string, string> = {};
  for (const css of styleBlocksFromHead(parsed.head)) {
    for (const { selector, declarations } of cssRules(css)) {
      if (!selectorTargetsBody(selector)) continue;
      Object.assign(styles, canvasBodyStylesFromDeclarations(declarations));
    }
  }
  const bodyStyle = parseTagAttributes(parsed.bodyOpen).style;
  if (bodyStyle) Object.assign(styles, canvasBodyStylesFromDeclarations(bodyStyle));
  return styles;
}

/**
 * Rebuild a `<body ...>` open tag, preserving existing attributes (class, id,
 * data-*) and merging the given inline styles on top of any existing style
 * attribute. Styles are serialised as `prop:value;` pairs with kebab-case keys
 * (the GrapesJS wrapper stores them camelCase, so we convert).
 */
function rebuildBodyOpenTag(bodyOpen: string, bodyStyle: Record<string, string>): string {
  const existingAttrs = parseTagAttributes(bodyOpen);
  const stylePairs = Object.entries(bodyStyle)
    .map(([prop, value]) => `${toKebab(prop)}:${value}`)
    .join(';');
  const mergedAttrs = { ...existingAttrs, style: stylePairs };
  const attrs = Object.entries(mergedAttrs)
    .map(([k, v]) => (v == null ? k : `${k}="${escapeAttr(String(v))}"`))
    .join(' ');
  return `<body ${attrs}>`.replace('<body  ', '<body ');
}

function parseTagAttributes(tag: string): Record<string, string | null> {
  const attrs: Record<string, string | null> = {};
  const inner = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  const regex = /([^\s=]+)\s*=\s*(['"])([\s\S]*?)\2|([^\s=]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(inner)) !== null) {
    if (match[1]) attrs[match[1].toLowerCase()] = match[3] ?? '';
    else if (match[4]) attrs[match[4].toLowerCase()] = null;
  }
  return attrs;
}

function styleBlocksFromHead(head: string): string[] {
  return Array.from(head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1] ?? '')
    .filter(Boolean);
}

function cssRules(css: string): Array<{ selector: string; declarations: string }> {
  const rules: Array<{ selector: string; declarations: string }> = [];
  const regex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(css)) !== null) {
    rules.push({ selector: match[1]?.trim() ?? '', declarations: match[2] ?? '' });
  }
  return rules;
}

function selectorTargetsBody(selectorText: string): boolean {
  return selectorText
    .split(',')
    .map((selector) => selector.trim())
    .some((selector) => /(^|[\s>+~])body(?=$|[\s.#:[>+~])/i.test(selector));
}

function canvasBodyStylesFromDeclarations(declarations: string): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const declaration of declarations.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const prop = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!value) continue;
    if (prop === 'background-color') styles.backgroundColor = value;
    else if (prop === 'font-family') styles.fontFamily = value;
    else if (prop === 'font-size') styles.fontSize = value;
    else if (prop === 'color') styles.color = value;
  }
  return styles;
}

function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}

export function areDocumentsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  // Whitespace-only differences inside <head>/<body> should not reload the
  // canvas. Compare a stripped version.
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

export function extractCanvasHeadAssets(head: string): CanvasHeadAssets {
  const inlineCss = Array.from(head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');

  const stylesheetLinks: CanvasStylesheetLink[] = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0] ?? '';
    const rel = readHtmlAttr(tag, 'rel');
    const href = readHtmlAttr(tag, 'href');
    if (!rel || !href || !/\bstylesheet\b/i.test(rel)) continue;
    const media = readHtmlAttr(tag, 'media') ?? undefined;
    stylesheetLinks.push(media ? { href, media } : { href });
  }

  return { inlineCss, stylesheetLinks };
}

export function resolveCanvasAssetUrl(
  assetUrl: string,
  baseHref?: string,
  env: CanvasUrlEnvironment | null = getBrowserUrlEnvironment(),
): string {
  const trimmed = assetUrl.trim();
  if (!trimmed) return trimmed;
  if (/^(?:https?:|data:|blob:|mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return env ? `${env.protocol}${trimmed}` : trimmed;
  if (/^\//.test(trimmed)) return trimmed;
  if (!baseHref || !env) return trimmed;

  try {
    return new URL(trimmed, new URL(baseHref, env.origin)).toString();
  } catch {
    return trimmed;
  }
}

export function applyCanvasHeadAssets(
  doc: Document | null,
  parsed: ParsedDocument | null,
  baseHref?: string,
  env: CanvasUrlEnvironment | null = getBrowserUrlEnvironment(),
): void {
  if (!doc || !parsed) return;
  const head = doc.head ?? doc.getElementsByTagName('head')[0];
  if (!head) return;

  head.querySelectorAll('[data-od-grapesjs-head-asset]').forEach((node) => node.remove());

  const resolvedBase = baseHref ? resolveCanvasBaseHref(baseHref, env) : null;
  if (resolvedBase) {
    let base = head.querySelector<HTMLBaseElement>('base[data-od-grapesjs-base]');
    if (!base) {
      base = doc.createElement('base');
      base.setAttribute('data-od-grapesjs-base', 'true');
      head.insertBefore(base, head.firstChild);
    }
    base.setAttribute('href', resolvedBase);
  }

  const assets = extractCanvasHeadAssets(parsed.head);
  for (const linkAsset of assets.stylesheetLinks) {
    const link = doc.createElement('link');
    link.setAttribute('data-od-grapesjs-head-asset', 'stylesheet');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', resolveCanvasAssetUrl(linkAsset.href, baseHref, env));
    if (linkAsset.media) link.setAttribute('media', linkAsset.media);
    head.appendChild(link);
  }

  if (assets.inlineCss) {
    const style = doc.createElement('style');
    style.setAttribute('data-od-grapesjs-head-asset', 'style');
    style.textContent = assets.inlineCss;
    head.appendChild(style);
  }
}

function resolveCanvasBaseHref(
  baseHref: string,
  env: CanvasUrlEnvironment | null,
): string | null {
  const trimmed = baseHref.trim();
  if (!trimmed) return null;
  if (/^https?:/i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return env ? `${env.protocol}${trimmed}` : trimmed;
  if (/^\//.test(trimmed)) return env ? new URL(trimmed, env.origin).toString() : trimmed;
  if (!env) return trimmed;
  try {
    return new URL(trimmed, env.origin).toString();
  } catch {
    return trimmed;
  }
}

function getBrowserUrlEnvironment(): CanvasUrlEnvironment | null {
  if (typeof window === 'undefined') return null;
  return {
    origin: window.location.origin,
    protocol: window.location.protocol,
  };
}

function readHtmlAttr(tag: string, name: string): string | null {
  const quoted = tag.match(new RegExp(`\\s${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, 'i'));
  if (quoted?.[2]) return quoted[2];
  const unquoted = tag.match(new RegExp(`\\s${name}\\s*=\\s*([^\\s"'\\\`=<>]+)`, 'i'));
  return unquoted?.[1] ?? null;
}
