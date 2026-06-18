import {
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import styles from './StylePanel.module.css';

export function pxToNum(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const match = String(value).match(/^(-?[\d.]+)/);
  return match?.[1] ? Number.parseFloat(match[1]) : fallback;
}

export function fieldDisplay(value: string, fallback = 0): string {
  const number = pxToNum(value, fallback);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

export function NumberScrub({
  label,
  value,
  prefix,
  unit,
  step = 1,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  prefix?: ReactNode;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
}) {
  const prefixRef = useRef<HTMLSpanElement | null>(null);
  const display = useMemo(() => fieldDisplay(value), [value]);

  const clamp = useCallback((number: number) => {
    if (min !== undefined && number < min) return min;
    if (max !== undefined && number > max) return max;
    return number;
  }, [max, min]);

  const commit = useCallback((number: number) => {
    const next = clamp(number);
    onChange(unit ? `${next}${unit}` : String(next));
    return next;
  }, [clamp, onChange, unit]);

  const onPrefixPointerDown = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startValue = Number(display) || 0;
    let lastCommitted = startValue;
    const ownerDocument = prefixRef.current?.ownerDocument ?? document;
    const onMove = (moveEvent: PointerEvent) => {
      const raw = Math.round((moveEvent.clientX - startX) / 3);
      if (raw === 0) return;
      const multiplier = moveEvent.shiftKey ? 5 : 1;
      const next = clamp(startValue + raw * step * multiplier);
      if (Object.is(next, lastCommitted)) return;
      lastCommitted = commit(next);
    };
    const onUp = () => {
      ownerDocument.removeEventListener('pointermove', onMove);
      ownerDocument.removeEventListener('pointerup', onUp);
      ownerDocument.removeEventListener('pointercancel', onUp);
    };
    ownerDocument.addEventListener('pointermove', onMove);
    ownerDocument.addEventListener('pointerup', onUp);
    ownerDocument.addEventListener('pointercancel', onUp);
  }, [clamp, commit, display, step]);

  return (
    <label className={styles.numberField}>
      {prefix ? (
        <span
          ref={prefixRef}
          className={styles.fieldPrefix}
          title={`${label}，拖拽调整`}
          data-tooltip={`${label}，拖拽调整`}
          onPointerDown={onPrefixPointerDown}
        >
          {prefix}
        </span>
      ) : null}
      <input
        type="number"
        className={styles.numberInput}
        aria-label={label}
        value={display}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          const number = Number(event.target.value);
          if (Number.isFinite(number)) commit(number);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const direction = event.key === 'ArrowUp' ? 1 : -1;
          commit((Number(display) || 0) + direction * step * (event.shiftKey ? 5 : 1));
        }}
      />
      {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
    </label>
  );
}
