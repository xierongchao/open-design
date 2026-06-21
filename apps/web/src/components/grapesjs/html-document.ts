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
const EDITOR_CSS_STYLE_ATTR = 'data-od-grapesjs-css';

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
  const { head: cleanedHead, editorCssSeed } = removeSavedEditorCss(parsed.head);
  const editorCss = pruneOrphanCssRules(mergeEditorCss(editorCssSeed, css), bodyHtml);
  const styleBlock = editorCss.trim()
    ? `<style ${EDITOR_CSS_STYLE_ATTR}="">\n${editorCss}\n</style>\n`
    : '';
  const head = cleanedHead
    ? cleanedHead.replace(/<\/head>\s*$/i, `${styleBlock}</head>`)
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

export function normalizeCanvasBodyHtml(bodyHtml: string): string {
  return bodyHtml
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?html\b[^>]*>/gi, '')
    .replace(/<body\b[^>]*>/gi, '')
    .replace(/<\/body\s*>/gi, '');
}

export function extractSavedEditorCss(head: string): string {
  return removeSavedEditorCss(head).editorCssSeed;
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

export function applyCanvasBodyAttributes(
  doc: Document | null,
  parsed: ParsedDocument | null,
): void {
  if (!doc?.body || !parsed) return;
  const body = doc.body;
  const mirroredAttrMarker = 'data-od-grapesjs-body-attrs';
  const previous = (body.getAttribute(mirroredAttrMarker) ?? '')
    .split(/\s+/)
    .filter(Boolean);
  for (const attr of previous) {
    body.removeAttribute(attr);
  }

  const mirrored: string[] = [];
  const attrs = parseTagAttributes(parsed.bodyOpen);
  for (const [attr, value] of Object.entries(attrs)) {
    if (!shouldMirrorBodyAttribute(attr)) continue;
    if (value === null) body.setAttribute(attr, '');
    else body.setAttribute(attr, value);
    mirrored.push(attr);
  }

  if (mirrored.length > 0) body.setAttribute(mirroredAttrMarker, mirrored.join(' '));
  else body.removeAttribute(mirroredAttrMarker);
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

function shouldMirrorBodyAttribute(attr: string): boolean {
  const lower = attr.toLowerCase();
  if (lower === 'style' || lower === 'data-od-grapesjs-body-attrs') return false;
  return (
    lower === 'class' ||
    lower === 'id' ||
    lower === 'dir' ||
    lower === 'lang' ||
    lower === 'role' ||
    lower.startsWith('data-') ||
    lower.startsWith('aria-')
  );
}

function styleBlocksFromHead(head: string): string[] {
  return Array.from(head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1] ?? '')
    .filter(Boolean);
}

function removeSavedEditorCss(head: string): { head: string; editorCssSeed: string } {
  const savedCssBlocks: string[] = [];
  const cleaned = head.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (full, attrs, css) => {
    const blockCss = String(css ?? '');
    if (isEditorCssStyleAttrs(String(attrs ?? '')) || isLegacyGrapesjsCss(blockCss)) {
      savedCssBlocks.push(blockCss);
      return '';
    }
    return full;
  });
  return {
    head: cleaned,
    // Legacy files may contain many stale GrapesJS style blocks. The last one
    // is the newest cascade source, so keep it as the seed and let current
    // editor CSS override it below.
    editorCssSeed: savedCssBlocks.at(-1)?.trim() ?? '',
  };
}

function isEditorCssStyleAttrs(attrs: string): boolean {
  return /(?:^|\s)data-od-grapesjs-css(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=\s|$)/i.test(attrs);
}

function isLegacyGrapesjsCss(css: string): boolean {
  const compact = css.replace(/\s+/g, '').toLowerCase();
  return compact.includes('*{box-sizing:border-box;}body{margin:0;}');
}

function mergeEditorCss(seedCss: string, currentCss: string): string {
  const combined = [seedCss, currentCss].map((block) => block.trim()).filter(Boolean).join('\n');
  if (!combined) return '';

  const rules = new Map<string, string>();
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(combined)) !== null) {
    const selector = match[1]?.trim();
    const declarations = match[2]?.trim();
    if (!selector || !declarations) continue;
    rules.set(selector.replace(/\s+/g, ' '), declarations);
  }
  if (rules.size === 0) return combined;
  return Array.from(rules.entries())
    .map(([selector, declarations]) => `${selector}{${declarations}}`)
    .join('\n');
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

/**
 * Collect the set of `id` attribute values and `data-od-id` attribute values
 * that survive in the given body HTML. Used by `pruneOrphanCssRules` to decide
 * which `#id` / `[data-od-id="..."]` rules still have a matching element.
 *
 * String-regex based (no DOM) so the helper stays a pure function usable in
 * unit tests without a DOM environment.
 */
