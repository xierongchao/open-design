import { describe, expect, it } from 'vitest';

import {
  hasTweaksTemplate,
  htmlHasRuntimeScript,
  hasUrlModeBridge,
  htmlNeedsFocusGuard,
  htmlNeedsSandboxShim,
  parseForceInline,
  shouldUrlLoadHtmlPreview,
  shouldUseGrapesjs,
} from '../../src/components/file-viewer-render-mode';

describe('shouldUrlLoadHtmlPreview', () => {
  const base = { mode: 'preview' as const, isDeck: false, commentMode: false, forceInline: false };

  it('URL-loads a plain HTML preview by default', () => {
    expect(shouldUrlLoadHtmlPreview(base)).toBe(true);
  });

  it('falls back to srcDoc when the file is a deck (deck bridge required)', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, isDeck: true })).toBe(false);
  });

  it('falls back to srcDoc when comment mode is active without a URL bridge', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, commentMode: true })).toBe(false);
  });

  it('keeps URL-load when comment mode is active and the artifact owns the bridge', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, commentMode: true, urlModeBridge: true })).toBe(true);
  });

  it('keeps URL-load when comment mode is active and the raw route injects the comment bridge', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, commentMode: true, urlCommentBridge: true })).toBe(true);
  });

  it('falls back to srcDoc when direct edit mode is active without an artifact-owned bridge', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, editMode: true })).toBe(false);
  });

  it('keeps URL-load when direct edit mode is active and the artifact owns the bridge', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, editMode: true, urlModeBridge: true })).toBe(true);
  });

  it('falls back to srcDoc when inspect mode is active (selection bridge required)', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, inspectMode: true })).toBe(false);
  });

  it('falls back to srcDoc when draw mode is active (snapshot bridge required)', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, drawMode: true })).toBe(false);
  });

  it('falls back to srcDoc when the artifact ships the class based tweaks template', () => {
    // Without this, a plain `.tw-panel` artifact would URL load on first
    // open, skip the tweaks bridge entirely, and leave the toolbar toggle
    // disabled (no `od:tweaks-available` ever fires).
    expect(shouldUrlLoadHtmlPreview({ ...base, tweaksBridge: true })).toBe(false);
  });

  it('falls back to srcDoc when the user opts in via forceInline', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, forceInline: true })).toBe(false);
  });

  it('falls back to srcDoc when the HTML source needs a focus guard', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, needsFocusGuard: true })).toBe(false);
  });

  it('does not URL-load while the source-code tab is active', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, mode: 'source' })).toBe(false);
  });

  it('treats any disqualifying flag as sufficient on its own', () => {
    expect(shouldUrlLoadHtmlPreview({ ...base, isDeck: true, commentMode: true })).toBe(false);
    expect(shouldUrlLoadHtmlPreview({ ...base, isDeck: true, forceInline: true })).toBe(false);
    expect(shouldUrlLoadHtmlPreview({ ...base, commentMode: true, forceInline: true })).toBe(false);
    expect(shouldUrlLoadHtmlPreview({ ...base, tweaksBridge: true, forceInline: true })).toBe(false);
    expect(shouldUrlLoadHtmlPreview({ ...base, commentMode: true, urlModeBridge: true, inspectMode: true })).toBe(false);
  });
});

describe('hasTweaksTemplate', () => {
  it('matches a plain `.tw-panel` artifact', () => {
    const source = '<!doctype html><html><body><aside class="tw-panel"></aside></body></html>';
    expect(hasTweaksTemplate(source)).toBe(true);
  });

  it('matches the `.tw-hidden` toggle class even without an explicit `.tw-panel`', () => {
    // Defensive: the template ships both selectors and either one signals a
    // tweaks-template artifact that needs the bridge.
    const source = '<style>.tw-hidden { display: none; }</style>';
    expect(hasTweaksTemplate(source)).toBe(true);
  });

  it('does not match unrelated identifiers that merely contain `tw`', () => {
    expect(hasTweaksTemplate('<div class="container">tweet</div>')).toBe(false);
    expect(hasTweaksTemplate('twk-panel, btw-panel, mtw-hidden')).toBe(false);
  });

  it('returns false for empty / null / undefined input', () => {
    expect(hasTweaksTemplate('')).toBe(false);
    expect(hasTweaksTemplate(null)).toBe(false);
    expect(hasTweaksTemplate(undefined)).toBe(false);
  });
});

