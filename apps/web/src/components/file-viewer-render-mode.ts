/**
 * Decide between two HTML preview render strategies in FileViewer:
 *
 *   - URL-load: <iframe src="/api/projects/:id/raw/:file"> — the browser
 *     fetches each <script src> / <link href> as its own request. Source
 *     maps work, DevTools shows real filenames, per-asset HTTP caching
 *     applies, and a single broken file no longer takes down the whole
 *     iframe. This is the right default for multi-file artifacts (e.g.
 *     React prototypes that ship dozens of `.jsx` files).
 *
 *   - srcDoc inline: build a self-contained document (via buildSrcdoc),
 *     optionally with relative assets concatenated in by inlineRelative-
 *     Assets, and pass it via the iframe's srcDoc attribute. Required
 *     when we need to inject host-side bridges that cannot be served from
 *     the artifact itself (deck navigation, inspect/tweak controls), and
 *     useful as an explicit opt-in for self-contained exports.
 *
 * The two helpers below isolate the decision so it's directly unit-
 * testable without dragging the whole FileViewer React tree into a
 * jsdom harness.
 */

export interface UrlLoadDecision {
  /** Whether the viewer is showing the rendered preview vs. the raw source. */
  mode: 'preview' | 'source';
  /** Treat as a slide deck — needs the deck postMessage bridge. */
  isDeck: boolean;
  /** Comment mode is active. Needs either srcDoc injection or a URL-load bridge. */
  commentMode: boolean;
  /** Inspect mode is active — needs the srcdoc selection bridge for live tuning. */
  inspectMode?: boolean;
  /** Direct text edit is active. Needs either srcDoc injection or an artifact-owned URL-load bridge. */
  editMode?: boolean;
  /** The artifact has its own script that listens for edit postMessages while URL-loaded. */
  urlModeBridge?: boolean;
  /** The URL-loaded artifact response includes the comment/selection bridge. */
  urlCommentBridge?: boolean;
  /** Tweaks palette popover open or palette committed — needs the palette bridge. */
  paletteActive?: boolean;
  /** Draw annotations need the srcDoc snapshot bridge for screenshot export. */
  drawMode?: boolean;
  /**
   * Artifact ships the class based tweaks template (`.tw-panel` / `.tw-hidden`)
   * and therefore needs the srcDoc tweaks bridge so the toolbar toggle can
   * detect availability and drive panel visibility. The bridge is injected by
   * buildSrcdoc and has no equivalent on the URL load path.
   */
  tweaksBridge?: boolean;
  /** User explicitly opted into the inline path via ?forceInline=1. */
  forceInline: boolean;
  /**
   * The HTML source contains patterns that steal focus on load (e.g.
   * `window.focus()`, `element.focus()`). When true, forces the srcDoc path
   * so `injectPreviewFocusGuard` can suppress the focus grab.
   */
  needsFocusGuard?: boolean;
}

/**
 * Detect the class based tweaks template in an artifact source string.
 * Looks for the fixed `.tw-panel` / `.tw-hidden` selectors the skill ships in
 * `design-templates/tweaks/assets/wrap.html`. Returns false for null / empty
 * input so callers can pass `source` directly without a guard.
 */
export function hasTweaksTemplate(source: string | null | undefined): boolean {
  if (!source) return false;
  return /\btw-(?:panel|hidden)\b/.test(source);
}

/**
 * Returns true when an HTML file's preview iframe should load directly
 * from its raw URL (via `<iframe src=...>`) rather than through the
 * srcDoc inline path. Pure function — caller is responsible for the
 * non-HTML / source-mode early returns.
 */
export function shouldUrlLoadHtmlPreview(d: UrlLoadDecision): boolean {
  if (d.mode !== 'preview') return false;
  if (d.isDeck) return false;
  if (d.commentMode && !(d.urlCommentBridge || d.urlModeBridge)) return false;
  // Inspect needs the selection bridge injected via buildSrcdoc; a raw
  // URL-loaded iframe has no listener to apply per-element overrides.
  if (d.inspectMode) return false;
  if (d.editMode && !d.urlModeBridge) return false;
  // Palette tweaks need the srcDoc-side bridge — `<iframe src=URL>` has
  // no parent-injected listener to recolor against.
  if (d.paletteActive) return false;
  if (d.drawMode) return false;
  // The class based tweaks template relies on the srcDoc tweaks bridge
  // emitting `od:tweaks-available` on mount; on the URL load path the bridge
  // is never injected, so the toolbar toggle would stay disabled even though
  // the artifact ships a `.tw-panel`.
  if (d.tweaksBridge) return false;
  if (d.forceInline) return false;
  if (d.needsFocusGuard) return false;
  return true;
}