function collectSurvivingIds(bodyHtml: string): { ids: Set<string>; odIds: Set<string> } {
  const ids = new Set<string>();
  const odIds = new Set<string>();
  if (!bodyHtml) return { ids, odIds };
  const addAttrValues = (attr: string, target: Set<string>) => {
    // Match both quoted (`id="x"`) and unquoted (`id=x`) attribute values.
    const quoted = new RegExp(`\\s${attr}\\s*=\\s*(['"])([^'"]*?)\\1`, 'gi');
    let qMatch: RegExpExecArray | null;
    while ((qMatch = quoted.exec(bodyHtml)) !== null) {
      const value = (qMatch[2] ?? '').trim();
      if (value) target.add(value);
    }
    const unquoted = new RegExp(`\\s${attr}\\s*=\\s*([^\\s"'\\\`=<>]+)`, 'gi');
    let uMatch: RegExpExecArray | null;
    while ((uMatch = unquoted.exec(bodyHtml)) !== null) {
      const value = (uMatch[1] ?? '').trim();
      if (value) target.add(value);
    }
  };
  addAttrValues('id', ids);
  addAttrValues('data-od-id', odIds);
  return { ids, odIds };
}

/**
 * Drop CSS rules whose target element no longer exists in the body.
 *
 * GrapesJS auto-creates `#id` rules (and the inspect panel creates
 * `[data-od-id="..."]` rules) when a component is styled. When that component
 * is later deleted, GrapesJS leaves the rule orphaned in its CssComposer, and
 * it round-trips into the saved file — accumulating dead selectors the user
 * sees in code mode. This filters them out at save time.
 *
 * Conservative scope: only `#id` and `[data-od-id="..."]` selectors are
 * considered for pruning. Class/tag/universal selectors are always kept
 * (their "orphan" status can't be determined from the body string alone, and
 * classes are frequently applied dynamically). Compound selectors (e.g.
 * `#alive .child`) are kept only if they contain at least one surviving id /
 * od-id fragment; otherwise kept (avoid over-pruning).
 */
export function pruneOrphanCssRules(css: string, bodyHtml: string): string {
  if (!css || !css.trim()) return css;
  const { ids, odIds } = collectSurvivingIds(bodyHtml);
  const rules = cssRules(css);
  const kept: Array<{ selector: string; declarations: string }> = [];
  for (const rule of rules) {
    if (ruleOrphaned(rule.selector, ids, odIds)) continue;
    kept.push(rule);
  }
  if (kept.length === rules.length) return css;
  return kept
    .map(({ selector, declarations }) => `${selector}{${declarations}}`)
    .join('\n');
}

function ruleOrphaned(selectorText: string, ids: Set<string>, odIds: Set<string>): boolean {
  // Split comma-separated selector lists and prune per-simple-selector.
  // A rule is orphaned only if EVERY comma branch is orphaned; if any branch
  // survives (e.g. `#alive, #deleted`), keep the whole rule to avoid losing
  // the surviving declaration.
  const branches = selectorText.split(',').map((s) => s.trim()).filter(Boolean);
  if (branches.length === 0) return false;
  return branches.every((branch) => selectorBranchOrphaned(branch, ids, odIds));
}