describe('hasUrlModeBridge', () => {
  it('detects an artifact-owned direct-edit bridge script', () => {
    expect(hasUrlModeBridge('<script src="od-direct-edit.js"></script>')).toBe(true);
    expect(hasUrlModeBridge('<script defer src="./assets/od-direct-edit.js?v=1"></script>')).toBe(true);
  });

  it('ignores comments, text nodes, and inline script bodies that only mention the bridge name', () => {
    expect(hasUrlModeBridge('<!-- TODO: ship od-direct-edit.js -->')).toBe(false);
    expect(hasUrlModeBridge('<p>Use od-direct-edit.js for editing</p>')).toBe(false);
    expect(hasUrlModeBridge('<script>console.log("od-direct-edit.js")</script>')).toBe(false);
  });

  it('ignores unrelated script URLs', () => {
    expect(hasUrlModeBridge('<script src="direct-edit.js"></script>')).toBe(false);
    expect(hasUrlModeBridge(null)).toBe(false);
  });
});

describe('parseForceInline', () => {
  it('returns false when the parameter is absent', () => {
    expect(parseForceInline('')).toBe(false);
    expect(parseForceInline('?other=1')).toBe(false);
    expect(parseForceInline(null)).toBe(false);
    expect(parseForceInline(undefined)).toBe(false);
  });

  it('returns true for the documented opt-in values', () => {
    expect(parseForceInline('?forceInline=1')).toBe(true);
    expect(parseForceInline('?forceInline=true')).toBe(true);
    expect(parseForceInline('?forceInline=TRUE')).toBe(true);
    expect(parseForceInline('?forceInline=yes')).toBe(true);
    expect(parseForceInline('?forceInline=on')).toBe(true);
  });

  it('returns false for explicit opt-out values and unrelated strings', () => {
    expect(parseForceInline('?forceInline=0')).toBe(false);
    expect(parseForceInline('?forceInline=false')).toBe(false);
    expect(parseForceInline('?forceInline=no')).toBe(false);
    expect(parseForceInline('?forceInline=off')).toBe(false);
    expect(parseForceInline('?forceInline=banana')).toBe(false);
  });

  it('treats an empty value as absent (defensive: ?forceInline= shows up as "")', () => {
    expect(parseForceInline('?forceInline=')).toBe(false);
  });

  it('accepts a pre-built URLSearchParams', () => {
    const params = new URLSearchParams('forceInline=1&other=foo');
    expect(parseForceInline(params)).toBe(true);
  });

  it('survives surrounding whitespace in the value', () => {
    const params = new URLSearchParams();
    params.set('forceInline', '  1  ');
    expect(parseForceInline(params)).toBe(true);
  });
});

