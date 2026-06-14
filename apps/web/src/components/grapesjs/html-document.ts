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

export function reassembleDocument(parsed: ParsedDocument, bodyHtml: string, css: string): string {
  const styleBlock = css.trim() ? `<style>\n${css}\n</style>\n` : '';
  const head = parsed.head
    ? parsed.head.replace(/<\/head>\s*$/i, `${styleBlock}</head>`)
    : `<head>\n${styleBlock}</head>`;
  return [
    parsed.doctype,
    parsed.htmlOpen,
    head,
    parsed.bodyOpen,
    bodyHtml,
    parsed.bodyClose,
    parsed.htmlClose,
  ].join('\n');
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
