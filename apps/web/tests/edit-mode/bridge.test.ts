import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildManualEditBridge,
  buildManualEditBridgeStyle,
  isMeaningfulManualEditElement,
  isManualEditHostNode,
  isSourceMappableManualEditElement,
  manualEditDomPathForElement,
  manualEditStableIdForElement,
} from '../../src/edit-mode/bridge';

describe('manual edit bridge target normalization', () => {
  it('prefers explicit data-od-id over generated ids', () => {
    const dom = new JSDOM('<main><h1 data-od-id="hero">Title</h1></main>');
    const target = dom.window.document.querySelector('h1')!;

    expect(manualEditStableIdForElement(target)).toBe('hero');
    expect(target.getAttribute('data-od-runtime-id')).toBeNull();
  });

  it('generates stable DOM path ids for unannotated elements', () => {
    const dom = new JSDOM('<main><section><p>First</p><p>Second</p></section></main>');
    const target = dom.window.document.querySelectorAll('p')[1]!;

    expect(manualEditDomPathForElement(target)).toBe('path-0-0-1');
    expect(manualEditStableIdForElement(target)).toBe('path-0-0-1');
    expect(manualEditStableIdForElement(target)).toBe('path-0-0-1');
    expect(target.getAttribute('data-od-runtime-id')).toBe('path-0-0-1');
  });

  it('generates DOM path ids against source-shaped children, ignoring host shim nodes', () => {
    const dom = new JSDOM(
      '<script data-od-sandbox-shim></script><main><section><p>First</p><p>Second</p></section></main><script data-od-edit-bridge></script>',
    );
    const target = dom.window.document.querySelectorAll('p')[1]!;

    expect(isManualEditHostNode(dom.window.document.querySelector('[data-od-sandbox-shim]')!)).toBe(true);
    expect(manualEditDomPathForElement(target)).toBe('path-0-0-1');
  });

  it('discovers meaningful elements and ignores tiny or irrelevant elements', () => {
    const dom = new JSDOM('<main><h1 data-od-source-path="path-0-0">Title</h1><script>1</script></main>');
    const title = dom.window.document.querySelector('h1')!;
    const script = dom.window.document.querySelector('script')!;

    expect(isMeaningfulManualEditElement(title, { width: 80, height: 24 })).toBe(true);
    expect(isMeaningfulManualEditElement(title, { width: 3, height: 24 })).toBe(false);
    expect(isMeaningfulManualEditElement(script, { width: 80, height: 24 })).toBe(false);
  });

  it('keeps source-mappable display:none targets available for the layers panel', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <h1 data-od-source-path="path-0-0">Visible title</h1>
        <section data-od-source-path="path-0-1" style="display:none">
          <p data-od-source-path="path-0-1-0">Hidden author notes</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const visible = dom.window.document.querySelector('h1')!;
    const hiddenSection = dom.window.document.querySelector('section')!;
    const hiddenParagraph = dom.window.document.querySelector('p')!;
    visible.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    hiddenSection.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    hiddenParagraph.getBoundingClientRect = hiddenSection.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.map((target) => target.id)).toEqual([
      'path-0-0',
      'path-0-1',
      'path-0-1-0',
    ]);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-1')?.isHidden).toBe(true);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-1-0')?.isHidden).toBe(true);

    dom.window.close();
  });

  it('treats hidden containers as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="display:none">
          <p data-od-source-path="path-0-0-0">Hidden layout copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const paragraph = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    paragraph.getBoundingClientRect = section.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0');
    const hiddenParagraph = targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(true);
    expect(hiddenParagraph?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not treat visibility-hidden block containers as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="visibility:hidden">
          <p data-od-source-path="path-0-0-0">Hidden block copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const paragraph = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    paragraph.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 140, height: 20,
      top: 8, right: 148, bottom: 28, left: 8,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not treat block containers hidden only by an ancestor as layout editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <div data-od-source-path="path-0-0" style="display:none">
          <section data-od-source-path="path-0-0-0">Nested hidden section</section>
        </div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const wrapper = dom.window.document.querySelector('div')!;
    const section = dom.window.document.querySelector('section')!;
    wrapper.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    section.getBoundingClientRect = wrapper.getBoundingClientRect;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    const hiddenSection = targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0');
    expect(hiddenSection?.isHidden).toBe(true);
    expect(hiddenSection?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('does not mark visibility:visible descendants as hidden', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isHidden?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0" style="visibility:hidden">
          <p data-od-source-path="path-0-0-0" style="visibility:visible">Visible child copy</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;
    const visibleChild = dom.window.document.querySelector('p')!;
    section.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    visibleChild.getBoundingClientRect = () => ({
      x: 8, y: 8, width: 140, height: 20,
      top: 8, right: 148, bottom: 28, left: 8,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isHidden?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0')?.isHidden).toBe(true);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0')?.isHidden).toBe(false);

    dom.window.close();
  });

  it('does not expose path targets unless they carry a source path marker', () => {
    const dom = new JSDOM('<main><h1>Runtime title</h1><p data-od-source-path="path-0-1">Source text</p></main>');
    const runtimeTitle = dom.window.document.querySelector('h1')!;
    const sourceText = dom.window.document.querySelector('p')!;

    expect(isSourceMappableManualEditElement(runtimeTitle)).toBe(false);
    expect(isSourceMappableManualEditElement(sourceText)).toBe(true);
    expect(isMeaningfulManualEditElement(runtimeTitle, { width: 80, height: 24 })).toBe(false);
  });

  it('omits selected outerHTML from bulk target posts but includes it for selected targets', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain('targets.push(targetFrom(nodes[i], false))');
    expect(bridge).toContain("target: targetFrom(el, true)");
    expect(bridge).toContain('if (!isSourceMappable(nodes[i])) continue;');
    expect(bridge).toContain('return el;');
    expect(bridge).not.toContain('if (isPrimaryTarget(el)) return el;');
  });

  it('prefers the deepest source-mapped child over an annotated group on hover', async () => {
    const posts: Array<{ type?: string; target?: { id: string; label?: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero-group">
          <span data-od-source-path="path-0-0-0">Small label</span>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const span = dom.window.document.querySelector('span')!;
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; target?: { id: string; label?: string } });
    }) as typeof dom.window.parent.postMessage;

    span.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));

    const hover = posts.find((message) => message.type === 'od-edit-hover');
    expect(hover?.target?.id).toBe('path-0-0-0');
    expect(hover?.target?.label).toBe('Small label');

    dom.window.close();
  });

  it('acks live preview style patches by id and version', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain("type: 'od-edit-preview-style-applied'");
    expect(bridge).toContain('version: Number(version) || 0, ok: true');
    expect(bridge).toContain("ok: false, error: 'Target not found'");
  });

  it('moves the runtime selected marker between selected targets', () => {
    const dom = new JSDOM(
      `<main>
        <h1 data-od-id="title">Title</h1>
        <p data-od-id="body">Body</p>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]')!;
    const body = dom.window.document.querySelector('[data-od-id="body"]')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'title' },
    }));
    expect(title.getAttribute('data-od-edit-selected')).toBe('true');
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'body' },
    }));
    expect(title.hasAttribute('data-od-edit-selected')).toBe(false);
    expect(body.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.close();
  });

  it('clears runtime selected markers for null selection and edit-mode exit', () => {
    const dom = new JSDOM(
      `<main>
        <h1 data-od-id="title">Title</h1>
        <p data-od-id="body" data-od-edit-selected="true">Body</p>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const body = dom.window.document.querySelector('[data-od-id="body"]')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: null },
    }));
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'body' },
    }));
    expect(body.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));
    expect(body.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.close();
  });

  it('keeps runtime selection marker out of source-shaped target data', () => {
    const bridge = buildManualEditBridge(true);

    expect(bridge).toContain("attr.name === 'data-od-edit-selected'");
    expect(bridge).toContain('replace(/\\sdata-od-edit-selected="[^"]*"/g, \'\')');
    expect(bridge).toContain('[data-od-edit-selected]');
  });

  it('marks source-mapped DOM containers as layout editable even before flex is enabled', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; isLayoutContainer?: boolean }> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-source-path="path-0-0">
          <p data-od-source-path="path-0-0-0">First card</p>
          <p data-od-source-path="path-0-0-1">Second card</p>
        </section>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    for (const el of dom.window.document.querySelectorAll('section, p')) {
      el.getBoundingClientRect = () => ({
        x: 0, y: 0, width: 160, height: 32,
        top: 0, right: 160, bottom: 32, left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; isLayoutContainer?: boolean }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((message) => message.type === 'od-edit-targets');
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0')?.isLayoutContainer).toBe(true);
    expect(targetsMessage?.targets?.find((target) => target.id === 'path-0-0-0')?.isLayoutContainer).toBe(false);

    dom.window.close();
  });

  it('posts cursor-anchored manual edit zoom wheel events from inside the iframe', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');
    const wheel = new dom.window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
      deltaY: -90,
      metaKey: true,
    });

    dom.window.document.querySelector('section')?.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-viewport-wheel',
      clientX: 120,
      clientY: 80,
      deltaY: -90,
    }, '*');

    dom.window.close();
  });

  it('posts middle-button pan events from inside the iframe', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');
    const section = dom.window.document.querySelector('section') as HTMLElement;
    const pointerDown = new dom.window.MouseEvent('pointerdown', {
      bubbles: true,
      button: 1,
      buttons: 4,
      cancelable: true,
      clientX: 100,
      clientY: 120,
      screenX: 500,
      screenY: 620,
    });

    section.dispatchEvent(pointerDown);
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', {
      bubbles: true,
      buttons: 4,
      clientX: 126,
      clientY: 144,
      screenX: 526,
      screenY: 644,
    }));
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointerup', {
      bubbles: true,
      button: 1,
      buttons: 0,
      clientX: 126,
      clientY: 144,
      screenX: 526,
      screenY: 644,
    }));

    expect(pointerDown.defaultPrevented).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-viewport-pan',
      phase: 'start',
      clientX: 100,
      clientY: 120,
      screenX: 500,
      screenY: 620,
    }, '*');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-viewport-pan',
      phase: 'move',
      clientX: 126,
      clientY: 144,
      screenX: 526,
      screenY: 644,
    }, '*');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-viewport-pan',
      phase: 'end',
      clientX: 126,
      clientY: 144,
      screenX: 526,
      screenY: 644,
    }, '*');

    dom.window.close();
  });

  it('suppresses hover outlines and hover posts while middle-button panning', () => {
    const posts: Array<{ type?: string; target?: { id: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero">Hero</section>
        <aside data-od-id="details">Details</aside>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; target?: { id: string } });
    }) as typeof dom.window.parent.postMessage;
    const section = dom.window.document.querySelector('section') as HTMLElement;
    const aside = dom.window.document.querySelector('aside') as HTMLElement;

    section.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    expect(section.getAttribute('data-od-edit-hover')).toBe('true');

    section.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
      bubbles: true,
      button: 1,
      buttons: 4,
      cancelable: true,
      clientX: 100,
      clientY: 120,
    }));
    aside.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));

    expect(section.hasAttribute('data-od-edit-hover')).toBe(false);
    expect(aside.hasAttribute('data-od-edit-hover')).toBe(false);
    expect(posts.filter((message) => message.type === 'od-edit-hover')).toHaveLength(1);

    dom.window.close();
  });

  it('turns text targets into inline editors and commits changed text', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Original title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    title.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(title.getAttribute('data-od-editing')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'title',
        kind: 'text',
      }),
    }, '*');

    title.textContent = 'Edited title';
    title.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(title.hasAttribute('contenteditable')).toBe(false);
    expect(title.hasAttribute('data-od-editing')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'title',
      value: 'Edited title',
    }, '*');

    dom.window.close();
  });

  it('cancels inline text edits with Escape without posting a commit', () => {
    const dom = new JSDOM(
      `<main><p data-od-id="body">Original body</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const body = dom.window.document.querySelector('[data-od-id="body"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    body.textContent = 'Draft body';
    body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));

    expect(body.textContent).toBe('Original body');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'od-edit-text-commit',
    }), '*');

    dom.window.close();
  });

  it('blocks clicks on unmapped elements while edit mode is enabled', () => {
    const dom = new JSDOM(
      `<main><button id="cta">Launch</button></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const button = dom.window.document.getElementById('cta') as HTMLButtonElement;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);

    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    const result = button.dispatchEvent(event);

    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(clicked).not.toHaveBeenCalled();

    dom.window.close();
  });

  it('deselects the current target when clicking the same element again', () => {
    const posts: Array<{ type?: string; target?: { id: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero">Hero section</section>
        <div data-od-id="content">Content area</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; target?: { id: string } });
    }) as typeof dom.window.parent.postMessage;
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    // Stub getBoundingClientRect so the element passes the size filter
    hero.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 100,
      top: 0, right: 200, bottom: 100, left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // First click: select
    hero.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    // Simulate the host setting the selected attribute
    hero.setAttribute('data-od-edit-selected', 'true');

    const selectMsg = posts.find((m) => m.type === 'od-edit-select');
    expect(selectMsg?.target?.id).toBe('hero');

    // Second click on same element: deselect
    posts.length = 0;
    hero.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    const deselectMsg = posts.find((m) => m.type === 'od-edit-deselect');
    expect(deselectMsg).toBeDefined();
    expect(hero.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.close();
  });

  it('selects a different target when clicking a non-selected element', () => {
    const posts: Array<{ type?: string; target?: { id: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero">Hero section</section>
        <div data-od-id="content">Content area</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; target?: { id: string } });
    }) as typeof dom.window.parent.postMessage;
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    const content = dom.window.document.querySelector('[data-od-id="content"]') as HTMLElement;
    hero.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 100,
      top: 0, right: 200, bottom: 100, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    content.getBoundingClientRect = () => ({
      x: 0, y: 100, width: 200, height: 100,
      top: 100, right: 200, bottom: 200, left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Select hero first
    hero.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    hero.setAttribute('data-od-edit-selected', 'true');

    // Click content: should select content, not deselect
    posts.length = 0;
    content.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(posts.find((m) => m.type === 'od-edit-deselect')).toBeUndefined();
    const selectMsg = posts.find((m) => m.type === 'od-edit-select');
    expect(selectMsg?.target?.id).toBe('content');

    dom.window.close();
  });

  it('marks shift-click selections as additive and accepts multiple selected ids from the host', () => {
    const posts: Array<{ type?: string; append?: boolean; target?: { id: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero">Hero section</section>
        <div data-od-id="content">Content area</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; append?: boolean; target?: { id: string } });
    }) as typeof dom.window.parent.postMessage;
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    const content = dom.window.document.querySelector('[data-od-id="content"]') as HTMLElement;
    hero.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 100,
      top: 0, right: 200, bottom: 100, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    content.getBoundingClientRect = () => ({
      x: 0, y: 100, width: 200, height: 100,
      top: 100, right: 200, bottom: 200, left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    hero.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-targets', ids: ['hero'] },
    }));
    content.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));

    const additiveSelect = posts.find((m) => m.type === 'od-edit-select' && m.target?.id === 'content');
    expect(additiveSelect?.append).toBe(true);
    expect(hero.getAttribute('data-od-edit-selected')).toBe('true');
    expect(content.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-targets', ids: ['hero', 'content'] },
    }));

    expect(hero.getAttribute('data-od-edit-selected')).toBe('true');
    expect(content.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.close();
  });

  it('creates resize handles when a target is selected via host message', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const section = dom.window.document.querySelector('section')!;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));

    const handles = dom.window.document.querySelectorAll('[data-od-resize-handle]');
    expect(handles.length).toBe(4);
    const edges = Array.from(handles).map((h) => h.getAttribute('data-od-resize-handle'));
    expect(edges).toContain('top');
    expect(edges).toContain('right');
    expect(edges).toContain('bottom');
    expect(edges).toContain('left');

    dom.window.close();
  });

  it('removes resize handles when selection is cleared', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));
    expect(dom.window.document.querySelectorAll('[data-od-resize-handle]').length).toBe(4);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: null },
    }));
    expect(dom.window.document.querySelectorAll('[data-od-resize-handle]').length).toBe(0);

    dom.window.close();
  });

  it('removes resize handles when edit mode is disabled', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));
    expect(dom.window.document.querySelectorAll('[data-od-resize-handle]').length).toBe(4);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));
    expect(dom.window.document.querySelectorAll('[data-od-resize-handle]').length).toBe(0);

    dom.window.close();
  });

  it('posts od-edit-resize-end when dragging a right-edge handle', () => {
    const posts: Array<{ type?: string; id?: string; styles?: Record<string, string> }> = [];
    const dom = new JSDOM(
      `<main><section data-od-id="hero" style="width:200px;height:100px">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string; styles?: Record<string, string> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));

    const rightHandle = dom.window.document.querySelector('[data-od-resize-handle="right"]') as HTMLElement;
    expect(rightHandle).toBeTruthy();

    rightHandle.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 200, clientY: 50,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointermove', {
      bubbles: true, clientX: 230, clientY: 50,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointerup', {
      bubbles: true, clientX: 230, clientY: 50,
    }));

    const resizeEnd = posts.find((m) => m.type === 'od-edit-resize-end');
    expect(resizeEnd).toBeDefined();
    expect(resizeEnd?.id).toBe('hero');
    expect(resizeEnd?.styles?.width).toBeDefined();

    dom.window.close();
  });

  it('repositions resize handles when preview styles change the selected element size', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero" style="width:200px;height:100px">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    hero.getBoundingClientRect = () => {
      const width = parseFloat(hero.style.width) || 200;
      const height = parseFloat(hero.style.height) || 100;
      return {
        x: 10, y: 20, width, height,
        top: 20, left: 10, right: 10 + width, bottom: 20 + height,
        toJSON: () => ({}),
      } as DOMRect;
    };

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));
    const rightHandle = dom.window.document.querySelector('[data-od-resize-handle="right"]') as HTMLElement | null;
    const bottomHandle = dom.window.document.querySelector('[data-od-resize-handle="bottom"]') as HTMLElement | null;
    if (!rightHandle || !bottomHandle) throw new Error('Resize handles not found');
    expect(rightHandle.style.left).toBe('206px');
    expect(bottomHandle.style.top).toBe('116px');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-preview-style',
        id: 'hero',
        version: 1,
        styles: { width: '260px', height: '120px' },
      },
    }));

    expect(rightHandle.style.left).toBe('266px');
    expect(bottomHandle.style.top).toBe('136px');

    dom.window.close();
  });

  it('does not trigger drag-to-move on container elements (drag is disabled)', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string; styles?: Record<string, string> }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero" style="width:200px;height:100px">Hero</section>
        <div data-od-id="content" style="width:200px;height:100px">Content</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    const content = dom.window.document.querySelector('[data-od-id="content"]') as HTMLElement;
    hero.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 100,
      top: 0, right: 200, bottom: 100, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    content.getBoundingClientRect = () => ({
      x: 0, y: 100, width: 200, height: 100,
      top: 100, right: 200, bottom: 200, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string; targetId?: string; position?: string; styles?: Record<string, string> });
    }) as typeof dom.window.parent.postMessage;

    // Select the hero section
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));
    expect(hero.getAttribute('data-od-edit-selected')).toBe('true');

    // Try to drag: pointerdown → pointermove (past threshold) → pointerup
    hero.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 50, clientY: 50,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointermove', {
      bubbles: true, clientX: 80, clientY: 150,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointerup', {
      bubbles: true, clientX: 80, clientY: 150,
    }));

    // Drag is disabled — no move-end should be posted
    expect(posts.find((m) => m.type === 'od-edit-move-end')).toBeUndefined();

    dom.window.close();
  });

  it('does not trigger drag on text elements', () => {
    const posts: Array<{ type?: string; id?: string; styles?: Record<string, string> }> = [];
    const dom = new JSDOM(
      `<main><p data-od-id="body" style="width:200px;height:30px">Text</p></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const p = dom.window.document.querySelector('[data-od-id="body"]') as HTMLElement;
    p.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 30,
      top: 0, right: 200, bottom: 30, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string; styles?: Record<string, string> });
    }) as typeof dom.window.parent.postMessage;

    // Select the text element
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'body' },
    }));

    // Try to drag
    p.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 10, clientY: 10,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointermove', {
      bubbles: true, clientX: 40, clientY: 40,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointerup', {
      bubbles: true, clientX: 40, clientY: 40,
    }));

    expect(posts.find((m) => m.type === 'od-edit-drag-end')).toBeUndefined();

    dom.window.close();
  });

  it('does not treat a small pointer movement as a drag', () => {
    const posts: Array<{ type?: string; id?: string; styles?: Record<string, string> }> = [];
    const dom = new JSDOM(
      `<main><section data-od-id="hero" style="width:200px;height:100px">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    hero.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 200, height: 100,
      top: 0, right: 200, bottom: 100, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; id?: string; styles?: Record<string, string> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));

    // Move only 1px (below threshold of 3px)
    hero.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 50, clientY: 50,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointermove', {
      bubbles: true, clientX: 51, clientY: 51,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointerup', {
      bubbles: true, clientX: 51, clientY: 51,
    }));

    expect(posts.find((m) => m.type === 'od-edit-drag-end')).toBeUndefined();

    dom.window.close();
  });

  it('draws selected outlines at the exact element edge without offset', () => {
    const style = buildManualEditBridgeStyle();
    const selectedRule = style.match(/\[data-od-edit-selected\][\s\S]*?\}/)?.[0] ?? '';

    expect(selectedRule).toContain('outline-offset: 0');
    expect(selectedRule).not.toContain('box-shadow: 0 0 0 2px');
  });

  it('draws hover outlines at the exact element edge without offset', () => {
    const style = buildManualEditBridgeStyle();
    const hoverRule = style.match(/\[data-od-edit-hover\][\s\S]*?\}/)?.[0] ?? '';

    expect(hoverRule).toContain('outline-offset: 0');
    expect(hoverRule).not.toContain('box-shadow: 0 0 0 2px');
  });

  // A2: table cell selection border should use box-shadow instead of outline
  it('uses box-shadow instead of outline for selected table cells to avoid border-collapse overflow', () => {
    const style = buildManualEditBridgeStyle();

    // Table cells should have specific rules using box-shadow:inset
    const tdSelectedRule = style.match(/td\[data-od-edit-selected\][\s\S]*?\}/)?.[0] ?? '';
    const thSelectedRule = style.match(/th\[data-od-edit-selected\][\s\S]*?\}/)?.[0] ?? '';

    expect(tdSelectedRule).toContain('box-shadow: inset 0 0 0 2px #2563eb');
    expect(tdSelectedRule).toContain('outline: none');
    expect(thSelectedRule).toContain('box-shadow: inset 0 0 0 2px #2563eb');
    expect(thSelectedRule).toContain('outline: none');
  });

  it('uses box-shadow instead of outline for hovered table cells to avoid border-collapse overflow', () => {
    const style = buildManualEditBridgeStyle();

    const tdHoverRule = style.match(/td\[data-od-edit-hover\][\s\S]*?\}/)?.[0] ?? '';
    const thHoverRule = style.match(/th\[data-od-edit-hover\][\s\S]*?\}/)?.[0] ?? '';

    expect(tdHoverRule).toContain('box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.5)');
    expect(tdHoverRule).toContain('outline: none');
    expect(thHoverRule).toContain('box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.5)');
    expect(thHoverRule).toContain('outline: none');
  });

  // A1: div with only text content should be editable
  it('makes a div with only text content inline-editable when clicked', () => {
    const dom = new JSDOM(
      `<main><div data-od-id="text-div">Just plain text</div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const div = dom.window.document.querySelector('[data-od-id="text-div"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    div.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));

    // The div should become contenteditable because it only contains text
    expect(div.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(div.getAttribute('data-od-editing')).toBe('true');
    // kind stays 'container' in inferKind, but click handler enables editing for text-only containers
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'text-div',
        kind: 'container',
      }),
    }, '*');

    // Edit the text and blur to commit
    div.textContent = 'Edited div text';
    div.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(div.hasAttribute('contenteditable')).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'text-div',
      value: 'Edited div text',
    }, '*');

    dom.window.close();
  });

  it('does not make a div with child elements inline-editable when clicked', () => {
    const dom = new JSDOM(
      `<main><div data-od-id="container-div"><p>Child paragraph</p></div></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const div = dom.window.document.querySelector('[data-od-id="container-div"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    div.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));

    // The div has child elements, so it should NOT become editable
    expect(div.getAttribute('contenteditable')).toBeNull();
    // It should be selected as a container kind instead
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        id: 'container-div',
        kind: 'container',
      }),
    }, '*');

    dom.window.close();
  });

  // A2: table cells should be discoverable and editable
  it('discovers table cells as editable targets', async () => {
    const posts: Array<{ type?: string; targets?: Array<{ id: string; kind: string }> }> = [];
    const dom = new JSDOM(
      `<main>
        <table data-od-source-path="path-0-0">
          <thead data-od-source-path="path-0-0-0">
            <tr data-od-source-path="path-0-0-0-0">
              <th data-od-source-path="path-0-0-0-0-0">Header 1</th>
              <th data-od-source-path="path-0-0-0-0-1">Header 2</th>
            </tr>
          </thead>
          <tbody data-od-source-path="path-0-0-1">
            <tr data-od-source-path="path-0-0-1-0">
              <td data-od-source-path="path-0-0-1-0-0">Cell 1</td>
              <td data-od-source-path="path-0-0-1-0-1">Cell 2</td>
            </tr>
          </tbody>
        </table>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );

    // Stub getBoundingClientRect for all table elements
    for (const el of dom.window.document.querySelectorAll('table, thead, tbody, tr, th, td')) {
      el.getBoundingClientRect = () => ({
        x: 0, y: 0, width: 100, height: 30,
        top: 0, right: 100, bottom: 30, left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string; targets?: Array<{ id: string; kind: string }> });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const targetsMessage = posts.find((m) => m.type === 'od-edit-targets');
    const ids = targetsMessage?.targets?.map((t) => t.id) ?? [];

    // Table cells and headers should be discovered
    expect(ids).toContain('path-0-0-0-0-0');
    expect(ids).toContain('path-0-0-0-0-1');
    expect(ids).toContain('path-0-0-1-0-0');
    expect(ids).toContain('path-0-0-1-0-1');

    dom.window.close();
  });

  it('makes table header cells inline-editable when clicked', () => {
    const dom = new JSDOM(
      `<main>
        <table data-od-source-path="path-0-0">
          <tr data-od-source-path="path-0-0-0">
            <th data-od-source-path="path-0-0-0-0">Header Text</th>
          </tr>
        </table>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const th = dom.window.document.querySelector('th') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    th.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));

    // th should become contenteditable and classified as text
    expect(th.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        kind: 'text',
      }),
    }, '*');

    // Edit and commit
    th.textContent = 'Edited Header';
    th.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'path-0-0-0-0',
      value: 'Edited Header',
    }, '*');

    dom.window.close();
  });

  it('makes table data cells inline-editable when clicked', () => {
    const dom = new JSDOM(
      `<main>
        <table data-od-source-path="path-0-0">
          <tr data-od-source-path="path-0-0-0">
            <td data-od-source-path="path-0-0-0-0">Cell Data</td>
          </tr>
        </table>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const td = dom.window.document.querySelector('td') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    td.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));

    // td should become contenteditable and classified as text
    expect(td.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-select',
      target: expect.objectContaining({
        kind: 'text',
      }),
    }, '*');

    // Edit and commit
    td.textContent = 'Edited Cell';
    td.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-text-commit',
      id: 'path-0-0-0-0',
      value: 'Edited Cell',
    }, '*');

    dom.window.close();
  });

  // A1: undo/redo shortcuts should be forwarded to parent via postMessage
  it('posts od-edit-undo when Ctrl+Z is pressed inside the iframe', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
    });
    dom.window.document.dispatchEvent(event);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-undo',
    }, '*');

    dom.window.close();
  });

  it('posts od-edit-undo when Cmd+Z is pressed inside the iframe', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      metaKey: true,
    });
    dom.window.document.dispatchEvent(event);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-undo',
    }, '*');

    dom.window.close();
  });

  it('posts od-edit-redo when Ctrl+Shift+Z is pressed inside the iframe', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
    });
    dom.window.document.dispatchEvent(event);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-redo',
    }, '*');

    dom.window.close();
  });

  it('posts od-edit-redo when Ctrl+Y is pressed inside the iframe', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'y',
      ctrlKey: true,
    });
    dom.window.document.dispatchEvent(event);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'od-edit-redo',
    }, '*');

    dom.window.close();
  });

  it('does not post undo/redo when edit mode is disabled', () => {
    const dom = new JSDOM(
      `<main><section data-od-id="hero">Hero</section></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    // Disable edit mode first
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: false },
    }));

    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
    });
    dom.window.document.dispatchEvent(event);

    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-undo' }),
      '*',
    );

    dom.window.close();
  });

  it('does not post undo/redo when an element is being inline-edited', () => {
    const dom = new JSDOM(
      `<main><h1 data-od-id="title">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const title = dom.window.document.querySelector('[data-od-id="title"]') as HTMLElement;
    const postMessage = vi.spyOn(dom.window.parent, 'postMessage');

    // Click to start inline editing
    title.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');

    // Ctrl+Z should NOT post od-edit-undo during inline editing
    postMessage.mockClear();
    title.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'z',
      ctrlKey: true,
    }));

    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'od-edit-undo' }),
      '*',
    );

    dom.window.close();
  });
});