export function hasUrlModeBridge(source: string | null | undefined): boolean {
  if (!source) return false;
  return /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\bod-direct-edit\.js\b[^"']*["'][^>]*>/i.test(source);
}

/**
 * Read the `forceInline` opt-out from a URL search string or an existing
 * URLSearchParams. Accepts `1`, `true`, `yes`, `on` (case-insensitive).
 * Anything else — including `0`, `false`, an unrelated value, or a
 * missing parameter — returns false.
 */
export function parseForceInline(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get('forceInline');
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Return true when the HTML source contains patterns that fail under the
 * URL-load iframe's bare `sandbox="allow-scripts"` (no `allow-same-origin`).
 *
 * The srcDoc path runs `injectSandboxShim` (see
 * `apps/web/src/runtime/srcdoc.ts`) before any user script, which polyfills
 * `localStorage` / `sessionStorage` so artifacts that read them at mount
 * don't throw `SecurityError` and unmount the React tree. The URL-load path
 * serves raw HTML untouched, so artifacts that touch sandbox-blocked Web
 * Storage at startup go blank.
 *
 * Scope is narrow on purpose. This helper detects three reliable signals
 * visible in the *document* source and routes those artifacts back through
 * srcDoc by toggling `forceInline`:
 *
 *   - `<script type="text/babel">` (quoted or unquoted): Babel-standalone
 *     XHR-fetches and evals sibling `.jsx`/`.tsx` files at runtime.
 *     Agent-emitted React prototypes in this style routinely read Web
 *     Storage from `useState` initializers.
 *   - Direct `localStorage` / `sessionStorage` mentions in the document
 *     source (covers inline scripts and plain HTML that calls them).
 *   - Any external `<script src="…">` (including `type="module"`): the
 *     parent string scan can't see the linked subresource's body, and
 *     agent-emitted artifacts commonly read Web Storage from an external
 *     `boot.js` / `app.js` at module eval (issue #2361). Conservatively
 *     route any external script through srcDoc so the shim is in place
 *     before that read happens. The alternative — fetching every script
 *     URL ahead of the iframe and scanning it — would duplicate work the
 *     browser is about to do and add round trips on every preview load,
 *     so the heuristic favors a few extra srcDoc-mode previews over those
 *     additional requests.
 *
 * Remaining known limitation: dynamically injected scripts
 * (`document.createElement('script'); s.src = '…'; head.appendChild(s)`)
 * are still invisible to this scan because the literal `<script src=…>`
 * tag never appears in the source. Such artifacts will still URL-load and
 * still throw on Web Storage access at startup. Workaround for now: users
 * can opt the artifact into srcDoc with `?forceInline=1` or by toggling
 * Tweaks.
 *
 * Pure string scan — caller passes the same `source` already fetched for
 * preview rendering, so this adds no extra I/O. Heuristic by design: false
 * positives just take the (slightly slower but safer) srcDoc path; false
 * negatives are the same blank-preview the user already hits.
 */
/**
 * Return true when the HTML source may call `.focus()` at load time, which
 * would steal focus from the host page in a URL-loaded iframe. The srcDoc
 * path injects `injectPreviewFocusGuard` to suppress this; URL-load has no
 * such guard, so we force the srcDoc path instead.
 *
 * PR3 update: GrapesJS is now the default path and does NOT execute JS
 * inside its canvas iframe, so `.focus()` / `autofocus` / external scripts
 * cannot steal host focus. This helper now only fires on the rare inline
 * `<script>` that directly calls `.focus(` on `window` / `document` — kept
 * as a defensive signal for the iframe fallback path that may still be
 * selected by other disqualifiers (deck / module / React-component
 * renderer). External `<script src=>` no longer trips this guard because
 * most agent-emitted artifacts ship a boot script, and routing them all
 * to srcDoc defeats the GrapesJS-default goal.
 *
 * This signal only controls the legacy iframe URL-load path. It must not
 * disqualify GrapesJS edit mode: GrapesJS does not execute the artifact JS,
 * and common click-time helpers such as copy fallbacks call `el.focus()`.
 */
export function htmlNeedsFocusGuard(source: string): boolean {
  // Only literal inline `.focus(` calls remain. `autofocus` attributes and
  // external script references no longer trigger — GrapesJS doesn't run
  // the artifact JS, and the iframe path's own focus guard handles the
  // genuine focus-grabbers that slip through.
  if (/\.\s*focus\s*\(/i.test(source)) return true;
  return false;
}

/**
 * Decision payload for routing an HTML preview into the GrapesJS canvas
 * instead of the legacy iframe (URL-load or srcDoc). When this returns
 * true, FileViewer mounts <GrapesjsEditor> and skips the bridge injection
 * path entirely. When false, every existing iframe branch (deck, Babel
 * shim, focus guard, force inline, React-component renderer) keeps working
 * untouched.
 *
 * PR2 update: comment / inspect / draw / palette / tweaks modes now route
 * through GrapesJS when their flags are set — the host subscribes to
 * editor events via the adapter in `grapesjs-bridge-adapter.ts`. Only the
 * load-bearing disqualifiers (deck, module, runtime script, sandbox shim,
 * focus guard, forceInline, React component) still fall back to the
 * iframe path.
 */
export interface GrapesjsDecision {
  /** Only the preview Tab is a candidate; source Tab never mounts a canvas. */
  mode: 'preview' | 'source';
  /** Decks have load-bearing JS (deck-framework.ts); GrapesJS would drop it. */
  isDeck: boolean;
  /** Multi-file prototypes (Babel/React) need module resolution GrapesJS can't do. */
  isModule: boolean;
  /** Comment mode is now driven by GrapesJS selection events. */
  commentMode: boolean;
  /** Inspect mode is now driven by GrapesJS selection events. */
  inspectMode?: boolean;
  /** Draw annotations now use the GrapesJS canvas iframe for snapshots. */
  drawMode?: boolean;
  /** Palette tweaks now write CSS variables on the GrapesJS canvas document. */
  paletteActive?: boolean;
  /** Class-based tweaks template (`.tw-panel`) — availability probed via GrapesJS. */
  tweaksBridge?: boolean;
  /** React-component renderer takes its own srcDoc path. */
  isReactComponent?: boolean;
  /** HTML contains runtime JavaScript that GrapesJS does not execute. */
  runtimeScript?: boolean;
  /** User opted into srcDoc via `?forceInline=1`. */
  forceInline: boolean;
  /** Babel / Web Storage patterns need the srcDoc sandbox shim. */
  needsSandboxShim: boolean;
  /** Source calls `.focus()` and needs srcDoc focus guard on the legacy URL-load path. */
  needsFocusGuard: boolean;
}

/**
 * Returns true when an HTML preview should mount the GrapesJS canvas
 * instead of the legacy iframe. Pure function — caller is responsible
 * for the non-HTML / source-mode / deck early returns.
 *
 * PR2: comment / inspect / draw / palette / tweaks no longer disqualify.
 * The host adapts them to GrapesJS via `grapesjs-bridge-adapter.ts`.
 *
 * PR3: `runtimeScript` no longer disqualifies either. GrapesJS does not
 * execute the artifact's own JS inside the canvas, so interactive bits
 * (scrollspy, tab toggles, etc.) won't run in edit mode — but the saved
 * artifact keeps its `<script>` and runs normally in the real preview /
 * deployed page. Only load-bearing disqualifiers that GrapesJS cannot
 * represent (deck framework, multi-file modules, Babel sandbox shim,
 * forceInline, React-component renderer) keep the iframe path. Focus-guard
 * signals are handled by shouldUrlLoadHtmlPreview for legacy iframes, but
 * do not block GrapesJS edit mode because GrapesJS does not run artifact JS.
 */
export function shouldUseGrapesjs(d: GrapesjsDecision): boolean {
  if (d.mode !== 'preview') return false;
  if (d.isDeck) return false;
  if (d.isModule) return false;
  if (d.isReactComponent) return false;
  if (d.forceInline) return false;
  if (d.needsSandboxShim) return false;
  return true;
}

/**
 * Return true when an HTML document contains a visible runtime script.
 * GrapesJS PR1 intentionally edits static-ish HTML body markup; it does
 * not execute the artifact's own JS inside the canvas. Script-driven pages
 * should keep the iframe path until a later PR models those runtime effects.
 */
export function htmlHasRuntimeScript(source: string | null | undefined): boolean {
  if (!source) return false;
  for (const match of source.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1] ?? '';
    const typeMatch = attrs.match(/\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/i);
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? '').trim().toLowerCase();
    if (!type) return true;
    if (
      type === 'application/json' ||
      type === 'application/ld+json' ||
      type === 'importmap' ||
      type === 'speculationrules'
    ) {
      continue;
    }
    return true;
  }
  return false;
}

export function htmlNeedsSandboxShim(source: string): boolean {
  // PR3 update: GrapesJS is now the default path and serves its own canvas
  // document where storage / external scripts are irrelevant. The srcDoc
  // path (used by deck / module / React-component fallbacks) still needs
  // the sandbox shim for genuine multi-file Babel/JSX prototypes that
  // fetch sibling `.jsx` files at runtime. Only the `text/babel` script
  // type signals that case reliably; localStorage / sessionStorage mentions
  // and external `<script src=>` no longer trip the guard — most agent-
  // emitted artifacts ship a boot script and would otherwise never reach
  // GrapesJS.
  //
  // Quote-optional: HTML5 permits unquoted attribute values
  // (`<script type=text/babel src=app.jsx>`). The trailing `\b` rejects
  // same-prefix word continuations like `text/babelish`. Hyphenated variants
  // (`text/babel-other`) still match because `\b` treats `-` as a non-word
  // boundary, but that's a harmless false positive — srcDoc fallback is
  // the safe direction. Tightening to a `(?=[\s>"'])` lookahead would also
  // reject hyphenated variants if a real case ever surfaces.
  if (/<script\s[^>]*\btype\s*=\s*["']?text\/babel\b/i.test(source)) return true;
  return false;
}
