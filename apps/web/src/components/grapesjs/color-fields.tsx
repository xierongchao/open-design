import { Button } from '@open-design/components';
import {
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  useEffect,
  useState,
  type CSSProperties,
} from 'react';

import {
  parseCssColor,
  rgbaToCss,
} from './color-utils';
import styles from './StylePanel.module.css';

export function cssColorToHex(value: string | undefined): string {
  if (!value) return '#000000';
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return value.startsWith('#') ? value.slice(0, 7).toUpperCase() : '#000000';
  const hex = (part: string) => Number.parseInt(part, 10).toString(16).padStart(2, '0');
  return `#${hex(match[1] ?? '0')}${hex(match[2] ?? '0')}${hex(match[3] ?? '0')}`.toUpperCase();
}

export function normalizeTypedCssColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(none|transparent)$/i.test(trimmed)) return 'transparent';
  if (/^#?[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(trimmed)) {
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    return rgbaToCss(parseCssColor(withHash));
  }
  if (/^(?:rgba?|hsla?)\(/i.test(trimmed)) {
    return rgbaToCss(parseCssColor(trimmed));
  }
  return null;
}

/**
 * Shared manual color entry field for fill, text, stroke, shadow, and
 * selected-color replacement. Local draft state lets users type incomplete
 * values without immediately losing focus or clobbering their input.
 */
export function ColorTextInput({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (css: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const displayHex = cssColorToHex(value).replace('#', '');
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    setLocal(null);
  }, [value]);

  const fieldValue = local ?? displayHex;

  return (
    <input
      type="text"
      className={className ?? styles.hexInput}
      aria-label={ariaLabel}
      value={fieldValue}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => {
        const raw = event.target.value;
        setLocal(raw);
        const normalized = normalizeTypedCssColor(raw);
        if (normalized) onChange(normalized);
      }}
      onBlur={() => {
        if (local == null) return;
        const normalized = normalizeTypedCssColor(local);
        if (normalized) onChange(normalized);
        setLocal(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setLocal(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function ColorProperty({
  label,
  value,
  visible,
  onChange,
  onVisibleChange,
  onOpenPicker,
}: {
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onVisibleChange: (visible: boolean) => void;
  onOpenPicker?: (anchor: HTMLButtonElement) => void;
}) {
  const hex = cssColorToHex(value);
  return (
    <div className={styles.colorProperty}>
      <label className={styles.colorValue}>
        <span className={styles.visuallyHidden}>{label}</span>
        <button
          type="button"
          className={styles.colorPicker}
          aria-label={`${label}取色器`}
          title={`编辑${label}`}
          data-tooltip={`编辑${label}`}
          style={{ '--swatch-color': hex } as CSSProperties}
          onClick={(event) => onOpenPicker?.(event.currentTarget)}
        />
        <ColorTextInput
          value={value}
          onChange={onChange}
          ariaLabel={`${label}颜色值`}
        />
        <span className={styles.colorOpacity}>{Math.round(parseCssColor(value).a * 100)}</span>
        <span className={styles.percent}>%</span>
      </label>
      <Button
        type="button"
        size="icon"
        className={`${styles.iconButton}${visible ? ` ${styles.iconButtonActive}` : ''}`}
        aria-label={visible ? `隐藏${label}` : `显示${label}`}
        aria-pressed={visible}
        title={visible ? `隐藏${label}` : `显示${label}`}
        data-tooltip={visible ? `隐藏${label}` : `显示${label}`}
        data-tooltip-placement="left"
        onClick={() => onVisibleChange(!visible)}
      >
        {visible ? <Eye size={16} strokeWidth={1.8} aria-hidden="true" /> : <EyeOff size={16} strokeWidth={1.8} aria-hidden="true" />}
      </Button>
    </div>
  );
}

export function SelectedColor({
  color,
  batchMode,
  selected,
  onToggle,
  onOpenPicker,
  onColorChange,
}: {
  color: string;
  batchMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpenPicker: (anchor: HTMLButtonElement) => void;
  onColorChange?: (value: string) => void;
}) {
  return (
    <div className={`${styles.selectedColor}${batchMode ? ` ${styles.selectedColorBatch}` : ''}`}>
      {batchMode ? (
        <input type="checkbox" aria-label={`选择颜色 ${cssColorToHex(color)}`} checked={selected} onChange={onToggle} />
      ) : null}
      <button
        type="button"
        className={styles.selectedSwatch}
        style={{ '--swatch-color': color } as CSSProperties}
        aria-label={`编辑颜色 ${cssColorToHex(color)}`}
        title={`编辑颜色 ${cssColorToHex(color)}`}
        onClick={(event) => onOpenPicker(event.currentTarget)}
      />
      <ColorTextInput
        value={color}
        onChange={(value) => onColorChange?.(value)}
        className={styles.selectedHex}
        ariaLabel={`颜色值 ${cssColorToHex(color)}`}
      />
      <span className={styles.selectedOpacity}>{Math.round(parseCssColor(color).a * 100)}</span>
      <span className={styles.percent}>%</span>
    </div>
  );
}
