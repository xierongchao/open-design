export const MANUAL_EDIT_DISCOVERY_SELECTOR = 'main, nav, section, article, aside, header, footer, div, h1, h2, h3, h4, h5, h6, p, a, button, img, strong, em, i, small, span, ul, ol, li, dl, dt, dd, blockquote, pre, code, label, form, input, select, textarea, table, thead, tbody, tfoot, tr, th, td, figure, figcaption, details, summary';
export const MANUAL_EDIT_SOURCE_PATH_ATTR = 'data-od-source-path';
export const MANUAL_EDIT_HOST_NODE_SELECTOR = [
  '[data-od-sandbox-shim]',
  '[data-od-deck-bridge]',
  '[data-od-comment-bridge]',
  '[data-od-edit-bridge]',
  '[data-od-comment-bridge-style]',
  '[data-od-edit-bridge-style]',
  '[data-od-deck-fix]',
].join(',');

export function manualEditDomPathForElement(el: Element): string {
  const parts: number[] = [];
  let node: Element | null = el;
  while (node && node !== node.ownerDocument.body) {
    const parentEl: Element | null = node.parentElement;
    if (!parentEl) break;
    const children = Array.from(parentEl.children).filter((child) => !isManualEditHostNode(child));
    parts.unshift(children.indexOf(node));
    node = parentEl;
  }
  return parts.length ? `path-${parts.join('-')}` : '';
}

export function isManualEditHostNode(el: Element): boolean {
  return el.matches(MANUAL_EDIT_HOST_NODE_SELECTOR);
}

export function manualEditStableIdForElement(el: Element): string {
  const explicit = el.getAttribute('data-od-id');
  if (explicit) return explicit;
  const generated = el.getAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR) || el.getAttribute('data-od-runtime-id') || manualEditDomPathForElement(el);
  if (generated) el.setAttribute('data-od-runtime-id', generated);
  return generated || 'unknown';
}

export function isMeaningfulManualEditElement(el: Element, rect: Pick<DOMRect, 'width' | 'height'>): boolean {
  return isSourceMappableManualEditElement(el) && el.matches(MANUAL_EDIT_DISCOVERY_SELECTOR) && rect.width >= 4 && rect.height >= 4;
}

export function isSourceMappableManualEditElement(el: Element): boolean {
  return el.hasAttribute('data-od-id') || el.hasAttribute(MANUAL_EDIT_SOURCE_PATH_ATTR);
}

