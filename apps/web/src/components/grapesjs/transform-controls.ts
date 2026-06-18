export type FlipAxis = 'x' | 'y';

export function parseRotation(transform: string | undefined): number {
  if (!transform || transform === 'none') return 0;
  const direct = transform.match(/rotate\((-?[\d.]+)deg\)/);
  if (direct?.[1]) return Number.parseFloat(direct[1]);
  const matrix = transform.match(/^matrix\(([^,]+),\s*([^,]+)/);
  if (!matrix?.[1] || !matrix[2]) return 0;
  return Math.round(Math.atan2(Number(matrix[2]), Number(matrix[1])) * (180 / Math.PI));
}

export function replaceRotation(transform: string | undefined, degrees: number): string {
  const base = !transform || transform === 'none'
    ? ''
    : transform.replace(/\s*rotate\((-?[\d.]+)deg\)/, '').trim();
  return `${base}${base ? ' ' : ''}rotate(${degrees}deg)`;
}

export function toggleFlipTransform(transform: string | undefined, axis: FlipAxis): string {
  const fn = axis === 'x' ? 'scaleX' : 'scaleY';
  const source = !transform || transform === 'none' ? '' : transform;
  const scalePattern = new RegExp(`\\s*${fn}\\((-?[\\d.]+)\\)`);
  const match = source.match(scalePattern);
  if (!match?.[1]) return `${source}${source ? ' ' : ''}${fn}(-1)`;

  const currentScale = Number.parseFloat(match[1]);
  const replacement = currentScale < 0 ? '' : ` ${fn}(-1)`;
  const next = source.replace(scalePattern, replacement).trim();
  return next || 'none';
}
