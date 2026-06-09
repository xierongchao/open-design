import { useCallback, useEffect, useRef, useState } from 'react';

export interface GradientStop {
  id: string;
  color: string;
  position: number; // 0–100
}

export interface GradientValue {
  type: 'linear' | 'radial';
  angle: number; // degrees, only used for linear
  stops: GradientStop[];
}

let nextStopId = 1;

export function createDefaultGradient(): GradientValue {
  return {
    type: 'linear',
    angle: 90,
    stops: [
      { id: `gs-${nextStopId++}`, color: '#3b82f6', position: 0 },
      { id: `gs-${nextStopId++}`, color: '#ec4899', position: 100 },
    ],
  };
}

export function gradientToCss(g: GradientValue): string {
  const stops = [...g.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${s.position}%`)
    .join(', ');
  if (g.type === 'radial') return `radial-gradient(circle, ${stops})`;
  return `linear-gradient(${g.angle}deg, ${stops})`;
}

const GRADIENT_RE = /^(linear|radial)-gradient\(\s*(.*)\s*\)$/i;

export function parseGradientCss(css: string): GradientValue | null {
  const trimmed = css.trim();
  const m = trimmed.match(GRADIENT_RE);
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  const inner = m[2]!.trim();

  let type: 'linear' | 'radial' = 'linear';
  let angle = 90;
  let stopsStr = inner;

  if (kind === 'radial') {
    type = 'radial';
    // radial-gradient(circle, ...)
    const circleMatch = stopsStr.match(/^circle\s*,\s*(.*)$/i);
    if (circleMatch) stopsStr = circleMatch[1]!.trim();
  } else {
    // linear-gradient(90deg, ...) or linear-gradient(to right, ...)
    const degMatch = stopsStr.match(/^(\d+(?:\.\d+)?)deg\s*,\s*(.*)$/i);
    if (degMatch) {
      angle = Number(degMatch[1]);
      stopsStr = degMatch[2]!.trim();
    } else {
      const dirMap: Record<string, number> = {
        'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
        'to top right': 45, 'to bottom right': 135,
        'to bottom left': 225, 'to top left': 315,
      };
      const dirMatch = stopsStr.match(/^(to\s+[\w\s]+?)\s*,\s*(.*)$/i);
      if (dirMatch && dirMap[dirMatch[1]!.toLowerCase()] !== undefined) {
        angle = dirMap[dirMatch[1]!.toLowerCase()]!;
        stopsStr = dirMatch[2]!.trim();
      }
    }
  }

  const stops = parseGradientStops(stopsStr);
  if (!stops || stops.length < 2) return null;

  return { type, angle, stops };
}

function parseGradientStops(s: string): GradientStop[] | null {
  // Split by comma, but respect parentheses (for rgba(...))
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  if (parts.length < 2) return null;

  return parts.map((part, idx) => {
    const m = part.match(/^(.+?)\s+(\d+(?:\.\d+)?)%$/);
    if (m) return { id: `gs-${nextStopId++}`, color: m[1]!.trim(), position: Number(m[2]) };
    return { id: `gs-${nextStopId++}`, color: part.trim(), position: Math.round((idx / (parts.length - 1)) * 100) };
  });
}

interface GradientEditorProps {
  value: GradientValue;
  onChange: (g: GradientValue) => void;
}

const PRESET_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

export function GradientEditor({ value, onChange }: GradientEditorProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const update = useCallback(
    (patch: Partial<GradientValue>) => onChange({ ...value, ...patch }),
    [value, onChange],
  );

  const updateStop = useCallback(
    (stopId: string, patch: Partial<GradientStop>) => {
      const stops = value.stops.map((s) => (s.id === stopId ? { ...s, ...patch } : s));
      update({ stops });
    },
    [value, update],
  );

  const addStop = useCallback(() => {
    const sorted = [...value.stops].sort((a, b) => a.position - b.position);
    let insertPos = 50;
    if (sorted.length >= 2) {
      let maxGap = 0;
      let gapIdx = 0;
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i]!.position - sorted[i - 1]!.position;
        if (gap > maxGap) { maxGap = gap; gapIdx = i; }
      }
      insertPos = Math.round((sorted[gapIdx - 1]!.position + sorted[gapIdx]!.position) / 2);
    }
    const stops = [...value.stops, { id: `gs-${nextStopId++}`, color: '#ffffff', position: insertPos }];
    update({ stops });
  }, [value, update]);

  const removeStop = useCallback(
    (stopId: string) => {
      if (value.stops.length <= 2) return;
      update({ stops: value.stops.filter((s) => s.id !== stopId) });
    },
    [value, update],
  );

  // Drag to reposition stops on the gradient bar
  useEffect(() => {
    if (!dragging) return;
    const bar = barRef.current;
    if (!bar) return;
    const onMove = (e: PointerEvent) => {
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      updateStop(dragging, { position: Math.round(x * 100) });
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, updateStop]);

  const previewCss = gradientToCss(value);
  const sortedStops = [...value.stops].sort((a, b) => a.position - b.position);

  return (
    <div className="ge-container">
      {/* Gradient preview */}
      <div className="ge-preview" style={{ background: previewCss }} />

      {/* Type toggle */}
      <div className="ge-type-row">
        <button
          type="button"
          className={`ge-type-btn ${value.type === 'linear' ? 'ge-type-active' : ''}`}
          onClick={() => update({ type: 'linear' })}
        >
          Linear
        </button>
        <button
          type="button"
          className={`ge-type-btn ${value.type === 'radial' ? 'ge-type-active' : ''}`}
          onClick={() => update({ type: 'radial' })}
        >
          Radial
        </button>
      </div>

      {/* Angle (linear only) */}
      {value.type === 'linear' ? (
        <div className="ge-angle-row">
          <span className="ge-label">Angle</span>
          <div className="ge-angle-presets">
            {PRESET_ANGLES.map((a) => (
              <button
                key={a}
                type="button"
                className={`ge-angle-btn ${value.angle === a ? 'ge-angle-active' : ''}`}
                onClick={() => update({ angle: a })}
                aria-label={`${a}°`}
              >
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <line x1="8" y1="12" x2="8" y2="4" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round"
                    transform={`rotate(${a}, 8, 8)`} />
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
                </svg>
              </button>
            ))}
          </div>
          <input
            type="number"
            className="ge-angle-input"
            min={0}
            max={360}
            value={value.angle}
            onChange={(e) => update({ angle: Math.max(0, Math.min(360, Number(e.currentTarget.value) || 0)) })}
          />
          <span className="ge-unit">deg</span>
        </div>
      ) : null}

      {/* Color stops bar */}
      <div className="ge-stops-bar" ref={barRef}>
        {sortedStops.map((stop) => (
          <button
            key={stop.id}
            type="button"
            className="ge-stop-marker"
            style={{ left: `${stop.position}%`, background: stop.color }}
            onPointerDown={(e) => { e.preventDefault(); setDragging(stop.id); }}
            aria-label={`Stop at ${stop.position}%`}
          />
        ))}
      </div>

      {/* Stop editors */}
      <div className="ge-stops-list">
        {sortedStops.map((stop, idx) => (
          <div key={stop.id} className="ge-stop-row">
            <label className="ge-stop-swatch-label">
              <input
                type="color"
                className="ge-stop-color-input"
                value={normalizeForPicker(stop.color)}
                onChange={(e) => updateStop(stop.id, { color: e.currentTarget.value })}
              />
              <span className="ge-stop-swatch" style={{ background: stop.color }} />
            </label>
            <input
              type="text"
              className="ge-stop-hex"
              value={stop.color}
              onChange={(e) => updateStop(stop.id, { color: e.currentTarget.value })}
            />
            <input
              type="number"
              className="ge-stop-pos"
              min={0}
              max={100}
              value={stop.position}
              onChange={(e) => updateStop(stop.id, { position: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })}
            />
            <span className="ge-unit">%</span>
            {value.stops.length > 2 ? (
              <button type="button" className="ge-stop-remove" onClick={() => removeStop(stop.id)} aria-label="Remove stop">−</button>
            ) : null}
          </div>
        ))}
      </div>

      {/* Add stop */}
      <button type="button" className="ge-add-stop" onClick={addStop}>+ Add color stop</button>
    </div>
  );
}

function normalizeForPicker(value: string): string {
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  return '#000000';
}