function selectorBranchOrphaned(branch: string, ids: Set<string>, odIds: Set<string>): boolean {
  let touched = false;
  // Match every `#id` fragment in the branch.
  const idMatches = branch.match(/#[\w-]+/g) ?? [];
  for (const fragment of idMatches) {
    touched = true;
    const id = fragment.slice(1);
    if (ids.has(id)) return false;
  }
  // Match every `[data-od-id="..."]` fragment, quoted or unquoted.
  const odIdQuoted = /\[data-od-id\s*=\s*(['"])([^'"]*?)\1\]/gi;
  let odMatch: RegExpExecArray | null;
  while ((odMatch = odIdQuoted.exec(branch)) !== null) {
    touched = true;
    if (odIds.has((odMatch[2] ?? '').trim())) return false;
  }
  const odIdUnquoted = /\[data-od-id\s*=\s*([^\s'"\]]+)\]/gi;
  let odUnquotedMatch: RegExpExecArray | null;
  while ((odUnquotedMatch = odIdUnquoted.exec(branch)) !== null) {
    touched = true;
    if (odIds.has((odUnquotedMatch[1] ?? '').trim())) return false;
  }
  // Only declare orphaned when this branch actually targeted an id/od-id that
  // is absent. Branches with no id/od-id (class/tag) are never pruned here.
  return touched;
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
  const { head: assetHead } = removeSavedEditorCss(head);
  const inlineCss = Array.from(assetHead.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');

  const stylesheetLinks: CanvasStylesheetLink[] = [];
  for (const match of assetHead.matchAll(/<link\b[^>]*>/gi)) {
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
  const trimmed = decodeHtmlAttributeEntities(assetUrl).trim();
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

export function restoreCanvasAssetUrl(
  assetUrl: string,
  baseHref?: string,
  env: CanvasUrlEnvironment | null = getBrowserUrlEnvironment(),
): string {
  const trimmed = decodeHtmlAttributeEntities(assetUrl).trim();
  if (!trimmed) return trimmed;
  if (/^(?:data:|blob:|mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  if (!baseHref || !env) return trimmed;

  const resolvedBase = resolveCanvasBaseHref(baseHref, env);
  if (!resolvedBase) return trimmed;

  try {
    const base = new URL(resolvedBase);
    const target = new URL(trimmed, env.origin);
    if (target.origin !== base.origin) return trimmed;

    const rawPrefix = rawRoutePrefix(base.pathname);
    if (!rawPrefix || !target.pathname.startsWith(rawPrefix)) return trimmed;

    const ownerDirPath = decodePathname(base.pathname.slice(rawPrefix.length));
    const targetPath = decodePathname(target.pathname.slice(rawPrefix.length));
    return `${relativePathFromDir(ownerDirPath, targetPath)}${target.search}${target.hash}`;
  } catch {
    return trimmed;
  }
}

export function resolveCanvasBodyAssetUrls(
  bodyHtml: string,
  baseHref?: string,
  env: CanvasUrlEnvironment | null = getBrowserUrlEnvironment(),
): string {
  return rewriteCanvasBodyAssetUrls(bodyHtml, (value) => resolveCanvasAssetUrl(value, baseHref, env));
}

export function restoreCanvasBodyAssetUrls(
  bodyHtml: string,
  baseHref?: string,
  env: CanvasUrlEnvironment | null = getBrowserUrlEnvironment(),
): string {
  return rewriteCanvasBodyAssetUrls(bodyHtml, (value) => restoreCanvasAssetUrl(value, baseHref, env));
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

function rewriteCanvasBodyAssetUrls(
  bodyHtml: string,
  transform: (value: string) => string,
): string {
  if (!bodyHtml) return bodyHtml;
  return bodyHtml.replace(/<[^>]*>/g, (tag) =>
    tag.replace(
      /\s(src|href|xlink:href|poster|srcset|style)\s*=\s*(["'])([\s\S]*?)\2/gi,
      (full, attrName: string, quote: string, value: string) => {
        const lower = attrName.toLowerCase();
        const next = lower === 'srcset'
          ? rewriteSrcsetUrls(value, transform)
          : lower === 'style'
            ? rewriteCssUrls(value, transform)
            : transform(value);
        if (next === value) return full;
        return ` ${attrName}=${quote}${escapeHtmlAttrValue(next, quote)}${quote}`;
      },
    ));
}

function rewriteSrcsetUrls(
  value: string,
  transform: (value: string) => string,
): string {
  if (/\bdata:/i.test(value)) return value;
  return value
    .split(',')
    .map((entry) => {
      const match = entry.match(/^(\s*)(\S+)([\s\S]*?)$/);
      if (!match) return entry;
      const leading = match[1] ?? '';
      const url = match[2] ?? '';
      const descriptor = match[3] ?? '';
      return `${leading}${transform(url)}${descriptor}`;
    })
    .join(',');
}

function rewriteCssUrls(
  value: string,
  transform: (value: string) => string,
): string {
  return value.replace(
    /url\(\s*(?:(['"])([\s\S]*?)\1|&quot;([\s\S]*?)&quot;|([^)]*?))\s*\)/gi,
    (_match, _quote: string | undefined, quoted: string | undefined, entityQuoted: string | undefined, unquoted: string | undefined) => {
      const raw = quoted ?? entityQuoted ?? unquoted ?? '';
      const next = transform(raw);
      return `url("${escapeCssString(next)}")`;
    },
  );
}

function rawRoutePrefix(pathname: string): string | null {
  const marker = '/raw/';
  const index = pathname.indexOf(marker);
  if (index < 0) return null;
  return pathname.slice(0, index + marker.length);
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function relativePathFromDir(ownerDirPath: string, targetPath: string): string {
  const ownerParts = normalizedPathParts(ownerDirPath);
  const targetParts = normalizedPathParts(targetPath);
  let common = 0;
  while (
    common < ownerParts.length &&
    common < targetParts.length &&
    ownerParts[common] === targetParts[common]
  ) {
    common += 1;
  }
  const up = new Array(ownerParts.length - common).fill('..');
  const down = targetParts.slice(common);
  const relative = [...up, ...down].join('/');
  return relative || '.';
}

function normalizedPathParts(pathname: string): string[] {
  const out: string[] = [];
  for (const part of pathname.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

function decodeHtmlAttributeEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function escapeHtmlAttrValue(value: string, quote: string): string {
  let escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
  if (quote === '"') {
    escaped = escaped.replace(/"/g, '&quot;');
  } else {
    escaped = escaped.replace(/'/g, '&#39;');
  }
  return escaped;
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