// E: buttons and interactive elements without data-od-id should still be selectable via click
describe('element selection without source mapping', () => {
  it('allows clicking a button without data-od-id to select it via the bridge', async () => {
    const posts: Array<{ type?: string; target?: { id: string; tagName: string } }> = [];
    const dom = new JSDOM(
      `<main>
        <div data-od-id="toolbar" style="width:200px;height:40px;">
          <button style="width:80px;height:24px;">Add</button>
          <button style="width:80px;height:24px;">Delete</button>
        </div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true },
    );
    dom.window.parent.postMessage = (msg: unknown) => { posts.push(msg as typeof posts[0]); };
    // Wait for bridge init
    await new Promise((r) => setTimeout(r, 50));

    const buttons = dom.window.document.querySelectorAll('button');
    const addButton = buttons[0] as HTMLElement;

    // Simulate layout
    Object.defineProperty(addButton, 'getBoundingClientRect', {
      value: () => ({ x: 10, y: 10, width: 80, height: 24, top: 10, right: 90, bottom: 34, left: 10 }),
    });

    addButton.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 20,
    }));

    // The bridge should post an od-edit-select message for the button
    const selectMsg = posts.find((p) => p.type === 'od-edit-select');
    expect(selectMsg).toBeTruthy();
    expect(selectMsg?.target?.tagName).toBe('button');

    dom.window.close();
  });
});

// A: gradient (backgroundImage) support
describe('gradient background support', () => {
  it('reads backgroundImage from an element with a gradient background', async () => {
    const posts: Array<{ type?: string; target?: { styles?: { backgroundImage?: string; backgroundColor?: string } } }> = [];
    const dom = new JSDOM(
      `<main data-od-id="hero" style="background-image: linear-gradient(90deg, #ff0000, #0000ff); width: 200px; height: 100px;">Hero</main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true },
    );
    dom.window.parent.postMessage = (msg: unknown) => { posts.push(msg as typeof posts[0]); };
    await new Promise((r) => setTimeout(r, 50));

    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    Object.defineProperty(hero, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, width: 200, height: 100, top: 0, right: 200, bottom: 100, left: 0 }),
    });

    hero.dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 50,
    }));

    const selectMsg = posts.find((p) => p.type === 'od-edit-select');
    expect(selectMsg).toBeTruthy();
    expect(selectMsg?.target?.styles?.backgroundImage).toContain('linear-gradient');

    dom.window.close();
  });

  it('applies a gradient backgroundImage via set-style patch', async () => {
    const dom = new JSDOM(
      `<main data-od-id="hero" style="width: 200px; height: 100px;">Hero</main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true },
    );
    await new Promise((r) => setTimeout(r, 50));

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: {
        type: 'od-edit-preview-style',
        id: 'hero',
        version: 1,
        styles: { backgroundImage: 'linear-gradient(180deg, #ef4444, #3b82f6)' },
      },
    }));

    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    expect(hero.style.backgroundImage).toContain('linear-gradient');
    // JSDOM normalizes hex colors to rgb() in computed style values
    expect(hero.style.backgroundImage).toMatch(/rgb\(/);

    dom.window.close();
  });

  it('posts od-edit-deselect on Escape when a target is selected', async () => {
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main><h1 data-od-id="hero" data-od-source-path="path-0-0">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const h1 = dom.window.document.querySelector('h1')!;
    h1.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 160, height: 32,
      top: 0, right: 160, bottom: 32, left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    // Select target via the host→bridge message (same as setSelectedTarget)
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    expect(h1.hasAttribute('data-od-edit-selected')).toBe(true);

    // Press Escape — should deselect and post od-edit-deselect
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(posts.some((m) => m.type === 'od-edit-deselect')).toBe(true);
    expect(h1.hasAttribute('data-od-edit-selected')).toBe(false);

    dom.window.close();
  });

  it('does not post od-edit-deselect on Escape when no target is selected', async () => {
    const posts: Array<{ type?: string }> = [];
    const dom = new JSDOM(
      `<main><h1 data-od-id="hero" data-od-source-path="path-0-0">Title</h1></main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as { type?: string });
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-mode', enabled: true },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    // No element selected — Escape should NOT post od-edit-deselect
    posts.length = 0;
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(posts.some((m) => m.type === 'od-edit-deselect')).toBe(false);

    dom.window.close();
  });
});