export function buildManualEditBridge(enabled: boolean): string {
  return `<script data-od-edit-bridge>(function(){
  var enabled = ${JSON.stringify(enabled)};
  var discoverySelector = ${JSON.stringify(MANUAL_EDIT_DISCOVERY_SELECTOR)};
  var hostNodeSelector = ${JSON.stringify(MANUAL_EDIT_HOST_NODE_SELECTOR)};
  var sourcePathAttr = ${JSON.stringify(MANUAL_EDIT_SOURCE_PATH_ATTR)};
  var styleProps = ['left','top','fontFamily','fontSize','fontWeight','color','textAlign','lineHeight','letterSpacing','width','height','minHeight','display','gap','columnGap','rowGap','flexDirection','flexWrap','justifyContent','alignItems','backgroundColor','backgroundImage','opacity','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','border','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','borderRadius','transform','overflow','boxShadow'];
  var viewportPanActive = false;
  var resizeHandles = [];
  var resizeState = null;
  var resizeSnapThreshold = 4;
  var dragState = null;
  var snapOverlay = null;
  var dragThreshold = 3;
  var snapThreshold = 4;
  function isHostNode(el){
    return !!(el && el.matches && el.matches(hostNodeSelector));
  }
  function domPath(el){
    var parts = [];
    var node = el;
    while (node && node !== document.body) {
      var parent = node.parentElement;
      if (!parent) break;
      var children = Array.prototype.slice.call(parent.children).filter(function(child){ return !isHostNode(child); });
      parts.unshift(children.indexOf(node));
      node = parent;
    }
    return parts.length ? 'path-' + parts.join('-') : '';
  }
  function stableId(el){
    var explicit = el.getAttribute('data-od-id');
    if (explicit) return explicit;
    var generated = el.getAttribute(sourcePathAttr) || el.getAttribute('data-od-runtime-id') || domPath(el);
    if (generated) el.setAttribute('data-od-runtime-id', generated);
    return generated || 'unknown';
  }
  function isSourceMappable(el){
    return !!(el && el.hasAttribute && (el.hasAttribute('data-od-id') || el.hasAttribute(sourcePathAttr)));
  }
  function isDiscoveryTarget(el){
    return !!(el && el.matches && el.matches(discoverySelector));
  }
  function isTextOnly(el){
    if (!el || !el.childNodes || !el.childNodes.length) return false;
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 1) return false;
    }
    var text = (el.textContent || '').trim();
    return text.length > 0;
  }
  function inferKind(el){
    var explicit = el.getAttribute('data-od-edit');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'a') return 'link';
    if (tag === 'img') return 'image';
    if (tag === 'td' || tag === 'th') return 'text';
    if (['section','main','nav','div','article','header','footer'].indexOf(tag) >= 0) return 'container';
    return 'text';
  }
  function labelFor(el, id, kind){
    var explicit = el.getAttribute('data-od-label');
    if (explicit) return explicit;
    var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, 42);
    if (kind === 'image') return el.getAttribute('alt') || id;
    return tag + ' #' + id;
  }
  function attrsFor(el){
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (!attr || attr.name.indexOf('data-od-runtime') === 0 || attr.name === 'data-od-edit-selected') continue;
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }
  function stylesFor(el){
    var computed = window.getComputedStyle(el);
    var styles = {};
    styleProps.forEach(function(prop){ styles[prop] = el.style[prop] || computed[prop] || ''; });
    return styles;
  }
  function isLayoutContainer(el){
    var display = window.getComputedStyle(el).display || '';
    if (display.indexOf('flex') >= 0 || display.indexOf('grid') >= 0) return true;
    if (inferKind(el) !== 'container') return false;
    if (hasOwnDisplayHiddenState(el)) return true;
    if (hasHiddenAncestorDisplayState(el)) return false;
    var visibility = window.getComputedStyle(el).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') return false;
    return true;
  }
  function parentLayoutFor(el){
    var parent = el && el.parentElement;
    if (!parent) return null;
    var computed = window.getComputedStyle(parent);
    var display = computed.display || '';
    if (display.indexOf('flex') < 0 && display.indexOf('grid') < 0) return null;
    return { display: display, flexDirection: computed.flexDirection || '' };
  }
  function hasOwnDisplayHiddenState(el){
    var computed = window.getComputedStyle(el);
    return computed.display === 'none' || el.hasAttribute('hidden');
  }
  function hasHiddenAncestorDisplayState(el){
    var node = el;
    while (node && node !== document.documentElement) {
      if (hasOwnDisplayHiddenState(node)) return true;
      node = node.parentElement;
    }
    return false;
  }
  function isHiddenTarget(el, rect){
    var targetVisibility = window.getComputedStyle(el).visibility;
    if (targetVisibility === 'hidden' || targetVisibility === 'collapse') return true;
    return hasHiddenAncestorDisplayState(el);
  }
  function targetFrom(el, includeOuterHtml){
    var rect = el.getBoundingClientRect();
    var kind = inferKind(el);
    var id = stableId(el);
    var hidden = isHiddenTarget(el, rect);
    var fields = {};
    if (kind === 'link') {
      fields.text = (el.textContent || '').trim();
      fields.href = el.getAttribute('href') || '';
    } else if (kind === 'image') {
      fields.src = el.getAttribute('src') || '';
      fields.alt = el.getAttribute('alt') || '';
    } else {
      fields.text = (el.textContent || '').trim();
    }
    var target = {
      id: id,
      kind: kind,
      label: labelFor(el, id, kind),
      tagName: el.tagName ? el.tagName.toLowerCase() : 'element',
      className: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 180),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      fields: fields,
      attributes: attrsFor(el),
      styles: stylesFor(el),
      isLayoutContainer: isLayoutContainer(el),
      parentId: el.parentElement ? (el.parentElement === document.body ? '__body__' : stableId(el.parentElement)) : '',
      isHidden: hidden,
      outerHtml: includeOuterHtml ? (el.outerHTML || '').replace(/\\sdata-od-runtime-id="[^"]*"/g, '').replace(/\\sdata-od-source-path="[^"]*"/g, '').replace(/\\sdata-od-edit-selected="[^"]*"/g, '') : ''
    };
    var parentLayout = parentLayoutFor(el);
    if (parentLayout) target.parentLayout = parentLayout;
    return target;
  }
  function allTargets(){
    var nodes = document.body ? document.body.querySelectorAll(discoverySelector) : [];
    var targets = [];
    for (var i = 0; i < nodes.length; i++) {
      var rect = nodes[i].getBoundingClientRect();
      if (!isSourceMappable(nodes[i])) continue;
      if (!isHiddenTarget(nodes[i], rect) && (rect.width < 4 || rect.height < 4)) continue;
      targets.push(targetFrom(nodes[i], false));
    }
    return targets;
  }
  function postTargets(){
    if (!enabled) return;
    window.parent.postMessage({ type: 'od-edit-targets', targets: allTargets() }, '*');
  }
  var spaceHeld = false;
  function isMiddleButtonPan(ev){
    return Number(ev.button) === 1 || ((Number(ev.buttons) || 0) & 4) === 4;
  }
  function isSpacePan(ev){
    return spaceHeld && Number(ev.button) === 0;
  }
  function postViewportPan(phase, ev){
    window.parent.postMessage({
      type: 'od-edit-viewport-pan',
      phase: phase,
      clientX: Number(ev.clientX) || 0,
      clientY: Number(ev.clientY) || 0,
      screenX: Number(ev.screenX) || 0,
      screenY: Number(ev.screenY) || 0
    }, '*');
  }
  var lastHoverId = null;
  var lastHoverEl = null;
  function clearHoverOutline() {
    if (lastHoverEl) { lastHoverEl.removeAttribute('data-od-edit-hover'); lastHoverEl = null; }
  }
  function setViewportPanActive(active) {
    viewportPanActive = !!active;
    document.documentElement.toggleAttribute('data-od-edit-panning', viewportPanActive);
    if (viewportPanActive) {
      lastHoverId = null;
      clearHoverOutline();
    }
  }
  function postHoverTarget(el){
    if (!enabled || !el) return;
    var id = stableId(el);
    if (id === lastHoverId) return;
    lastHoverId = id;
    clearHoverOutline();
    el.setAttribute('data-od-edit-hover', 'true');
    lastHoverEl = el;
    window.parent.postMessage({ type: 'od-edit-hover', target: targetFrom(el, true) }, '*');
  }
  function clearSelectedTarget(){
    var selected = document.querySelectorAll('[data-od-edit-selected]');
    for (var i = 0; i < selected.length; i++) selected[i].removeAttribute('data-od-edit-selected');
    removeResizeHandles();
  }
  function setSelectedTargets(ids){
    clearSelectedTarget();
    if (!ids || !ids.length) return;
    var first = null;
    for (var i = 0; i < ids.length; i++) {
      var el = findById(ids[i]);
      if (!el) continue;
      if (!first) first = el;
      el.setAttribute('data-od-edit-selected', 'true');
    }
    if (first && ids.length === 1) createResizeHandles(first);
  }
  function setSelectedTarget(id){
    setSelectedTargets(id ? [id] : []);
  }
  function removeResizeHandles(){
    for (var i = 0; i < resizeHandles.length; i++) {
      var h = resizeHandles[i];
      if (h.parentNode) h.parentNode.removeChild(h);
    }
    resizeHandles = [];
  }
  function createResizeHandles(el){
    removeResizeHandles();
    var rect = el.getBoundingClientRect();
    var edges = ['top','right','bottom','left'];
    var size = 8;
    var half = size / 2;
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i];
      var handle = document.createElement('div');
      handle.setAttribute('data-od-resize-handle', edge);
      handle.style.position = 'fixed';
      handle.style.width = size + 'px';
      handle.style.height = size + 'px';
      handle.style.background = 'white';
      handle.style.border = '1.5px solid #2563eb';
      handle.style.borderRadius = '1px';
      handle.style.zIndex = '100000';
      handle.style.boxSizing = 'border-box';
      if (edge === 'top' || edge === 'bottom') handle.style.cursor = 'ns-resize';
      else handle.style.cursor = 'ew-resize';
      positionResizeHandle(handle, edge, rect);
      document.body.appendChild(handle);
      resizeHandles.push(handle);
      (function(h, e) {
        h.addEventListener('pointerdown', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var startRect = el.getBoundingClientRect();
          var startX = ev.clientX;
          var startY = ev.clientY;
          var startWidth = startRect.width;
          var startHeight = startRect.height;
          var computed = window.getComputedStyle(el);
          var startW = parseFloat(computed.width) || startWidth;
          var startH = parseFloat(computed.height) || startHeight;
          function onMove(me) {
            var dx = me.clientX - startX;
            var dy = me.clientY - startY;
            if (e === 'right') {
              var nw = Math.max(4, startW + dx);
              el.style.width = nw + 'px';
            } else if (e === 'bottom') {
              var nh = Math.max(4, startH + dy);
              el.style.height = nh + 'px';
            } else if (e === 'left') {
              var nw2 = Math.max(4, startW - dx);
              el.style.width = nw2 + 'px';
            } else if (e === 'top') {
              var nh2 = Math.max(4, startH - dy);
              el.style.height = nh2 + 'px';
            }
            var newRect = el.getBoundingClientRect();
            for (var j = 0; j < resizeHandles.length; j++) {
              positionResizeHandle(resizeHandles[j], resizeHandles[j].getAttribute('data-od-resize-handle'), newRect);
            }
          }
          function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            var finalRect = el.getBoundingClientRect();
            var id = stableId(el);
            var styles = {};
            if (e === 'left' || e === 'right') styles.width = Math.round(finalRect.width) + 'px';
            if (e === 'top' || e === 'bottom') styles.height = Math.round(finalRect.height) + 'px';
            window.parent.postMessage({ type: 'od-edit-resize-end', id: id, styles: styles }, '*');
            // Reposition handles to final rect
            var endRect = el.getBoundingClientRect();
            for (var k = 0; k < resizeHandles.length; k++) {
              positionResizeHandle(resizeHandles[k], resizeHandles[k].getAttribute('data-od-resize-handle'), endRect);
            }
          }
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onUp);
        });
      })(handle, edge);
    }
  }
  function positionResizeHandle(handle, edge, rect) {
    var half = 4;
    if (edge === 'top') {
      handle.style.left = (rect.left + rect.width / 2 - half) + 'px';
      handle.style.top = (rect.top - half) + 'px';
    } else if (edge === 'bottom') {
      handle.style.left = (rect.left + rect.width / 2 - half) + 'px';
      handle.style.top = (rect.bottom - half) + 'px';
    } else if (edge === 'left') {
      handle.style.left = (rect.left - half) + 'px';
      handle.style.top = (rect.top + rect.height / 2 - half) + 'px';
    } else if (edge === 'right') {
      handle.style.left = (rect.right - half) + 'px';
      handle.style.top = (rect.top + rect.height / 2 - half) + 'px';
    }
  }
  function refreshResizeHandles(el) {
    if (!el || !resizeHandles.length) return;
    var rect = el.getBoundingClientRect();
    for (var i = 0; i < resizeHandles.length; i++) {
      positionResizeHandle(resizeHandles[i], resizeHandles[i].getAttribute('data-od-resize-handle'), rect);
    }
  }
  function closestTarget(event){
    var el = event.target;
    while (el && el !== document.documentElement) {
      if (el !== document.body && el !== document.documentElement && isDiscoveryTarget(el)) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }
  function caretRangeFromClick(clickEvent){
    try {
      if (document.caretPositionFromPoint) {
        var position = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
        if (!position) return null;
        var positionRange = document.createRange();
        positionRange.setStart(position.offsetNode, position.offset);
        positionRange.collapse(true);
        return positionRange;
      }
      if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
      }
    } catch (e) {}
    return null;
  }
  function placeCaretFromClick(clickEvent, el){
    var range = caretRangeFromClick(clickEvent);
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    try {
      var sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }
  function makeEditable(el, clickEvent){
    if (!el || el.getAttribute('contenteditable') === 'true') return;
    var originalText = el.textContent || '';
    clearSelectedTarget();
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('data-od-editing', 'true');
    try { el.focus(); } catch (e) {}
    placeCaretFromClick(clickEvent, el);
    function finish(commit){
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-od-editing');
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      var value = (el.textContent || '').trim();
      if (commit && value !== originalText.trim()) {
        window.parent.postMessage({
          type: 'od-edit-text-commit',
          id: stableId(el),
          value: value
        }, '*');
      } else if (!commit) {
        el.textContent = originalText;
      }
    }
    function onBlur(){ finish(true); }
    function onKey(ev){
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
        try { el.blur(); } catch (e) {}
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
        try { el.blur(); } catch (e) {}
      }
    }
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
  }
  function camelToKebab(name){ return String(name).replace(/[A-Z]/g, function(m){ return '-' + m.toLowerCase(); }); }
  function cssEscapeId(value){ if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value); return String(value).replace(/"/g, '\\\\"'); }
  function findById(id){
    if (!id) return null;
    if (id === '__body__') return document.body;
    var el = document.querySelector('[data-od-id="' + cssEscapeId(id) + '"]')
          || document.querySelector('[data-od-runtime-id="' + cssEscapeId(id) + '"]')
          || document.querySelector('[' + sourcePathAttr + '="' + cssEscapeId(id) + '"]');
    if (el) return el;
    if (typeof id === 'string' && id.indexOf('path-') === 0) {
      var parts = id.slice('path-'.length).split('-').map(function(s){ return Number(s); });
      var node = document.body;
      for (var i = 0; i < parts.length; i++) {
        if (!node) return null;
        var idx = parts[i];
        if (!Number.isInteger(idx) || idx < 0) return null;
        var children = Array.prototype.slice.call(node.children).filter(function(c){ return !isHostNode(c); });
        node = children[idx] || null;
      }
      return node;
    }
    return null;
  }
  function applyPreviewStyles(id, styles, version){
    var el = findById(id);
    if (!el) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id || '', version: Number(version) || 0, ok: false, error: 'Target not found' }, '*');
      return;
    }
    var keys = Object.keys(styles || {});
    try {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = styles[key];
        var cssName = camelToKebab(key);
        if (typeof value !== 'string' || value.trim() === '') el.style.removeProperty(cssName);
        else el.style.setProperty(cssName, value.trim());
      }
      if (el.hasAttribute('data-od-edit-selected')) refreshResizeHandles(el);
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: true }, '*');
    } catch (e) {
      window.parent.postMessage({ type: 'od-edit-preview-style-applied', id: id, version: Number(version) || 0, ok: false, error: e && e.message ? String(e.message) : 'Could not apply preview styles' }, '*');
    }
  }
  window.addEventListener('message', function(ev){
    if (!ev.data) return;
    if (ev.data.type === 'od-edit-mode') {
      enabled = !!ev.data.enabled;
      document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
      if (!enabled) { setViewportPanActive(false); clearSelectedTarget(); clearHoverOutline(); }
      if (enabled) setTimeout(postTargets, 0);
      return;
    }
    if (ev.data.type === 'od-edit-selected-target') {
      setSelectedTarget(ev.data.id || null);
      return;
    }
    if (ev.data.type === 'od-edit-selected-targets') {
      setSelectedTargets(Array.isArray(ev.data.ids) ? ev.data.ids : []);
      return;
    }
    if (ev.data.type === 'od-edit-hover-reset') {
      // Host signals the cursor truly left the canvas, so the next pointerover
      // re-announces the hovered element (defeats the per-element dedupe).
      lastHoverId = null;
      clearHoverOutline();
      return;
    }
    if (ev.data.type === 'od-edit-preview-style') {
      applyPreviewStyles(ev.data.id, ev.data.styles || {}, ev.data.version);
      return;
    }
  });
  var wasDrag = false;
  function removeSnapOverlay() {
    if (snapOverlay && snapOverlay.parentNode) snapOverlay.parentNode.removeChild(snapOverlay);
    snapOverlay = null;
  }
  function showSnapGuides(guideLines) {
    if (!snapOverlay) {
      snapOverlay = document.createElement('div');
      snapOverlay.setAttribute('data-od-snap-overlay', '');
      snapOverlay.style.cssText = 'pointer-events:none;position:fixed;inset:0;z-index:99999;';
      document.body.appendChild(snapOverlay);
    }
    snapOverlay.innerHTML = '';
    for (var i = 0; i < guideLines.length; i++) {
      var g = guideLines[i];
      var line = document.createElement('div');
      line.style.cssText = 'position:absolute;background:#f59e0b;';
      if (g.dir === 'h') {
        line.style.height = '1px';
        line.style.left = g.x1 + 'px';
        line.style.width = (g.x2 - g.x1) + 'px';
        line.style.top = g.y + 'px';
      } else {
        line.style.width = '1px';
        line.style.top = g.y1 + 'px';
        line.style.height = (g.y2 - g.y1) + 'px';
        line.style.left = g.x + 'px';
      }
      snapOverlay.appendChild(line);
    }
  }
  function collectSnapEdges() {
    var edges = [];
    var nodes = document.body.querySelectorAll(discoverySelector);
    var selected = document.querySelector('[data-od-edit-selected]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === selected) continue;
      var r = nodes[i].getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      edges.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 });
    }
    return edges;
  }
  function findSnap(proposedRect, snapEdges) {
    var guides = [];
    var snappedX = proposedRect.left;
    var snappedY = proposedRect.top;
    var pLeft = proposedRect.left, pRight = proposedRect.right;
    var pTop = proposedRect.top, pBottom = proposedRect.bottom;
    var pCX = proposedRect.left + (proposedRect.right - proposedRect.left) / 2;
    var pCY = proposedRect.top + (proposedRect.bottom - proposedRect.top) / 2;
    var bestDx = snapThreshold + 1;
    var bestDy = snapThreshold + 1;
    var snapValueX = null;
    var snapValueY = null;
    for (var i = 0; i < snapEdges.length; i++) {
      var e = snapEdges[i];
      // Horizontal snap (left/right edges and center)
      var checks = [
        { val: pLeft, to: e.left }, { val: pLeft, to: e.right },
        { val: pRight, to: e.left }, { val: pRight, to: e.right },
        { val: pCX, to: e.centerX }
      ];
      for (var j = 0; j < checks.length; j++) {
        var d = Math.abs(checks[j].val - checks[j].to);
        if (d < snapThreshold && d < bestDx) {
          bestDx = d;
          snapValueX = checks[j].to - checks[j].val;
        }
      }
      // Vertical snap (top/bottom edges and center)
      var vChecks = [
        { val: pTop, to: e.top }, { val: pTop, to: e.bottom },
        { val: pBottom, to: e.top }, { val: pBottom, to: e.bottom },
        { val: pCY, to: e.centerY }
      ];
      for (var k = 0; k < vChecks.length; k++) {
        var dv = Math.abs(vChecks[k].val - vChecks[k].to);
        if (dv < snapThreshold && dv < bestDy) {
          bestDy = dv;
          snapValueY = vChecks[k].to - vChecks[k].val;
        }
      }
    }
    return { dx: snapValueX, dy: snapValueY, guides: guides };
  }
  var dropPreviewEl = null;
  function clearDropPreview(){
    if (dropPreviewEl) {
      dropPreviewEl.removeAttribute('data-od-reorder-target');
      dropPreviewEl.removeAttribute('data-od-reorder-position');
      dropPreviewEl = null;
    }
  }
  function setDropPreview(drop){
    clearDropPreview();
    if (!drop || !drop.el) return;
    dropPreviewEl = drop.el;
    dropPreviewEl.setAttribute('data-od-reorder-target', 'true');
    dropPreviewEl.setAttribute('data-od-reorder-position', drop.position);
  }
  function dropAxisFor(target){
    var parent = target && target.parentElement;
    if (!parent) return 'y';
    var computed = window.getComputedStyle(parent);
    var display = computed.display || '';
    var direction = computed.flexDirection || '';
    if (display.indexOf('flex') >= 0 && direction.indexOf('row') === 0) return 'x';
    if (display.indexOf('grid') >= 0 && (computed.gridAutoFlow || '').indexOf('column') >= 0) return 'x';
    return 'y';
  }
  function findDropTarget(dragged, clientX, clientY){
    var nodes = document.body ? document.body.querySelectorAll(discoverySelector) : [];
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || node === dragged) continue;
      if (!isDiscoveryTarget(node)) continue;
      if (dragged && dragged.contains && dragged.contains(node)) continue;
      var rect = node.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      var area = rect.width * rect.height;
      if (!best || area < best.area) best = { el: node, rect: rect, area: area };
    }
    if (!best) return null;
    var axis = dropAxisFor(best.el);
    var position = axis === 'x'
      ? (clientX >= best.rect.left + best.rect.width / 2 ? 'after' : 'before')
      : (clientY >= best.rect.top + best.rect.height / 2 ? 'after' : 'before');
    return { el: best.el, id: stableId(best.el), position: position };
  }
  document.addEventListener('click', function(ev){
    if (!enabled) return;
    if (spaceHeld) return;
    if (wasDrag) { wasDrag = false; return; }
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    ev.preventDefault();
    ev.stopPropagation();
    var el = closestTarget(ev);
    if (!el) {
      window.parent.postMessage({ type: 'od-edit-background' }, '*');
      return;
    }
    var id = stableId(el);
    var currentlySelected = document.querySelector('[data-od-edit-selected]');
    if (currentlySelected && stableId(currentlySelected) === id && !ev.shiftKey) {
      clearSelectedTarget();
      window.parent.postMessage({ type: 'od-edit-deselect' }, '*');
      return;
    }
    var kind = inferKind(el);
    var isTextOnlyDiv = el.tagName && el.tagName.toLowerCase() === 'div' && isTextOnly(el);
    var shouldEdit = kind === 'text' || kind === 'link' || isTextOnlyDiv;
    if (ev.shiftKey) {
      if (el.hasAttribute('data-od-edit-selected')) el.removeAttribute('data-od-edit-selected');
      else el.setAttribute('data-od-edit-selected', 'true');
      removeResizeHandles();
    } else {
      setSelectedTarget(id);
    }
    var selectMessage = { type: 'od-edit-select', target: targetFrom(el, true) };
    if (ev.shiftKey) selectMessage.append = true;
    window.parent.postMessage(selectMessage, '*');
    if (!ev.shiftKey && shouldEdit) {
      makeEditable(el, ev);
      return;
    }
  }, true);
  document.addEventListener('pointerdown', function(ev){
    if (!enabled) return;
    if (isMiddleButtonPan(ev) || spaceHeld) return;
    if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-od-resize-handle')) return;
    var el = closestTarget(ev);
    if (!el) return;
    var selected = document.querySelector('[data-od-edit-selected]');
    if (!selected || el !== selected) return;
    var kind = inferKind(el);
    if (kind === 'text' || kind === 'link') return;
    ev.preventDefault();
    var startX = ev.clientX;
    var startY = ev.clientY;
    var startRect = el.getBoundingClientRect();
    var isDragging = false;
    var snapEdges = collectSnapEdges();
    var ownerDoc = el.ownerDocument || document;
    var latestDx = 0;
    var latestDy = 0;
    var lastClientX = startX;
    var lastClientY = startY;
    var activeDrop = null;
    function onMove(me) {
      var dx = me.clientX - startX;
      var dy = me.clientY - startY;
      if (!isDragging && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
        isDragging = true;
        el.setAttribute('data-od-edit-dragging', 'true');
      }
      if (!isDragging) return;
      me.preventDefault();
      var newLeft = startRect.left + dx;
      var newTop = startRect.top + dy;
      var w = startRect.right - startRect.left;
      var h = startRect.bottom - startRect.top;
      var proposedRect = { left: newLeft, right: newLeft + w, top: newTop, bottom: newTop + h };
      var snap = findSnap(proposedRect, snapEdges);
      var finalDx = dx + (snap.dx || 0);
      var finalDy = dy + (snap.dy || 0);
      latestDx = finalDx;
      latestDy = finalDy;
      lastClientX = me.clientX;
      lastClientY = me.clientY;
      el.style.transform = 'translate(' + finalDx + 'px,' + finalDy + 'px)';
      activeDrop = findDropTarget(el, me.clientX, me.clientY);
      setDropPreview(activeDrop);
      // Update resize handles position
      var visRect = { left: startRect.left + finalDx, top: startRect.top + finalDy,
        right: startRect.right + finalDx, bottom: startRect.bottom + finalDy };
      for (var i = 0; i < resizeHandles.length; i++) {
        positionResizeHandle(resizeHandles[i], resizeHandles[i].getAttribute('data-od-resize-handle'), visRect);
      }
    }
    function onUp(upEvent) {
      ownerDoc.removeEventListener('pointermove', onMove, true);
      ownerDoc.removeEventListener('pointerup', onUp, true);
      ownerDoc.removeEventListener('pointercancel', onUp, true);
      el.removeAttribute('data-od-edit-dragging');
      if (isDragging) {
        wasDrag = true;
        if (upEvent) {
          lastClientX = Number(upEvent.clientX) || lastClientX;
          lastClientY = Number(upEvent.clientY) || lastClientY;
        }
        var drop = activeDrop || findDropTarget(el, lastClientX, lastClientY);
        el.style.transform = '';
        clearDropPreview();
        if (drop && drop.id) {
          window.parent.postMessage({
            type: 'od-edit-move-end',
            id: stableId(el),
            targetId: drop.id,
            position: drop.position
          }, '*');
        }
        removeSnapOverlay();
        // Re-position resize handles after clearing the transient transform.
        var endRect = { left: startRect.left + latestDx, top: startRect.top + latestDy,
          right: startRect.right + latestDx, bottom: startRect.bottom + latestDy,
          width: startRect.width, height: startRect.height };
        for (var k = 0; k < resizeHandles.length; k++) {
          positionResizeHandle(resizeHandles[k], resizeHandles[k].getAttribute('data-od-resize-handle'), endRect);
        }
      }
    }
    ownerDoc.addEventListener('pointermove', onMove, true);
    ownerDoc.addEventListener('pointerup', onUp, true);
    ownerDoc.addEventListener('pointercancel', onUp, true);
  }, true);
  document.addEventListener('pointerdown', function(ev){
    if (!enabled) return;
    if (!isMiddleButtonPan(ev) && !isSpacePan(ev)) return;
    setViewportPanActive(true);
    ev.preventDefault();
    ev.stopPropagation();
    try {
      var captureTarget = ev.target && ev.target.setPointerCapture ? ev.target : document.documentElement;
      if (captureTarget && captureTarget.setPointerCapture && ev.pointerId !== undefined) captureTarget.setPointerCapture(ev.pointerId);
    } catch (e) {}
    postViewportPan('start', ev);
  }, true);
  document.addEventListener('pointermove', function(ev){
    if (!enabled || !viewportPanActive) return;
    ev.preventDefault();
    ev.stopPropagation();
    postViewportPan('move', ev);
  }, true);
  function finishViewportPan(ev){
    if (!viewportPanActive) return;
    setViewportPanActive(false);
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    try {
      var releaseTarget = ev && ev.target && ev.target.releasePointerCapture ? ev.target : document.documentElement;
      if (releaseTarget && releaseTarget.releasePointerCapture && ev && ev.pointerId !== undefined) releaseTarget.releasePointerCapture(ev.pointerId);
    } catch (e) {}
    if (ev) postViewportPan('end', ev);
  }
  document.addEventListener('pointerup', finishViewportPan, true);
  document.addEventListener('pointercancel', finishViewportPan, true);
  document.addEventListener('keydown', function(ev){
    if (!enabled) return;
    if (ev.key === ' ' && !ev.repeat) {
      var tag = ev.target && ev.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      ev.preventDefault();
      spaceHeld = true;
      document.documentElement.style.cursor = 'grab';
      window.parent.postMessage({ type: 'od-edit-space-held' }, '*');
    }
  }, true);
  document.addEventListener('keyup', function(ev){
    if (ev.key === ' ') {
      spaceHeld = false;
      document.documentElement.style.cursor = '';
      window.parent.postMessage({ type: 'od-edit-space-released' }, '*');
      if (viewportPanActive) finishViewportPan(null);
    }
  }, true);
  document.addEventListener('pointerover', function(ev){
    if (!enabled) return;
    if (viewportPanActive) return;
    if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-od-resize-handle')) return;
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    var el = closestTarget(ev);
    if (!el) return;
    // Only show hover on the deepest (event target) element, not parent containers.
    // If the actual event target is inside the matched element but is itself a valid target,
    // skip this hover — the deeper element's own pointerover will handle it.
    var target = ev.target;
    if (target && target !== el && target.closest && isDiscoveryTarget(target)) return;
    postHoverTarget(el);
  }, true);
  document.addEventListener('pointerout', function(ev){
    if (!enabled) return;
    if (viewportPanActive) return;
    if (!lastHoverEl) return;
    if (ev.target === lastHoverEl || (ev.target && ev.target.contains && ev.target.contains(lastHoverEl))) {
      clearHoverOutline();
      lastHoverId = null;
    }
  }, true);
  document.addEventListener('wheel', function(ev){
    if (!enabled) return;
    if (!ev.metaKey && !ev.ctrlKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    window.parent.postMessage({
      type: 'od-edit-viewport-wheel',
      clientX: Number(ev.clientX) || 0,
      clientY: Number(ev.clientY) || 0,
      deltaY: Number(ev.deltaY) || 0
    }, '*');
  }, { capture: true, passive: false });
  document.addEventListener('keydown', function(ev){
    if (!enabled) return;
    if (ev.target && ev.target.closest && ev.target.closest('[data-od-editing="true"]')) return;
    var mod = ev.metaKey || ev.ctrlKey;
    if (mod) {
      if (ev.key === 'z' && !ev.shiftKey) {
        ev.preventDefault();
        window.parent.postMessage({ type: 'od-edit-undo' }, '*');
      }
      if ((ev.key === 'z' && ev.shiftKey) || ev.key === 'y') {
        ev.preventDefault();
        window.parent.postMessage({ type: 'od-edit-redo' }, '*');
      }
      return;
    }
    if (ev.key === 'Escape') {
      var selected = document.querySelector('[data-od-edit-selected]');
      if (selected) {
        ev.preventDefault();
        clearSelectedTarget();
        window.parent.postMessage({ type: 'od-edit-deselect' }, '*');
      }
    }
  }, true);
  window.addEventListener('resize', postTargets);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postTargets);
  else setTimeout(postTargets, 0);
  document.documentElement.toggleAttribute('data-od-edit-mode', enabled);
})();</script>`;
}

