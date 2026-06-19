type DiagnosticFetchEntry = {
  type: 'fetch';
  url: string;
  normalizedUrl: string;
  method: string;
  startedAt: number;
  durationMs: number;
  status?: number;
  ok?: boolean;
  error?: string;
  stack?: string;
};

type DiagnosticEventEntry = {
  type: 'event';
  name: string;
  at: number;
  detail?: unknown;
};

type DiagnosticOperationTarget = {
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
  canvasTool?: string;
  gjsType?: string;
};

type DiagnosticOperationEntry = {
  type: 'operation';
  name: 'change' | 'click' | 'input' | 'keydown' | 'pointerdown' | 'pointerup' | 'wheel';
  at: number;
  target?: DiagnosticOperationTarget;
  x?: number;
  y?: number;
  button?: number;
  pointerType?: string;
  key?: string;
  code?: string;
  modifiers?: string[];
  repeat?: boolean;
  deltaX?: number;
  deltaY?: number;
};

type DiagnosticLongTaskEntry = {
  type: 'longtask';
  startedAt: number;
  durationMs: number;
  name: string;
};

type DiagnosticFrameSummary = {
  count: number;
  averageDeltaMs: number;
  maxDeltaMs: number;
  longFrameCount: number;
};

export type OpenDesignEditorDiagnosticsReport = {
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  active: boolean;
  fetchSummary: Array<{
    key: string;
    count: number;
    statuses: Record<string, number>;
    averageDurationMs: number;
    maxDurationMs: number;
  }>;
  frames: DiagnosticFrameSummary;
  fetches: DiagnosticFetchEntry[];
  events: DiagnosticEventEntry[];
  operations: DiagnosticOperationEntry[];
  longTasks: DiagnosticLongTaskEntry[];
};

type DiagnosticsController = {
  start: (options?: { captureOperations?: boolean; includeStacks?: boolean; reset?: boolean }) => void;
  stop: () => OpenDesignEditorDiagnosticsReport;
  reset: () => void;
  report: () => OpenDesignEditorDiagnosticsReport;
  download: (fileName?: string) => void;
  record: (name: string, detail?: unknown) => void;
};

declare global {
  interface Window {
    __OD_EDITOR_DIAGNOSTICS__?: DiagnosticsController;
    odDiagnostics?: DiagnosticsController;
  }
}

const LONG_FRAME_MS = 50;