describe('htmlNeedsSandboxShim', () => {
  it('returns false for plain static HTML', () => {
    expect(htmlNeedsSandboxShim('<!doctype html><h1>hello</h1>')).toBe(false);
  });

  it('detects <script type="text/babel"> (Babel-standalone React prototypes)', () => {
    // Real agent-emitted shape with src= and double-quoted attributes.
    expect(
      htmlNeedsSandboxShim(
        '<script type="text/babel" src="components/Icon.jsx"></script>',
      ),
    ).toBe(true);
    // Single quotes.
    expect(htmlNeedsSandboxShim("<script type='text/babel'>const a = 1;</script>")).toBe(true);
    // Extra attributes before type=.
    expect(
      htmlNeedsSandboxShim('<script defer type="text/babel" src="app.jsx"></script>'),
    ).toBe(true);
    // Whitespace around the equals sign.
    expect(htmlNeedsSandboxShim('<script type = "text/babel"></script>')).toBe(true);
    // Case-insensitive type value.
    expect(htmlNeedsSandboxShim('<script type="TEXT/BABEL"></script>')).toBe(true);
  });

  it('detects unquoted <script type=text/babel> (HTML5 permits unquoted attrs)', () => {
    // Bare unquoted type value, no other attributes.
    expect(htmlNeedsSandboxShim('<script type=text/babel></script>')).toBe(true);
    // Unquoted with an unquoted src= following — terminates on whitespace.
    expect(
      htmlNeedsSandboxShim('<script type=text/babel src=app.jsx></script>'),
    ).toBe(true);
    // Mixed: unquoted type=, then a quoted src=.
    expect(
      htmlNeedsSandboxShim('<script type=text/babel src="components/Icon.jsx"></script>'),
    ).toBe(true);
    // Trailing `\b` rejects word continuations: `type=text/babelish` does
    // not match because `l`→`i` is a word-internal transition. Hyphenated
    // variants like `type=text/babel-other` still match per the helper
    // docstring (`l`→`-` is a word boundary) — that's the documented safe
    // false-positive direction, so it is intentionally not asserted here.
    expect(htmlNeedsSandboxShim('<script type=text/babelish></script>')).toBe(false);
  });

  it('does not match unrelated MIME types or inline-only <script> tags', () => {
    // Inline JSON data island — no executable code, no Web Storage access.
    expect(htmlNeedsSandboxShim('<script type="application/json">{}</script>')).toBe(false);
    // Substring-only matches must not trigger (e.g. text/babel-like custom type).
    expect(htmlNeedsSandboxShim('<script type="text/babelish"></script>')).toBe(false);
    // A bare inline <script> without src= and without a Web Storage mention
    // is left alone (URL-load can render it fine without the shim).
    expect(htmlNeedsSandboxShim('<script>console.log("hi")</script>')).toBe(false);
  });

  // PR3: localStorage / sessionStorage mentions and external <script src=>
  // no longer trigger the sandbox shim — GrapesJS is now the default path
  // and does not execute JS inside its canvas, so storage / boot scripts
  // don't reach a sandbox that would throw. Only `text/babel` (multi-file
  // JSX prototypes that genuinely can't work in GrapesJS) keeps triggering.
  it('does not flag localStorage / sessionStorage mentions (PR3: GrapesJS default)', () => {
    expect(htmlNeedsSandboxShim('<script>localStorage.getItem("k")</script>')).toBe(false);
    expect(htmlNeedsSandboxShim('<script>sessionStorage.setItem("k","v")</script>')).toBe(false);
    expect(htmlNeedsSandboxShim('// uses localStorage to persist theme')).toBe(false);
    expect(htmlNeedsSandboxShim('mylocalStorageWrapper')).toBe(false);
    expect(htmlNeedsSandboxShim('SuperLocalStorage')).toBe(false);
  });

  it('does not flag external <script src=> (PR3: GrapesJS default)', () => {
    expect(htmlNeedsSandboxShim('<script src="boot.js"></script>')).toBe(false);
    expect(htmlNeedsSandboxShim('<script type="module" src="main.js"></script>')).toBe(false);
    expect(htmlNeedsSandboxShim('<script defer src="./app.js"></script>')).toBe(false);
    expect(htmlNeedsSandboxShim('<script async src="https://cdn.example.com/lib.js"></script>')).toBe(false);
    expect(htmlNeedsSandboxShim("<script src='./bundle.js'></script>")).toBe(false);
    expect(htmlNeedsSandboxShim('<script src = "./bundle.js"></script>')).toBe(false);
    expect(htmlNeedsSandboxShim('<script src=boot.js></script>')).toBe(false);
    expect(htmlNeedsSandboxShim('<SCRIPT SRC="boot.js"></SCRIPT>')).toBe(false);
    expect(htmlNeedsSandboxShim('<img src="logo.png">')).toBe(false);
    expect(htmlNeedsSandboxShim('<link rel="stylesheet" href="styles.css">')).toBe(false);
  });
});

