import { Button } from '@open-design/components';
import { ChevronDown, Minus, Plus, X, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import styles from './StylePanel.module.css';

export interface FloatingPosition {
  top: number;
  left: number;
}

export interface IconOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

export function popoverPosition(
  anchor: HTMLElement,
  width = 276,
  preferredTopOffset = 72,
  estimatedHeight = 420,
): FloatingPosition {
  const rect = anchor.getBoundingClientRect();
  return {
    top: Math.max(8, Math.min(window.innerHeight - estimatedHeight - 8, rect.top - preferredTopOffset)),
    left: Math.max(8, rect.left - width - 10),
  };
}

export function FloatingPanel({
  title,
  position,
  wide = false,
  children,
  onClose,
}: {
  title: ReactNode;
  position: FloatingPosition;
  wide?: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // Click-outside-to-close: listen on pointerdown (not click) so the panel
    // closes before any underlying element processes the click. Use rAF to
    // defer attachment so the opening click doesn't immediately trigger close.
    const onClickOutside = (event: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const raf = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', onClickOutside, true);
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onClickOutside, true);
    };
  }, [onClose]);

  const panelStyle = {
    '--popover-top': `${position.top}px`,
    '--popover-left': `${position.left}px`,
  } as CSSProperties;

  return createPortal(
    <aside
      ref={panelRef}
      className={`${styles.floatingPanel}${wide ? ` ${styles.floatingPanelWide}` : ''}`}
      style={panelStyle}
      role="dialog"
      aria-modal="false"
    >
      <header className={styles.floatingPanelHeader}>
        <strong>{title}</strong>
        <Button
          type="button"
          size="icon"
          className={styles.floatingCloseButton}
          aria-label="关闭面板"
          title="关闭面板"
          data-tooltip="关闭面板"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      <div className={styles.floatingPanelBody}>{children}</div>
    </aside>,
    document.body,
  );
}

export function IconButton({
  label,
  icon: Icon,
  active = false,
  disabled = false,
  onClick,
  placement,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  placement?: 'left';
}) {
  return (
    <Button
      type="button"
      size="icon"
      className={`${styles.iconButton}${active ? ` ${styles.iconButtonActive}` : ''}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      title={label}
      data-tooltip={label}
      data-tooltip-placement={placement}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
    </Button>
  );
}

export function IconGroup({
  options,
  value,
  onChange,
  equal = true,
}: {
  options: IconOption[];
  value: string;
  onChange: (value: string) => void;
  equal?: boolean;
}) {
  return (
    <div className={`${styles.iconGroup}${equal ? ` ${styles.iconGroupEqual}` : ''}`}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <Button
            key={option.value}
            type="button"
            size="icon"
            className={`${styles.segmentButton}${active ? ` ${styles.segmentButtonActive}` : ''}`}
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            data-tooltip={option.label}
            onClick={() => onChange(option.value)}
          >
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}

export function CompactSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.selectField}>
      <span className={styles.visuallyHidden}>{label}</span>
      <select
        className={styles.select}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function PropertySection({
  title,
  actions,
  children,
  collapsible = false,
  expanded = true,
  hasContent = true,
  onToggle,
  onAdd,
  onRemove,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  hasContent?: boolean;
  onToggle?: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  // When a collapsible section has no content it is force-collapsed: the body
  // is hidden, the chevron is suppressed (there's nothing to expand), and the
  // header click triggers onAdd so the user must add a value before the body
  // becomes available.
  const isEmpty = collapsible && !hasContent;
  const sectionClass = `${styles.section}${collapsible ? ` ${styles.sectionCollapsible}` : ''}${(collapsible && !expanded) || isEmpty ? ` ${styles.sectionCollapsed}` : ''}`;
  const headerClass = `${styles.sectionHeader}${collapsible ? ` ${styles.sectionHeaderToggle}` : ''}`;
  const showBody = collapsible ? (!isEmpty && expanded) : true;
  return (
    <section className={sectionClass} aria-labelledby={`style-panel-${title}`}>
      <header className={headerClass}>
        {collapsible ? (
          <button
            type="button"
            className={styles.sectionTitleButton}
            aria-expanded={!isEmpty && expanded}
            aria-controls={`style-panel-body-${title}`}
            onClick={() => (isEmpty ? onAdd?.() : onToggle?.())}
          >
            {!isEmpty ? (
              <ChevronDown
                size={14}
                strokeWidth={1.8}
                aria-hidden="true"
                className={`${styles.sectionChevron}${expanded ? ` ${styles.sectionChevronExpanded}` : ''}`}
              />
            ) : null}
            <span id={`style-panel-${title}`} className={styles.sectionTitle}>{title}</span>
          </button>
        ) : (
          <h3 id={`style-panel-${title}`} className={styles.sectionTitle}>{title}</h3>
        )}
        <div className={styles.sectionActions}>
          {actions}
          {isEmpty && onAdd ? (
            <IconButton
              label="添加属性"
              icon={Plus}
              placement="left"
              onClick={() => onAdd()}
            />
          ) : null}
          {!isEmpty && hasContent && onRemove ? (
            <IconButton
              label="移除属性"
              icon={Minus}
              placement="left"
              onClick={() => onRemove()}
            />
          ) : null}
        </div>
      </header>
      {showBody ? (
        <div id={`style-panel-body-${title}`} className={styles.sectionBody}>{children}</div>
      ) : null}
    </section>
  );
}

export function LabeledControl({
  label,
  children,
  inline = false,
}: {
  label: string;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={inline ? styles.labeledControlInline : styles.labeledControl}>
      <span className={styles.controlLabel}>{label}</span>
      {children}
    </div>
  );
}