// B: edit mode text selection disabled, flex reorder by arrow keys, drag removed
describe('edit mode UX improvements', () => {
  it('disables text selection on all elements in edit mode via bridge style', () => {
    const style = buildManualEditBridgeStyle();
    const bodyStarRule = style.match(/html\[data-od-edit-mode\] body \* \{[^}]*\}/)?.[0] ?? '';

    expect(bodyStarRule).toContain('user-select: none');
    expect(bodyStarRule).toContain('-webkit-user-select: none');
  });

  it('restores text selection on inline-edited elements', () => {
    const style = buildManualEditBridgeStyle();
    const editingRule = style.match(/\[data-od-editing="true"\][^{]*\{[^}]*\}/s)?.[0] ?? '';

    expect(editingRule).toContain('user-select: text');
  });

  it('removes cursor:move from selected elements (drag disabled)', () => {
    const style = buildManualEditBridgeStyle();
    const selectedRule = style.match(/\[data-od-edit-selected\][^{]*\{[^}]*\}/s)?.[0] ?? '';

    expect(selectedRule).not.toContain('cursor: move');
  });

  it('posts od-edit-move-end when ArrowDown swaps a selected element in a flex-column container', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string }> = [];
    const dom = new JSDOM(
      `<main style="display:flex;flex-direction:column">
        <div data-od-id="card-a" style="width:100px;height:40px">Card A</div>
        <div data-od-id="card-b" style="width:100px;height:40px">Card B</div>
        <div data-od-id="card-c" style="width:100px;height:40px">Card C</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as typeof posts[0]);
    }) as typeof dom.window.parent.postMessage;

    const cardA = dom.window.document.querySelector('[data-od-id="card-a"]') as HTMLElement;
    const cardB = dom.window.document.querySelector('[data-od-id="card-b"]') as HTMLElement;
    cardA.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 40, top: 0, right: 100, bottom: 40, left: 0, toJSON: () => ({}) } as DOMRect);
    cardB.getBoundingClientRect = () => ({ x: 0, y: 44, width: 100, height: 40, top: 44, right: 100, bottom: 84, left: 0, toJSON: () => ({}) } as DOMRect);

    // Select card-a
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'card-a' },
    }));

    // Press ArrowDown — should swap with next sibling (card-b)
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'ArrowDown',
    }));

    const moveEnd = posts.find((m) => m.type === 'od-edit-move-end');
    expect(moveEnd).toEqual({
      type: 'od-edit-move-end',
      id: 'card-a',
      targetId: 'card-b',
      position: 'after',
    });

    // Optimistic DOM swap: card-a should now be after card-b in the DOM
    const children = Array.from(dom.window.document.querySelector('main')!.children);
    expect(children.indexOf(cardA)).toBeGreaterThan(children.indexOf(cardB));

    // Selection should be preserved
    expect(cardA.getAttribute('data-od-edit-selected')).toBe('true');

    dom.window.close();
  });

  it('posts od-edit-move-end when ArrowUp swaps a selected element with previous sibling in flex-column', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string }> = [];
    const dom = new JSDOM(
      `<main style="display:flex;flex-direction:column">
        <div data-od-id="card-a" style="width:100px;height:40px">Card A</div>
        <div data-od-id="card-b" style="width:100px;height:40px">Card B</div>
        <div data-od-id="card-c" style="width:100px;height:40px">Card C</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as typeof posts[0]);
    }) as typeof dom.window.parent.postMessage;

    const cardA = dom.window.document.querySelector('[data-od-id="card-a"]') as HTMLElement;
    const cardB = dom.window.document.querySelector('[data-od-id="card-b"]') as HTMLElement;
    cardA.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 40, top: 0, right: 100, bottom: 40, left: 0, toJSON: () => ({}) } as DOMRect);
    cardB.getBoundingClientRect = () => ({ x: 0, y: 44, width: 100, height: 40, top: 44, right: 100, bottom: 84, left: 0, toJSON: () => ({}) } as DOMRect);

    // Select card-b
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'card-b' },
    }));

    // Press ArrowUp — should swap with previous sibling (card-a)
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'ArrowUp',
    }));

    const moveEnd = posts.find((m) => m.type === 'od-edit-move-end');
    expect(moveEnd).toEqual({
      type: 'od-edit-move-end',
      id: 'card-b',
      targetId: 'card-a',
      position: 'before',
    });

    dom.window.close();
  });

  it('posts od-edit-move-end when ArrowRight swaps in a flex-row container', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string }> = [];
    const dom = new JSDOM(
      `<main style="display:flex;flex-direction:row">
        <div data-od-id="col-a" style="width:100px;height:40px">Col A</div>
        <div data-od-id="col-b" style="width:100px;height:40px">Col B</div>
        <div data-od-id="col-c" style="width:100px;height:40px">Col C</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as typeof posts[0]);
    }) as typeof dom.window.parent.postMessage;

    const colA = dom.window.document.querySelector('[data-od-id="col-a"]') as HTMLElement;
    const colB = dom.window.document.querySelector('[data-od-id="col-b"]') as HTMLElement;
    colA.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 40, top: 0, right: 100, bottom: 40, left: 0, toJSON: () => ({}) } as DOMRect);
    colB.getBoundingClientRect = () => ({ x: 104, y: 0, width: 100, height: 40, top: 0, right: 204, bottom: 40, left: 104, toJSON: () => ({}) } as DOMRect);

    // Select col-a
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'col-a' },
    }));

    // Press ArrowRight — should swap with next sibling (col-b)
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'ArrowRight',
    }));

    const moveEnd = posts.find((m) => m.type === 'od-edit-move-end');
    expect(moveEnd).toEqual({
      type: 'od-edit-move-end',
      id: 'col-a',
      targetId: 'col-b',
      position: 'after',
    });

    dom.window.close();
  });

  it('posts od-edit-move-end when ArrowLeft swaps with previous sibling in flex-row', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string }> = [];
    const dom = new JSDOM(
      `<main style="display:flex;flex-direction:row">
        <div data-od-id="col-a" style="width:100px;height:40px">Col A</div>
        <div data-od-id="col-b" style="width:100px;height:40px">Col B</div>
        <div data-od-id="col-c" style="width:100px;height:40px">Col C</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as typeof posts[0]);
    }) as typeof dom.window.parent.postMessage;

    const colA = dom.window.document.querySelector('[data-od-id="col-a"]') as HTMLElement;
    const colB = dom.window.document.querySelector('[data-od-id="col-b"]') as HTMLElement;
    colA.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 40, top: 0, right: 100, bottom: 40, left: 0, toJSON: () => ({}) } as DOMRect);
    colB.getBoundingClientRect = () => ({ x: 104, y: 0, width: 100, height: 40, top: 0, right: 204, bottom: 40, left: 104, toJSON: () => ({}) } as DOMRect);

    // Select col-b
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'col-b' },
    }));

    // Press ArrowLeft — should swap with previous sibling (col-a)
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'ArrowLeft',
    }));

    const moveEnd = posts.find((m) => m.type === 'od-edit-move-end');
    expect(moveEnd).toEqual({
      type: 'od-edit-move-end',
      id: 'col-b',
      targetId: 'col-a',
      position: 'before',
    });

    dom.window.close();
  });

  it('does not post od-edit-move-end for arrow keys when parent is not flex', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string }> = [];
    const dom = new JSDOM(
      `<main>
        <div data-od-id="block-a" style="width:100px;height:40px">Block A</div>
        <div data-od-id="block-b" style="width:100px;height:40px">Block B</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as typeof posts[0]);
    }) as typeof dom.window.parent.postMessage;

    const blockA = dom.window.document.querySelector('[data-od-id="block-a"]') as HTMLElement;
    blockA.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 40, top: 0, right: 100, bottom: 40, left: 0, toJSON: () => ({}) } as DOMRect);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'block-a' },
    }));

    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'ArrowDown',
    }));

    expect(posts.find((m) => m.type === 'od-edit-move-end')).toBeUndefined();

    dom.window.close();
  });

  it('does not post od-edit-move-end when the selected element is the only child', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string }> = [];
    const dom = new JSDOM(
      `<main style="display:flex;flex-direction:column">
        <div data-od-id="only-child" style="width:100px;height:40px">Only</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as typeof posts[0]);
    }) as typeof dom.window.parent.postMessage;

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'only-child' },
    }));

    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, key: 'ArrowDown',
    }));

    expect(posts.find((m) => m.type === 'od-edit-move-end')).toBeUndefined();

    dom.window.close();
  });

  it('does not trigger drag on container elements when drag is disabled', () => {
    const posts: Array<{ type?: string; id?: string; targetId?: string; position?: string }> = [];
    const dom = new JSDOM(
      `<main>
        <section data-od-id="hero" style="width:200px;height:100px">Hero</section>
        <div data-od-id="content" style="width:200px;height:100px">Content</div>
      </main>${buildManualEditBridge(true)}`,
      { runScripts: 'dangerously', url: 'http://localhost' },
    );
    const hero = dom.window.document.querySelector('[data-od-id="hero"]') as HTMLElement;
    const content = dom.window.document.querySelector('[data-od-id="content"]') as HTMLElement;
    hero.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 100, top: 0, right: 200, bottom: 100, left: 0, toJSON: () => ({}) } as DOMRect);
    content.getBoundingClientRect = () => ({ x: 0, y: 100, width: 200, height: 100, top: 100, right: 200, bottom: 200, left: 0, toJSON: () => ({}) } as DOMRect);
    dom.window.parent.postMessage = ((message: unknown) => {
      posts.push(message as typeof posts[0]);
    }) as typeof dom.window.parent.postMessage;

    // Select hero
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'od-edit-selected-target', id: 'hero' },
    }));

    // Try to drag past threshold
    hero.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 50, clientY: 50,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointermove', {
      bubbles: true, clientX: 80, clientY: 150,
    }));
    dom.window.document.dispatchEvent(new dom.window.PointerEvent('pointerup', {
      bubbles: true, clientX: 80, clientY: 150,
    }));

    // Should NOT post od-edit-move-end (drag is disabled)
    expect(posts.find((m) => m.type === 'od-edit-move-end')).toBeUndefined();

    dom.window.close();
  });
});