describe('htmlNeedsFocusGuard', () => {
  it('returns false for plain static HTML', () => {
    expect(htmlNeedsFocusGuard('<!doctype html><h1>hello</h1>')).toBe(false);
  });

  it('detects inline .focus() calls', () => {
    expect(htmlNeedsFocusGuard('<script>window.focus();</script>')).toBe(true);
    expect(htmlNeedsFocusGuard('<script>window .focus()</script>')).toBe(true);
    expect(htmlNeedsFocusGuard('<script>WINDOW.FOCUS()</script>')).toBe(true);
    expect(htmlNeedsFocusGuard('<script>document.body.focus();</script>')).toBe(true);
    expect(htmlNeedsFocusGuard('<script>document.querySelector("input").focus()</script>')).toBe(true);
    expect(htmlNeedsFocusGuard('<script>myInput.focus()</script>')).toBe(true);
  });

  // PR3: autofocus attributes and external <script src=> no longer trip the
  // focus guard — GrapesJS is the default path and does not execute JS, so
  // autofocus can't grab host focus and boot scripts can't call .focus().
  it('does not flag autofocus attributes (PR3: GrapesJS does not execute JS)', () => {
    expect(htmlNeedsFocusGuard('<input autofocus>')).toBe(false);
    expect(htmlNeedsFocusGuard('<input AUTOFOCUS>')).toBe(false);
    expect(htmlNeedsFocusGuard('<textarea autofocus></textarea>')).toBe(false);
  });

  it('does not flag external <script src=> (PR3: GrapesJS does not execute JS)', () => {
    expect(htmlNeedsFocusGuard('<script src="./boot.js"></script>')).toBe(false);
    expect(htmlNeedsFocusGuard('<script src="app.js"></script>')).toBe(false);
    expect(htmlNeedsFocusGuard('<script defer src="./assets/init.js"></script>')).toBe(false);
    expect(htmlNeedsFocusGuard('<SCRIPT SRC="main.js"></SCRIPT>')).toBe(false);
  });

  it('does not match inline scripts without focus calls', () => {
    expect(htmlNeedsFocusGuard('<script>console.log("hello")</script>')).toBe(false);
    expect(htmlNeedsFocusGuard('<script type="application/json">{}</script>')).toBe(false);
  });

  it('does not match unrelated focus mentions', () => {
    expect(htmlNeedsFocusGuard('<div class="focus-ring">')).toBe(false);
    expect(htmlNeedsFocusGuard('// focus the element')).toBe(false);
    expect(htmlNeedsFocusGuard(':focus')).toBe(false);
    expect(htmlNeedsFocusGuard('focus-visible')).toBe(false);
  });
});