export function buildManualEditBridgeStyle(): string {
  return `<style data-od-edit-bridge-style>
html[data-od-edit-mode] body * { cursor: pointer !important; }
html[data-od-edit-mode][data-od-edit-panning] body * { cursor: grabbing !important; }
html[data-od-edit-mode] [data-od-edit-hover] {
  outline: 2px solid rgba(37, 99, 235, 0.5);
  outline-offset: 0;
}
html[data-od-edit-mode] td[data-od-edit-hover],
html[data-od-edit-mode] th[data-od-edit-hover] {
  outline: none;
  box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.5);
}
html[data-od-edit-mode] [data-od-edit-selected] {
  outline: 2px solid #2563eb !important;
  outline-offset: 0;
  cursor: move;
}
html[data-od-edit-mode] td[data-od-edit-selected],
html[data-od-edit-mode] th[data-od-edit-selected] {
  outline: none !important;
  box-shadow: inset 0 0 0 2px #2563eb;
  cursor: move;
}
html[data-od-edit-mode] [data-od-edit-dragging],
html[data-od-edit-mode] [data-od-edit-dragging] * {
  cursor: move !important;
}
html[data-od-edit-mode] [data-od-reorder-target] {
  outline: 2px solid rgba(37, 99, 235, 0.8) !important;
  outline-offset: 4px;
  transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1), outline-offset 180ms cubic-bezier(0.23, 1, 0.32, 1);
}
html[data-od-edit-mode] [data-od-editing="true"] {
  outline: 2px solid #2563eb !important;
  outline-offset: 2px;
  background: rgba(37, 99, 235, 0.06);
  cursor: text !important;
}
</style>`;
}
