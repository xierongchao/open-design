import { useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Component, Editor } from 'grapesjs';
import styles from './CanvasContextMenu.module.css';

/**
 * The payload the canvas-doc contextmenu handler pushes into React state.
 * `components` is the ancestor chain of the right-clicked element, ordered
 * innermost → outermost (the same order a "select parent" menu shows).
 */
export interface CanvasCtxMenuState {
  components: Component[];
  /** Host-document (portal) coordinates for the menu's top-left. */
  screenX: number;
  screenY: number;
}

interface CanvasContextMenuProps {
  editor: Editor | null;
  components: Component[];
  screenX: number;
  screenY: number;
  onSelect: (component: Component) => void;
  onClose: () => void;
}

/** Build a short, human-readable label for a component (tagName + id/class). */
function componentLabel(comp: Component): string {
  let tagName = 'div';
  try { tagName = String(comp.get?.('tagName') ?? 'div'); } catch { /* ignore */ }
  let id = '';
  let cls = '';
  try {
    const attrs = comp.getAttributes() as Record<string, unknown>;
    if (typeof attrs['id'] === 'string') id = attrs['id'];
    if (typeof attrs['class'] === 'string') cls = attrs['class'];
  } catch { /* ignore */ }
  const classPart = cls ? cls.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('') : '';
  return `${tagName}${id ? `#${id}` : ''}${classPart}`;
}

/**
 * Right-click layer-stack menu. Portals into host document.body (the iframe
 * can't host React DOM safely), positioned at the host-space cursor coords.
 *
 * Behaviour:
 *   • lists the ancestor chain (innermost → outermost) of the clicked element;
 *   • hovering an item calls editor.setHovered(component) so the canvas draws
 *     the accent outline on that element;
 *   • clicking an item selects it and closes the menu;
 *   • Esc / click-outside closes the menu and clears hover.
 */
export function CanvasContextMenu({
  editor,
  components,
  screenX,
  screenY,
  onSelect,
  onClose,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoveredCompRef = useRef<Component | null>(null);

  // Esc-to-close + click-outside-to-close. Use pointerdown (capture, rAF-
  // deferred) so the opening click doesn't immediately close it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (!menu) return;
      if (menu.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const raf = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', onPointerDown, true);
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  // Clear hover on unmount so a closed menu doesn't leave a stale highlight.
  useEffect(() => {
    return () => {
      try { (editor as unknown as { setHovered?: (c: unknown) => void })?.setHovered?.(null); } catch { /* ignore */ }
      hoveredCompRef.current = null;
    };
  }, [editor]);

  const setHovered = (comp: Component | null) => {
    if (hoveredCompRef.current === comp) return;
    hoveredCompRef.current = comp;
    // useValid mirrors the native canvas hover path (CommandSelectComponent
    // calls em.setHovered(model, { useValid: true })) so non-hoverable
    // components still resolve to a hoverable ancestor and the accent
    // highlighter renders.
    try {
      (editor as unknown as { setHovered?: (c: unknown, opts?: { useValid?: boolean }) => void })
        ?.setHovered?.(comp, { useValid: true });
    } catch { /* ignore */ }
  };

  const menuStyle = {
    '--menu-top': `${Math.min(screenY, window.innerHeight - 240)}px`,
    '--menu-left': `${Math.min(screenX, window.innerWidth - 220)}px`,
  } as CSSProperties;

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={menuStyle}
      role="menu"
      aria-label="选择嵌套元素"
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className={styles.header}>选择元素</div>
      <ul className={styles.list}>
        {components.map((comp, index) => {
          const label = componentLabel(comp);
          return (
            <li key={`${index}-${label}`}>
              <button
                type="button"
                className={styles.item}
                role="menuitem"
                title={label}
                onMouseEnter={() => setHovered(comp)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(comp)}
              >
                <span className={styles.itemLabel}>{label}</span>
                {index === 0 ? <span className={styles.itemHint}>最里层</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  );
}

export default CanvasContextMenu;