describe('shouldUseGrapesjs', () => {
  const base = {
    mode: 'preview' as const,
    isDeck: false,
    isModule: false,
    commentMode: false,
    forceInline: false,
    needsSandboxShim: false,
    needsFocusGuard: false,
  };

  it('routes a plain HTML preview through GrapesJS by default', () => {
    expect(shouldUseGrapesjs(base)).toBe(true);
  });

  it('never routes the source Tab through GrapesJS', () => {
    expect(shouldUseGrapesjs({ ...base, mode: 'source' })).toBe(false);
  });

  it('skips decks so the load-bearing framework JS survives', () => {
    expect(shouldUseGrapesjs({ ...base, isDeck: true })).toBe(false);
  });

  it('skips multi-file module prototypes', () => {
    expect(shouldUseGrapesjs({ ...base, isModule: true })).toBe(false);
  });

  it('routes comment mode through GrapesJS (PR2 adapter handles it)', () => {
    expect(shouldUseGrapesjs({ ...base, commentMode: true })).toBe(true);
  });

  it('routes inspect mode through GrapesJS (PR2 adapter handles it)', () => {
    expect(shouldUseGrapesjs({ ...base, inspectMode: true })).toBe(true);
  });

  it('routes draw mode through GrapesJS (PR2 adapter handles it)', () => {
    expect(shouldUseGrapesjs({ ...base, drawMode: true })).toBe(true);
  });

  it('routes palette mode through GrapesJS (PR2 adapter handles it)', () => {
    expect(shouldUseGrapesjs({ ...base, paletteActive: true })).toBe(true);
  });

  it('routes tweaks template through GrapesJS (PR2 adapter handles it)', () => {
    expect(shouldUseGrapesjs({ ...base, tweaksBridge: true })).toBe(true);
  });

  it('still skips when a load-bearing disqualifier combines with these modes', () => {
    // deck wins over comment
    expect(shouldUseGrapesjs({ ...base, isDeck: true, commentMode: true })).toBe(false);
    // sandbox shim wins over draw
    expect(shouldUseGrapesjs({ ...base, needsSandboxShim: true, drawMode: true })).toBe(false);
    // force inline wins over palette
    expect(shouldUseGrapesjs({ ...base, forceInline: true, paletteActive: true })).toBe(false);
  });

  it('skips React-component renderer', () => {
    expect(shouldUseGrapesjs({ ...base, isReactComponent: true })).toBe(false);
  });

  it('routes runtime-script HTML through GrapesJS (PR3: artifact JS preserved on save; canvas just does not execute it)', () => {
    expect(shouldUseGrapesjs({ ...base, runtimeScript: true })).toBe(true);
    expect(shouldUseGrapesjs({ ...base, runtimeScript: true, inspectMode: true })).toBe(true);
  });

  it('skips forceInline so the srcDoc path stays available', () => {
    expect(shouldUseGrapesjs({ ...base, forceInline: true })).toBe(false);
  });

  it('skips Babel / Web Storage artifacts that need the sandbox shim', () => {
    expect(shouldUseGrapesjs({ ...base, needsSandboxShim: true })).toBe(false);
  });

  it('routes focus-guard HTML through GrapesJS edit mode', () => {
    expect(shouldUseGrapesjs({ ...base, needsFocusGuard: true })).toBe(true);
    expect(shouldUseGrapesjs({ ...base, runtimeScript: true, needsFocusGuard: true })).toBe(true);
  });

  it('keeps focus-guard signals lower priority than hard GrapesJS disqualifiers', () => {
    expect(shouldUseGrapesjs({ ...base, needsFocusGuard: true, isDeck: true })).toBe(false);
    expect(shouldUseGrapesjs({ ...base, needsFocusGuard: true, needsSandboxShim: true })).toBe(false);
  });
});

describe('htmlHasRuntimeScript', () => {
  it('matches inline and external runtime scripts', () => {
    expect(htmlHasRuntimeScript('<script>boot()</script>')).toBe(true);
    expect(htmlHasRuntimeScript('<script type="module" src="./app.js"></script>')).toBe(true);
    expect(htmlHasRuntimeScript('<script type=text/javascript src="./app.js"></script>')).toBe(true);
  });

  it('ignores data-only script blocks', () => {
    expect(htmlHasRuntimeScript('<script type="application/json">{}</script>')).toBe(false);
    expect(htmlHasRuntimeScript('<script type="application/ld+json">{}</script>')).toBe(false);
    expect(htmlHasRuntimeScript('<script type="importmap">{ "imports": {} }</script>')).toBe(false);
    expect(htmlHasRuntimeScript('<script type="speculationrules">{}</script>')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(htmlHasRuntimeScript('')).toBe(false);
    expect(htmlHasRuntimeScript(null)).toBe(false);
    expect(htmlHasRuntimeScript(undefined)).toBe(false);
  });
});