let installed = false;
let active = false;
let captureOperations = true;
let includeStacks = false;
let startedAt: number | null = null;
let endedAt: number | null = null;
let originalFetch: typeof window.fetch | null = null;
let frameRequest = 0;
let lastFrameAt = 0;
let longTaskObserver: PerformanceObserver | null = null;
const operationDocuments = new WeakSet<Document>();
const frameDeltas: number[] = [];
const fetches: DiagnosticFetchEntry[] = [];
const events: DiagnosticEventEntry[] = [];
const operations: DiagnosticOperationEntry[] = [];
const longTasks: DiagnosticLongTaskEntry[] = [];

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function absoluteUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function fetchMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function normalizeDiagnosticUrl(raw: string): string {
  try {
    const url = new URL(raw, window.location.href);
    for (const key of ['cacheBust', 'cacheBustKey', 'v', 'fr', '_']) {
      url.searchParams.delete(key);
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

function shouldCaptureFetch(raw: string): boolean {
  const normalized = normalizeDiagnosticUrl(raw);
  return (
    normalized.includes('/api/projects/') ||
    normalized.includes('/api/live-artifacts') ||
    normalized.includes('/api/runs/')
  );
}

function startFrameLoop() {
  if (frameRequest || typeof window === 'undefined') return;
  lastFrameAt = now();
  const tick = (time: number) => {
    if (!active) {
      frameRequest = 0;
      return;
    }
    const delta = time - lastFrameAt;
    if (delta > 0) frameDeltas.push(delta);
    lastFrameAt = time;
    frameRequest = window.requestAnimationFrame(tick);
  };
  frameRequest = window.requestAnimationFrame(tick);
}

function stopFrameLoop() {
  if (!frameRequest || typeof window === 'undefined') return;
  window.cancelAnimationFrame(frameRequest);
  frameRequest = 0;
}

function startLongTaskObserver() {
  if (longTaskObserver || typeof PerformanceObserver === 'undefined') return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      if (!active) return;
      for (const entry of list.getEntries()) {
        longTasks.push({
          type: 'longtask',
          name: entry.name,
          startedAt: entry.startTime,
          durationMs: entry.duration,
        });
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    longTaskObserver = null;
  }
}

function stopLongTaskObserver() {
  try { longTaskObserver?.disconnect(); } catch { /* ignore */ }
  longTaskObserver = null;
}

function addOperationListeners(targetWindow: Window) {
  let doc: Document;
  try {
    doc = targetWindow.document;
  } catch {
    return;
  }
  if (!doc || operationDocuments.has(doc)) return;
  operationDocuments.add(doc);
  const add = (
    name: DiagnosticOperationEntry['name'],
    listener: (event: Event) => void = (event) => recordOperation(name, event),
  ) => {
    doc.addEventListener(name, listener, true);
  };
  add('click');
  add('pointerdown');
  add('pointerup');
  add('keydown');
  add('wheel');
  add('input');
  add('change');
}

function patchFetch() {
  if (originalFetch || typeof window === 'undefined') return;
  originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = absoluteUrl(input);
    const capture = active && shouldCaptureFetch(url);
    const started = now();
    const stack = capture && includeStacks ? new Error().stack : undefined;
    try {
      const response = await originalFetch?.(input, init);
      if (capture && response) {
        fetches.push({
          type: 'fetch',
          url,
          normalizedUrl: normalizeDiagnosticUrl(url),
          method: fetchMethod(input, init),
          startedAt: started,
          durationMs: now() - started,
          status: response.status,
          ok: response.ok,
          stack,
        });
      }
      if (!response) throw new Error('fetch unavailable');
      return response;
    } catch (error) {
      if (capture) {
        fetches.push({
          type: 'fetch',
          url,
          normalizedUrl: normalizeDiagnosticUrl(url),
          method: fetchMethod(input, init),
          startedAt: started,
          durationMs: now() - started,
          error: error instanceof Error ? error.message : String(error),
          stack,
        });
      }
      throw error;
    }
  }) as typeof window.fetch;
}

function resetDiagnostics() {
  fetches.length = 0;
  events.length = 0;
  operations.length = 0;
  longTasks.length = 0;
  frameDeltas.length = 0;
  startedAt = active ? now() : null;
  endedAt = null;
  lastFrameAt = now();
}

function frameSummary(): DiagnosticFrameSummary {
  if (frameDeltas.length === 0) {
    return { count: 0, averageDeltaMs: 0, maxDeltaMs: 0, longFrameCount: 0 };
  }
  const total = frameDeltas.reduce((sum, value) => sum + value, 0);
  return {
    count: frameDeltas.length,
    averageDeltaMs: total / frameDeltas.length,
    maxDeltaMs: Math.max(...frameDeltas),
    longFrameCount: frameDeltas.filter((value) => value >= LONG_FRAME_MS).length,
  };
}

function buildReport(): OpenDesignEditorDiagnosticsReport {
  const fetchGroups = new Map<string, DiagnosticFetchEntry[]>();
  for (const entry of fetches) {
    const key = `${entry.method} ${entry.normalizedUrl}`;
    const group = fetchGroups.get(key);
    if (group) group.push(entry);
    else fetchGroups.set(key, [entry]);
  }
  return {
    startedAt,
    endedAt,
    durationMs: startedAt == null ? 0 : (endedAt ?? now()) - startedAt,
    active,
    fetchSummary: Array.from(fetchGroups.entries()).map(([key, group]) => {
      const statuses: Record<string, number> = {};
      let total = 0;
      let max = 0;
      for (const entry of group) {
        const status = entry.status == null ? (entry.error ? 'error' : 'unknown') : String(entry.status);
        statuses[status] = (statuses[status] ?? 0) + 1;
        total += entry.durationMs;
        max = Math.max(max, entry.durationMs);
      }
      return {
        key,
        count: group.length,
        statuses,
        averageDurationMs: total / group.length,
        maxDurationMs: max,
      };
    }).sort((a, b) => b.count - a.count),
    frames: frameSummary(),
    fetches: [...fetches],
    events: [...events],
    operations: [...operations],
    longTasks: [...longTasks],
  };
}

function downloadReport(fileName = `open-design-editor-diagnostics-${Date.now()}.json`) {
  const blob = new Blob([JSON.stringify(buildReport(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function recordOpenDesignEditorDiagnostic(name: string, detail?: unknown): void {
  if (!active || typeof window === 'undefined') return;
  events.push({
    type: 'event',
    name,
    at: now(),
    detail,
  });
}

function recordOperation(name: DiagnosticOperationEntry['name'], event: Event): void {
  if (!active || !captureOperations || typeof window === 'undefined') return;
  const entry: DiagnosticOperationEntry = {
    type: 'operation',
    name,
    at: now(),
    target: summarizeOperationTarget(event.target),
  };
  const maybeMouse = event as MouseEvent;
  if (typeof maybeMouse.clientX === 'number') {
    entry.x = Math.round(maybeMouse.clientX);
    entry.y = Math.round(maybeMouse.clientY);
  }
  if (typeof maybeMouse.button === 'number') {
    entry.button = maybeMouse.button;
  }
  const maybePointer = event as PointerEvent;
  if (typeof maybePointer.pointerType === 'string' && maybePointer.pointerType) {
    entry.pointerType = maybePointer.pointerType;
  }
  const maybeKeyboard = event as KeyboardEvent;
  if (typeof maybeKeyboard.key === 'string') {
    entry.key = maybeKeyboard.key;
    entry.code = maybeKeyboard.code;
    entry.repeat = maybeKeyboard.repeat;
    entry.modifiers = keyboardModifiers(maybeKeyboard);
  }
  const maybeWheel = event as WheelEvent;
  if (typeof maybeWheel.deltaY === 'number') {
    entry.deltaX = Math.round(maybeWheel.deltaX);
    entry.deltaY = Math.round(maybeWheel.deltaY);
  }
  operations.push(entry);
}

function summarizeOperationTarget(target: EventTarget | null): DiagnosticOperationTarget | undefined {
  if (!isElementLike(target)) return undefined;
  const className = (target.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  return compactTarget({
    tag: target.tagName.toLowerCase(),
    id: target.id,
    className,
    role: target.getAttribute('role') ?? undefined,
    testId: target.getAttribute('data-testid') ?? undefined,
    ariaLabel: target.getAttribute('aria-label') ?? undefined,
    title: target.getAttribute('title') ?? target.getAttribute('data-tooltip') ?? undefined,
    canvasTool: target.getAttribute('data-od-canvas-tool') ?? undefined,
    gjsType: target.getAttribute('data-gjs-type') ?? undefined,
  });
}

function isElementLike(target: EventTarget | null): target is Element {
  return Boolean(
    target &&
    typeof (target as Element).tagName === 'string' &&
    typeof (target as Element).getAttribute === 'function',
  );
}

function compactTarget(target: DiagnosticOperationTarget): DiagnosticOperationTarget {
  const next: DiagnosticOperationTarget = { tag: target.tag };
  for (const key of [
    'id',
    'className',
    'role',
    'testId',
    'ariaLabel',
    'title',
    'canvasTool',
    'gjsType',
  ] as const) {
    const value = target[key];
    if (value) next[key] = value.slice(0, 80);
  }
  return next;
}

function keyboardModifiers(event: KeyboardEvent): string[] {
  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push('meta');
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey) modifiers.push('shift');
  return modifiers;
}

export function exposeOpenDesignEditorDiagnosticsToWindow(targetWindow: Window | null | undefined): void {
  if (typeof window === 'undefined' || !targetWindow) return;
  const controller = window.__OD_EDITOR_DIAGNOSTICS__;
  if (!controller) return;
  try {
    targetWindow.__OD_EDITOR_DIAGNOSTICS__ = controller;
    targetWindow.odDiagnostics = controller;
    addOperationListeners(targetWindow);
  } catch {
    // Cross-origin or torn-down iframe.
  }
}

export function installOpenDesignEditorDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  patchFetch();
  addOperationListeners(window);
  const controller: DiagnosticsController = {
    start(options = {}) {
      captureOperations = options.captureOperations !== false;
      includeStacks = Boolean(options.includeStacks);
      active = true;
      endedAt = null;
      if (options.reset !== false) resetDiagnostics();
      else if (startedAt == null) startedAt = now();
      startFrameLoop();
      startLongTaskObserver();
    },
    stop() {
      active = false;
      endedAt = now();
      stopFrameLoop();
      stopLongTaskObserver();
      return buildReport();
    },
    reset() {
      resetDiagnostics();
    },
    report() {
      return buildReport();
    },
    download(fileName?: string) {
      downloadReport(fileName);
    },
    record(name: string, detail?: unknown) {
      recordOpenDesignEditorDiagnostic(name, detail);
    },
  };
  window.__OD_EDITOR_DIAGNOSTICS__ = controller;
  window.odDiagnostics = controller;
  try {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('odDiagnostics') === '1' ||
      window.localStorage.getItem('od.editorDiagnostics') === '1'
    ) {
      controller.start({ includeStacks: true });
    }
  } catch {
    // ignore storage/query access failures
  }
}
