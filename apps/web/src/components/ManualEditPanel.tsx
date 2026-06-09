import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../i18n';
import { emptyManualEditStyles, type ManualEditAlignMode, type ManualEditHistoryEntry, type ManualEditPatch, type ManualEditStyles, type ManualEditTarget } from '../edit-mode/types';
import { Icon } from './Icon';

export interface ManualEditDraft {
  text: string;
  href: string;
  src: string;
  alt: string;
  styles: ManualEditStyles;
  attributesText: string;
  outerHtml: string;
  fullSource: string;
}

export function emptyManualEditDraft(source = ''): ManualEditDraft {
  return {
    text: '', href: '', src: '', alt: '',
    styles: emptyManualEditStyles(),
    attributesText: '{}', outerHtml: '', fullSource: source,
  };
}

/** Props shared by docked and floating modes. */
type SharedPanelProps = {
  targets: ManualEditTarget[];
  selectedTarget: ManualEditTarget | null;
  selectedTargets?: ManualEditTarget[];
  draft: ManualEditDraft;
  history: ManualEditHistoryEntry[];
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  pageStylesEnabled?: boolean;
  onSelectTarget: (target: ManualEditTarget) => void;
  onDraftChange: (draft: ManualEditDraft) => void;
  onStyleChange?: (id: string, styles: Partial<ManualEditStyles>, label: string) => void;
  onInvalidStyle?: (id: string, keys: Array<keyof ManualEditStyles>) => void;
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
  onPickImage?: (file: File) => Promise<string | null>;
  onError: (message: string) => void;
  onClearSelection: () => void;
  onExit?: () => void;
  onCancelDraft: () => void;
  onSaveDraft: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

export function ManualEditPanel(props: SharedPanelProps & {
  /** Legacy floating mode (kept for backward compat while migrating). */
  floatingStyle?: CSSProperties;
  floatingClassName?: string;
  onFloatingPositionChange?: (position: { left: number; top: number }) => void;
}) {
  const {
    selectedTarget, selectedTargets, draft, error, canUndo, busy,
    onDraftChange, onStyleChange, onInvalidStyle, onError,
    onCancelDraft, onSaveDraft, onExit, onApplyPatch, onPickImage,
    pageStylesEnabled = true,
    floatingStyle, floatingClassName, onFloatingPositionChange,
    targets,
  } = props;

  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const effectiveSelectedTargets = selectedTargets?.length
    ? selectedTargets
    : selectedTarget
      ? [selectedTarget]
      : [];
  const targetForInspector = effectiveSelectedTargets[0] ?? null;
  const selectionCount = effectiveSelectedTargets.length;
  const selectedTargetRef = useRef<ManualEditTarget | null>(targetForInspector);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Track latest styles via ref so synchronous calls (e.g. collapsed margin setting both l+r)
  // accumulate correctly instead of overwriting each other with a stale draft.
  const latestStylesRef = useRef<ManualEditStyles>(draft.styles);
  latestStylesRef.current = draft.styles;
  const panelTitle = selectionCount > 1
    ? `${selectionCount} elements`
    : targetForInspector
      ? readableManualEditTargetName(targetForInspector)
      : t('manualEdit.fallbackTitle');
  useEffect(() => {
    selectedTargetRef.current = targetForInspector;
  }, [targetForInspector]);

  const changeTargetStyles = (styles: Partial<ManualEditStyles>) => {
    const baseStyles = latestStylesRef.current;
    const nextStyles = { ...baseStyles, ...styles };
    latestStylesRef.current = nextStyles;
    onDraftChange({ ...draft, styles: nextStyles });
    if (!targetForInspector) return;
    const normalized = normalizeManualEditStyles(styles, {
      layoutEnabled: targetForInspector.isLayoutContainer,
    });
    if (!normalized.ok) {
      onError('error' in normalized ? normalized.error : 'Invalid style value.');
      onInvalidStyle?.(selectionCount > 1 ? '__selection__' : targetForInspector.id, Object.keys(styles) as Array<keyof ManualEditStyles>);
      return;
    }
    onError('');
    onStyleChange?.(
      selectionCount > 1 ? '__selection__' : targetForInspector.id,
      normalized.styles,
      selectionCount > 1 ? `Style: ${selectionCount} elements` : `Style: ${targetForInspector.label}`,
    );
  };
  const changeTargetStyle = (key: keyof ManualEditStyles, value: string) => {
    changeTargetStyles({ [key]: value });
  };

  // Legacy floating drag (only used when floatingStyle is provided)
  const startPanelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onFloatingPositionChange) return;
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest('.manual-edit-right') as HTMLElement | null;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = panel.offsetLeft;
    const startTop = panel.offsetTop;
    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const pad = 8;
    const maxLeft = Math.max(pad, parentRect.width - panelRect.width - pad);
    const maxTop = Math.max(pad, parentRect.height - panelRect.height - pad);
    const ownerDocument = panel.ownerDocument;
    const move = (moveEvent: PointerEvent) => {
      onFloatingPositionChange({
        left: clamp(startLeft + moveEvent.clientX - startX, pad, maxLeft),
        top: clamp(startTop + moveEvent.clientY - startY, pad, maxTop),
      });
    };
    const up = () => {
      ownerDocument.removeEventListener('pointermove', move);
      ownerDocument.removeEventListener('pointerup', up);
      ownerDocument.removeEventListener('pointercancel', up);
    };
    ownerDocument.addEventListener('pointermove', move);
    ownerDocument.addEventListener('pointerup', up);
    ownerDocument.addEventListener('pointercancel', up);
  };

  const isDocked = !floatingStyle;

  // ── Collect document colors for the palette ──
  const documentColors = useMemo(() => {
    const colorSet = new Set<string>();
    for (const t of targets) {
      const colors = [t.styles.color, t.styles.backgroundColor, t.styles.borderColor];
      for (const c of colors) {
        const trimmed = c?.trim();
        if (trimmed && /^#[0-9a-f]{3,6}$/i.test(trimmed)) colorSet.add(trimmed.toLowerCase());
      }
    }
    return Array.from(colorSet);
  }, [targets]);

  // ── Collapsible section state ──
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const panelContent = (
    <div className="pp-panel">
      {/* ── Title bar ── */}
      <div className="pp-titlebar">
        {floatingStyle ? (
          <button
            type="button"
            className="manual-edit-drag-handle"
            aria-label={t('manualEdit.movePanel')}
            title={t('manualEdit.movePanel')}
            onPointerDown={startPanelDrag}
          >
            <span aria-hidden />
          </button>
        ) : null}
        <span className="pp-titlebar-name" title={panelTitle}>{panelTitle}</span>
        {targetForInspector ? (
          <span className="pp-titlebar-tag">{targetForInspector.tagName}</span>
        ) : null}
        {onExit ? (
          <button type="button" className="pp-titlebar-close" aria-label={t('manualEdit.closePanel')} title={t('manualEdit.closePanel')} onClick={onExit}>
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>

      {/* ── Scrollable body ── */}
      <div className="pp-scroll">
        {targetForInspector ? (
          <PropertiesInspector
            target={targetForInspector}
            selectedTargets={effectiveSelectedTargets}
            draft={draft}
            styles={draft.styles}
            onChange={changeTargetStyle}
            onChangeStyles={changeTargetStyles}
            onDraftChange={onDraftChange}
            onApplyPatch={onApplyPatch}
            collapsedSections={collapsedSections}
            onToggleSection={toggleSection}
            documentColors={documentColors}
          />
        ) : pageStylesEnabled ? (
          <PageInspector
            enabled={pageStylesEnabled}
            onStyleChange={(styles) => {
              const normalized = normalizeManualEditStyles(styles, { layoutEnabled: true });
              if (!normalized.ok) {
                onError(normalized.error);
                onInvalidStyle?.('__body__', Object.keys(styles) as Array<keyof ManualEditStyles>);
                return;
              }
              onError('');
              onStyleChange?.('__body__', normalized.styles, 'Page styles');
            }}
          />
        ) : null}
        {!targetForInspector && !pageStylesEnabled ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <p>{t('manualEdit.hint.clickElement')}</p>
            <p style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>{t('manualEdit.hint.toggleShortcut')}</p>
          </div>
        ) : null}

        {targetForInspector?.kind === 'image' && onPickImage ? (
          <div className="pp-section">
            <div className="pp-section-body">
              <button
                type="button"
                className="cc-action-btn"
                disabled={uploadingImage}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingImage ? t('manualEdit.uploadingImage') : t('manualEdit.uploadImage')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  e.currentTarget.value = '';
                  setUploadingImage(true);
                  try {
                    const src = await onPickImage(file);
                    if (src) {
                      const activeTargetId = selectedTargetRef.current?.id ?? targetForInspector.id;
                      onApplyPatch(
                        { id: activeTargetId, kind: 'set-image', src, alt: draft.alt },
                        t('manualEdit.uploadImage'),
                      );
                    } else {
                      onError(t('manualEdit.uploadImageFailed'));
                    }
                  } finally {
                    setUploadingImage(false);
                  }
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Footer ── */}
      <div className="pp-footer">
        <div className="manual-edit-footer-actions">
          <div className="manual-edit-footer-left">
            {targetForInspector ? (
              confirmDelete ? (
                <div className="manual-edit-delete-confirm">
                  <span>{canUndo ? t('manualEdit.deleteElementConfirm') : t('manualEdit.deleteElement')}</span>
                  <button
                    type="button"
                    className="manual-edit-footer-btn danger"
                    disabled={busy}
                    onClick={() => {
                      setConfirmDelete(false);
                      onApplyPatch(
                        { id: targetForInspector.id, kind: 'remove-element' },
                        t('manualEdit.deleteElement'),
                      );
                    }}
                  >
                    {t('manualEdit.deleteElement')}
                  </button>
                  <button
                    type="button"
                    className="manual-edit-footer-btn subtle"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="manual-edit-delete-btn"
                  aria-label={t('manualEdit.deleteElement')}
                  title={t('manualEdit.deleteElement')}
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="trash" size={15} />
                </button>
              )
            ) : null}
          </div>
          <div className="manual-edit-footer-right">
          </div>
        </div>
        {error ? <div className="manual-edit-error">{error}</div> : null}
      </div>
    </div>
  );

  if (isDocked) {
    return <aside className="pp-dock">{panelContent}</aside>;
  }

  // Legacy floating mode
  return (
    <aside
      className={`manual-edit-right manual-edit-floating${floatingClassName ? ` ${floatingClassName}` : ''}`}
      style={floatingStyle}
    >
      <section className="manual-edit-modal cc-panel">{panelContent}</section>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Figma-style Properties Inspector (6 sections)
   ═══════════════════════════════════════════════════════════════════════════ */

function PropertiesInspector({
  target, selectedTargets, draft, styles, onChange, onChangeStyles, onDraftChange, onApplyPatch,
  collapsedSections, onToggleSection, documentColors,
}: {
  target: ManualEditTarget;
  selectedTargets: ManualEditTarget[];
  draft: ManualEditDraft;
  styles: ManualEditStyles;
  onChange: (key: keyof ManualEditStyles, value: string) => void;
  onChangeStyles: (styles: Partial<ManualEditStyles>) => void;
  onDraftChange: (draft: ManualEditDraft) => void;
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
  collapsedSections: Set<string>;
  onToggleSection: (id: string) => void;
  documentColors: string[];
}) {
  const t = useT();
  const u = (key: keyof ManualEditStyles, value: string) => onChange(key, value);
  const layoutEnabled = target.isLayoutContainer;
  const isText = target.kind === 'text' || target.kind === 'link' || target.kind === 'token';

  // Opacity: CSS uses 0-1, display uses 0-100
  const opacityDisplay = styles.opacity ? String(Math.round(Number(styles.opacity) * 100)) : '100';
  const handleOpacityChange = (v: string) => {
    const num = Number(v);
    if (Number.isFinite(num)) u('opacity', String(Math.max(0, Math.min(100, num)) / 100));
    else u('opacity', v);
  };

  const hasFill = hasVisibleFill(styles.backgroundColor);
  const hasStroke = hasVisibleStroke(styles);
  const hasEffect = hasVisibleShadow(styles.boxShadow);
  const displayMode = styles.display.trim();
  const layoutModeActive = displayMode === 'flex'
    || displayMode === 'inline-flex'
    || !!styles.flexDirection.trim();
  const hasAutoLayoutParent = Boolean(target.parentLayout?.display?.includes('flex') || target.parentLayout?.display?.includes('grid'));
  const mainAxisGapProp: keyof ManualEditStyles = styles.flexDirection.startsWith('column') ? 'rowGap' : 'columnGap';
  const mainAxisGap = mainAxisGapProp === 'rowGap' ? styles.rowGap : styles.columnGap;
  const mainAxisGapLabel = mainAxisGapProp === 'rowGap' ? '↕' : '↔';
  const singleTextTarget = selectedTargets.length === 1 && isText ? target : null;
  const showAlignmentToolbar = canAlignSelectedTargets(selectedTargets);

  return (
    <>
      {showAlignmentToolbar ? (
        <AlignmentToolbar
          targets={selectedTargets}
          onApplyPatch={onApplyPatch}
        />
      ) : null}

      {/* ── 1. Frame info ── */}
      <Section title={t('manualEdit.section.frame')} id="frame" collapsed={collapsedSections} onToggle={onToggleSection}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{target.tagName}</span>
          <span>·</span>
          <span>{target.kind}</span>
        </div>
      </Section>

      {singleTextTarget ? (
        <Section title="Text" id="text" collapsed={collapsedSections} onToggle={onToggleSection}>
          <textarea
            key={singleTextTarget.id}
            className="pp-textarea"
            data-testid="manual-edit-textarea"
            defaultValue={draft.text || singleTextTarget.fields.text || singleTextTarget.text}
            onChange={(event) => {
              onDraftChange({ ...draft, text: event.currentTarget.value });
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value;
              if (value === (singleTextTarget.fields.text ?? singleTextTarget.text)) return;
              onApplyPatch({ id: singleTextTarget.id, kind: 'set-text', value }, 'Edit text');
            }}
          />
        </Section>
      ) : null}

      {/* ── 2. Position ── */}
      <Section title={t('manualEdit.section.position')} id="position" collapsed={collapsedSections} onToggle={onToggleSection}>
        <div className="pp-field-pair">
          <UnitRow label="X" value={String(Math.round(target.rect.x))} onChange={(v) => u('width', v)} unit="" />
          <UnitRow label="Y" value={String(Math.round(target.rect.y))} onChange={(v) => u('height', v)} unit="" />
        </div>
        <div className="pp-field-pair">
          <UnitRow label="W" value={styles.width} onChange={(v) => u('width', v)} unit="px" autoUnit />
          <UnitRow label="H" value={styles.height} onChange={(v) => u('height', v)} unit="px" autoUnit />
        </div>
        {hasAutoLayoutParent ? (
          <div className="pp-size-mode-row" aria-label="Sizing mode">
            <SizingModeSelect
              testId="manual-edit-width-mode"
              axis="width"
              value={sizeModeFor(styles.width)}
              onChange={(mode) => u('width', sizeValueForMode(mode, Math.round(target.rect.width)))}
            />
            <SizingModeSelect
              testId="manual-edit-height-mode"
              axis="height"
              value={sizeModeFor(styles.height)}
              onChange={(mode) => u('height', sizeValueForMode(mode, Math.round(target.rect.height)))}
            />
          </div>
        ) : null}
        <MarginPanel
          marginTop={styles.marginTop}
          marginRight={styles.marginRight}
          marginBottom={styles.marginBottom}
          marginLeft={styles.marginLeft}
          onChange={(side, value) => u(sideToProp('margin', side), value)}
        />
      </Section>

      {/* ── 3. Auto Layout ── */}
      {layoutEnabled ? (
        <Section title={t('manualEdit.section.autoLayout')} id="autolayout" collapsed={collapsedSections} onToggle={onToggleSection}>
          <div className="pp-auto-layout-body">
            <div className="pp-auto-layout-left">
              <div className="pp-flow-row">
                <button
                  type="button"
                  className={`pp-icon-btn${!layoutModeActive ? ' pp-icon-btn-active' : ''}`}
                  data-tooltip={t('manualEdit.autoLayout.none')}
                  onClick={() => onChangeStyles({
                    display: '',
                    flexDirection: '',
                    flexWrap: '',
                    justifyContent: '',
                    alignItems: '',
                    gap: '',
                    columnGap: '',
                    rowGap: '',
                  })}
                >
                  <SvgLayoutNone />
                </button>
                <button type="button" className={`pp-icon-btn${(displayMode === 'flex' || displayMode === 'inline-flex') && styles.flexDirection === 'column' ? ' pp-icon-btn-active' : ''}`} data-tooltip={t('manualEdit.autoLayout.vertical')} onClick={() => onChangeStyles({ display: 'flex', flexDirection: 'column' })}>
                  <ManualEditIcon name="vertical" />
                </button>
                <button type="button" className={`pp-icon-btn${(displayMode === 'flex' || displayMode === 'inline-flex') && (styles.flexDirection === 'row' || !styles.flexDirection.trim()) ? ' pp-icon-btn-active' : ''}`} data-tooltip={t('manualEdit.autoLayout.horizontal')} onClick={() => onChangeStyles({ display: 'flex', flexDirection: 'row' })}>
                  <ManualEditIcon name="horizontal" />
                </button>
                {!!styles.flexDirection && (
                  <button type="button" className={`pp-icon-btn${styles.flexWrap === 'wrap' ? ' pp-icon-btn-active' : ''}`} data-tooltip={styles.flexWrap === 'wrap' ? t('manualEdit.label.flexNoWrap') : t('manualEdit.label.flexWrap')} onClick={() => u('flexWrap', styles.flexWrap === 'wrap' ? '' : 'wrap')}>
                    <ManualEditIcon name="wrap" />
                  </button>
                )}
              </div>
              <GapPanel
                mainAxisGap={mainAxisGap}
                mainAxisGapLabel={mainAxisGapLabel}
                onMainAxisGapChange={(v) => u(mainAxisGapProp, v)}
                paddingTop={styles.paddingTop}
                paddingRight={styles.paddingRight}
                paddingBottom={styles.paddingBottom}
                paddingLeft={styles.paddingLeft}
                onPaddingChange={(side, value) => u(sideToProp('padding', side), value)}
                onArrangementChange={(axis) => onChangeStyles({
                  display: 'flex',
                  flexDirection: axis === 'vertical' ? 'column' : 'row',
                  justifyContent: 'space-between',
                })}
              />
            </div>
            <div className="pp-auto-layout-right">
              <AlignGrid
                flexDirection={styles.flexDirection || 'row'}
                justifyValue={styles.justifyContent}
                alignValue={styles.alignItems}
                onJustifyChange={(v) => u('justifyContent', v)}
                onAlignChange={(v) => u('alignItems', v)}
              />
            </div>
          </div>
          <div className="pp-toggle-row">
            <input type="checkbox" id="pp-clip" checked={styles.overflow === 'hidden'} onChange={(e) => u('overflow', e.currentTarget.checked ? 'hidden' : '')} />
            <label htmlFor="pp-clip">{t('manualEdit.label.clipContent')}</label>
          </div>
        </Section>
      ) : null}

      {/* ── 4. Appearance ── */}
      <Section title={t('manualEdit.section.appearance')} id="appearance" collapsed={collapsedSections} onToggle={onToggleSection}>
        <UnitRow label={t('manualEdit.label.opacity')} value={opacityDisplay} onChange={handleOpacityChange} unit="%" min={0} max={100} />
        <UnitRow label={t('manualEdit.label.radius')} value={styles.borderRadius} onChange={(v) => u('borderRadius', v)} unit="px" autoUnit min={0} />
      </Section>

      {/* ── 5. Fill ── */}
      <Section title={t('manualEdit.section.fill')} id="fill" collapsed={collapsedSections} onToggle={onToggleSection}
        actions={
          <button type="button" className="pp-section-add" data-tooltip={t('manualEdit.section.fill')}
            onClick={() => onChangeStyles({ backgroundColor: hasFill ? '' : '#000000' })}>
            <Icon name={hasFill ? 'minus' : 'plus'} size={12} />
          </button>
        }
      >
        {hasFill ? <ColorRow label="" value={styles.backgroundColor} onChange={(v) => u('backgroundColor', v)} compact /> : null}
      </Section>

      {/* ── 6. Stroke ── */}
      <Section title={t('manualEdit.section.stroke')} id="stroke" collapsed={collapsedSections} onToggle={onToggleSection}
        actions={
          <button type="button" className="pp-section-add" data-tooltip={t('manualEdit.section.stroke')}
            onClick={() => {
              if (hasStroke) {
                onChangeStyles({
                  border: '',
                  borderTopWidth: '0px',
                  borderRightWidth: '0px',
                  borderBottomWidth: '0px',
                  borderLeftWidth: '0px',
                  borderColor: '',
                  borderStyle: 'none',
                });
              } else {
                onChangeStyles({
                  borderTopWidth: '1px',
                  borderRightWidth: '1px',
                  borderBottomWidth: '1px',
                  borderLeftWidth: '1px',
                  borderColor: '#000000',
                  borderStyle: 'solid',
                });
              }
            }}>
            <Icon name={hasStroke ? 'minus' : 'plus'} size={12} />
          </button>
        }
      >
        {hasStroke ? (
          <StrokeEditor
            border={styles.border}
            borderTopWidth={styles.borderTopWidth}
            borderRightWidth={styles.borderRightWidth}
            borderBottomWidth={styles.borderBottomWidth}
            borderLeftWidth={styles.borderLeftWidth}
            borderColor={styles.borderColor}
            borderStyle={styles.borderStyle}
            onChange={(key, value) => u(key, value)}
          />
        ) : null}
      </Section>

      {/* ── 7. Effect ── */}
      <Section title={t('manualEdit.section.effect')} id="effect" collapsed={collapsedSections} onToggle={onToggleSection}
        actions={
          <button type="button" className="pp-section-add" data-tooltip={t('manualEdit.section.effect')}
            onClick={() => onChangeStyles({ boxShadow: hasEffect ? '' : '0px 4px 12px 0px rgba(0,0,0,0.2)' })}>
            <Icon name={hasEffect ? 'minus' : 'plus'} size={12} />
          </button>
        }
      >
        {hasEffect ? <ShadowEditor value={styles.boxShadow} onChange={(v) => u('boxShadow', v)} /> : null}
      </Section>

      {/* ── Typography (shown for text elements) ── */}
      {isText ? (
        <Section title={t('manualEdit.section.typography')} id="typography" collapsed={collapsedSections} onToggle={onToggleSection}>
          <FontRow value={styles.fontFamily} onChange={(v) => u('fontFamily', v)} />
          <div className="pp-field-pair">
            <UnitRow label="Size" value={styles.fontSize} onChange={(v) => u('fontSize', v)} unit="px" autoUnit />
            <DropdownRow label="Weight" value={styles.fontWeight} onChange={(v) => u('fontWeight', v)} options={WEIGHT_OPTS} />
          </div>
          <div className="pp-field-pair">
            <ColorRow label={t('manualEdit.section.fill')} value={styles.color} onChange={(v) => u('color', v)} />
            <DropdownRow label="Align" value={styles.textAlign} onChange={(v) => u('textAlign', v)} options={ALIGN_OPTS} />
          </div>
        </Section>
      ) : null}

      {/* ── 6. Color palette ── */}
      {documentColors.length > 0 ? (
        <Section title={t('manualEdit.section.colors')} id="colors" collapsed={collapsedSections} onToggle={onToggleSection}>
          <div className="pp-color-palette">
            {documentColors.map((hex) => (
              <button
                key={hex}
                type="button"
                className="pp-color-swatch"
                style={{ background: hex }}
                data-tooltip={hex}
                onClick={() => u('backgroundColor', hex)}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Shadow Editor (box-shadow)
   ═══════════════════════════════════════════════════════════════════════════ */

interface ShadowParts {
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
  inset: boolean;
}

function parseBoxShadow(value: string): ShadowParts | null {
  if (!value?.trim()) return null;
  if (!hasVisibleShadow(value)) return null;
  const parts: ShadowParts = { x: '0px', y: '4px', blur: '12px', spread: '0px', color: '#000000', inset: false };
  const insetMatch = value.match(/\binset\b/i);
  if (insetMatch) parts.inset = true;
  // Match color: #hex or rgba(...)
  const colorMatch = value.match(/(#[0-9a-f]{3,8}\b|rgba?\([^)]+\))/i);
  if (colorMatch) parts.color = colorMatch[1]!;
  // Match numeric values (with optional px)
  const nums = value.match(/-?\d+(\.\d+)?px/g);
  if (nums) {
    if (nums[0]) parts.x = nums[0];
    if (nums[1]) parts.y = nums[1];
    if (nums[2]) parts.blur = nums[2];
    if (nums[3]) parts.spread = nums[3];
  }
  return parts;
}

function buildBoxShadow(parts: ShadowParts): string {
  return `${parts.inset ? 'inset ' : ''}${parts.x} ${parts.y} ${parts.blur} ${parts.spread} ${parts.color}`;
}

function ShadowEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const shadow = parseBoxShadow(value);
  const [expanded, setExpanded] = useState(!!shadow);

  const update = (patch: Partial<ShadowParts>) => {
    if (!shadow && !expanded) {
      const base: ShadowParts = { x: '0px', y: '4px', blur: '12px', spread: '0px', color: '#00000033', inset: false };
      const merged = { ...base, ...patch };
      onChange(buildBoxShadow(merged));
      setExpanded(true);
      return;
    }
    if (!shadow) return;
    const merged = { ...shadow, ...patch };
    onChange(buildBoxShadow(merged));
  };

  if (!expanded && !shadow) {
    return (
      <div className="pp-field-row">
        <button type="button" className="pp-icon-btn" data-tooltip="Add shadow" onClick={() => update({})}>
          <Icon name="plus" size={13} />
        </button>
        <span className="pp-field-label" style={{ fontSize: 11, opacity: 0.7 }}>Drop shadow</span>
      </div>
    );
  }

  if (!shadow) return null;
  const s = shadow;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="pp-field-row" style={{ justifyContent: 'space-between' }}>
        <span className="pp-field-label" style={{ fontSize: 11, fontWeight: 500 }}>Drop shadow</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            type="button"
            className="pp-icon-btn"
            data-tooltip={s.inset ? 'Outer shadow' : 'Inner shadow'}
            onClick={() => update({ inset: !s.inset })}
            style={s.inset ? { background: 'var(--selected-soft)', borderColor: 'var(--selected)' } : undefined}
          >
            <Icon name="layers-filled" size={12} />
          </button>
          <button
            type="button"
            className="pp-icon-btn"
            data-tooltip="Remove shadow"
            onClick={() => { onChange(''); setExpanded(false); }}
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      </div>
      <div className="pp-field-pair">
        <UnitRow label="X" value={s.x} onChange={(v) => update({ x: v })} unit="px" autoUnit />
        <UnitRow label="Y" value={s.y} onChange={(v) => update({ y: v })} unit="px" autoUnit />
      </div>
      <div className="pp-field-pair">
        <UnitRow label="B" value={s.blur} onChange={(v) => update({ blur: v })} unit="px" autoUnit />
        <UnitRow label="S" value={s.spread} onChange={(v) => update({ spread: v })} unit="px" autoUnit />
      </div>
      <ColorRow label="" value={s.color} onChange={(v) => update({ color: v })} compact />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Collapsible Section
   ═══════════════════════════════════════════════════════════════════════════ */

function Section({ title, id, children, collapsed, onToggle, actions }: {
  title: string; id: string; children: React.ReactNode;
  collapsed: Set<string>; onToggle: (id: string) => void;
  actions?: React.ReactNode;
}) {
  const isCollapsed = collapsed.has(id);
  return (
    <div className="pp-section">
      <div className="pp-section-head-row">
        <button
          type="button"
          className={`pp-section-head${isCollapsed ? ' pp-section-collapsed' : ''}`}
          onClick={() => onToggle(id)}
        >
          <span className="pp-section-chevron">▾</span>
          {title}
        </button>
        {actions ? <div className="pp-section-actions">{actions}</div> : null}
      </div>
      {!isCollapsed ? <div className="pp-section-body">{children}</div> : null}
    </div>
  );
}

function canAlignSelectedTargets(targets: ManualEditTarget[]): boolean {
  if (targets.length < 2) return false;
  const parentId = targets[0]?.parentId;
  if (!parentId) return false;
  return targets.every((target) => (
    target.parentId === parentId && !isAutoLayoutDisplay(target.parentLayout?.display ?? '')
  ));
}

function isAutoLayoutDisplay(display: string): boolean {
  return display.includes('flex') || display.includes('grid');
}

function AlignmentToolbar({
  targets,
  onApplyPatch,
}: {
  targets: ManualEditTarget[];
  onApplyPatch: (patch: ManualEditPatch, label: string) => void;
}) {
  const rects = targets.reduce<Record<string, ManualEditTarget['rect']>>((acc, target) => {
    acc[target.id] = target.rect;
    return acc;
  }, {});
  const apply = (mode: ManualEditAlignMode, label: string) => {
    onApplyPatch({
      kind: 'align-elements',
      ids: targets.map((target) => target.id),
      mode,
      rects,
    }, label);
  };
  const buttons: Array<{
    mode: ManualEditAlignMode;
    label: string;
    icon: ManualEditIconName;
  }> = [
    { mode: 'left', label: 'Align left', icon: 'align-left' },
    { mode: 'center-x', label: 'Align horizontal center', icon: 'align-center-x' },
    { mode: 'right', label: 'Align right', icon: 'align-right' },
    { mode: 'top', label: 'Align top', icon: 'align-top' },
    { mode: 'center-y', label: 'Align vertical center', icon: 'align-center-y' },
    { mode: 'bottom', label: 'Align bottom', icon: 'align-bottom' },
    { mode: 'distribute-x', label: 'Distribute horizontally', icon: 'distribute-horizontal' },
    { mode: 'distribute-y', label: 'Distribute vertically', icon: 'distribute-vertical' },
  ];
  return (
    <div className="pp-alignment-toolbar" aria-label="Alignment">
      {buttons.map((button) => (
        <button
          key={button.mode}
          type="button"
          className="pp-icon-btn"
          data-align-action={button.mode}
          data-tooltip={button.label}
          onClick={() => apply(button.mode, button.label)}
        >
          <ManualEditIcon name={button.icon} />
        </button>
      ))}
    </div>
  );
}

type ManualEditIconName =
  | 'vertical'
  | 'horizontal'
  | 'wrap'
  | 'vertical-gap'
  | 'horizontal-gap'
  | 'vertical-margin'
  | 'horizontal-margin'
  | 'expanded-margin'
  | 'distribute-vertical'
  | 'distribute-horizontal'
  | 'align-left'
  | 'align-center-x'
  | 'align-right'
  | 'align-top'
  | 'align-center-y'
  | 'align-bottom';

function ManualEditIcon({ name }: { name: ManualEditIconName }) {
  if (isAlignIconName(name)) return <InlineAlignIcon name={name} />;
  return (
    <img
      src={`/manual-edit-icons/${name}.svg`}
      alt=""
      aria-hidden="true"
      className="pp-asset-icon"
    />
  );
}

function isAlignIconName(name: ManualEditIconName): name is Extract<ManualEditIconName, `align-${string}`> {
  return name === 'align-left'
    || name === 'align-center-x'
    || name === 'align-right'
    || name === 'align-top'
    || name === 'align-center-y'
    || name === 'align-bottom';
}

function InlineAlignIcon({ name }: { name: Extract<ManualEditIconName, `align-${string}`> }) {
  const guide = name === 'align-left' || name === 'align-center-x' || name === 'align-right'
    ? 'vertical'
    : 'horizontal';
  const lineX = name === 'align-left' ? 4 : name === 'align-right' ? 12 : 8;
  const lineY = name === 'align-top' ? 4 : name === 'align-bottom' ? 12 : 8;
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {guide === 'vertical' ? (
        <>
          <path d={`M${lineX} 2.5v11`} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <rect x={name === 'align-right' ? 5 : name === 'align-center-x' ? 5 : 4} y="4" width="7" height="3" rx="0.8" fill="currentColor" opacity="0.35" />
          <rect x={name === 'align-right' ? 7 : name === 'align-center-x' ? 4 : 4} y="9" width="5" height="3" rx="0.8" fill="currentColor" opacity="0.55" />
        </>
      ) : (
        <>
          <path d={`M2.5 ${lineY}h11`} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <rect x="4" y={name === 'align-bottom' ? 5 : name === 'align-center-y' ? 5 : 4} width="3" height="7" rx="0.8" fill="currentColor" opacity="0.35" />
          <rect x="9" y={name === 'align-bottom' ? 7 : name === 'align-center-y' ? 4 : 4} width="3" height="5" rx="0.8" fill="currentColor" opacity="0.55" />
        </>
      )}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SVG layout direction icons
   ═══════════════════════════════════════════════════════════════════════════ */

/** No auto layout — dashed rectangle */
function SvgLayoutNone() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pp-svg-layout">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" />
    </svg>
  );
}

/** Vertical layout — container with two stacked items */
function SvgLayoutVertical() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pp-svg-layout">
      <rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <rect x="5" y="3.5" width="6" height="3.5" rx="0.8" fill="currentColor" opacity="0.5" />
      <rect x="5" y="9" width="6" height="3.5" rx="0.8" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Horizontal layout — container with two side-by-side items */
function SvgLayoutHorizontal() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pp-svg-layout">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <rect x="3.5" y="5" width="3.5" height="6" rx="0.8" fill="currentColor" opacity="0.5" />
      <rect x="9" y="5" width="3.5" height="6" rx="0.8" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** CSS Grid layout — 2×2 grid of items */
function SvgLayoutGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pp-svg-layout">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <rect x="3.5" y="3.5" width="4" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
      <rect x="8.5" y="3.5" width="4" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
      <rect x="3.5" y="8.5" width="4" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
      <rect x="8.5" y="8.5" width="4" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Flex wrap: two rows of items wrapping */
function SvgFlexWrap({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pp-svg-layout">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <rect x="3.5" y="3.5" width="5" height="3" rx="0.8" fill="currentColor" opacity="0.5" />
      <rect x="9" y="3.5" width="3.5" height="3" rx="0.8" fill="currentColor" opacity="0.5" />
      <rect x="3.5" y="8.5" width="3.5" height="3" rx="0.8" fill="currentColor" opacity={active ? 0.5 : 0.25} />
      <rect x="7.5" y="8.5" width="5" height="3" rx="0.8" fill="currentColor" opacity={active ? 0.5 : 0.25} />
      {active && <line x1="3" y1="7.5" x2="13" y2="7.5" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1.5" opacity="0.4" />}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Figma-style alignment grid (9 icons in a box)
   Each cell shows a small rectangle with a dot indicating alignment position.
   ═══════════════════════════════════════════════════════════════════════════ */

/** SVG icon showing alignment position: a rounded rect with a dot */
function SvgAlignDot({ row, col }: { row: number; col: number }) {
  // Map row/col (0-2) to SVG coordinates for the dot
  const cx = 4 + col * 6; // 4, 10, 16
  const cy = 4 + row * 6; // 4, 10, 16
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="1.5" y="1.5" width="17" height="17" rx="3" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <circle cx={cx} cy={cy} r="2.5" fill="currentColor" />
    </svg>
  );
}

function AlignGrid({ flexDirection, justifyValue, alignValue, onJustifyChange, onAlignChange }: {
  flexDirection: string;
  justifyValue: string;
  alignValue: string;
  onJustifyChange: (v: string) => void;
  onAlignChange: (v: string) => void;
}) {
  const positions = ['flex-start', 'center', 'flex-end'] as const;
  const isColumn = flexDirection.startsWith('column');
  const cells: Array<{ row: number; col: number; justify: string; align: string }> = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const rowPosition = positions[row] ?? 'center';
      const colPosition = positions[col] ?? 'center';
      cells.push({
        row,
        col,
        justify: isColumn ? rowPosition : colPosition,
        align: isColumn ? colPosition : rowPosition,
      });
    }
  }

  // Determine active cell based on current justify + align values
  const activeCell = cells.find(
    (c) => c.justify === justifyValue && c.align === alignValue,
  );

  // Build a 3x3 grid
  const grid: (typeof cells[number] | null)[][] = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  for (const cell of cells) {
    grid[cell.row]![cell.col] = cell;
  }

  return (
    <div className="pp-align-grid-box">
      {grid.flatMap((row, r) =>
        row.map((cell, c) => {
          const isActive = activeCell?.row === r && activeCell?.col === c;
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              className={`pp-align-dot${isActive ? ' pp-align-dot-active' : ''}`}
              data-tooltip={cell ? `${cell.justify} / ${cell.align}` : ''}
              data-tooltip-placement="left"
              data-align-row={r}
              data-align-col={c}
              onClick={() => {
                if (cell) {
                  onJustifyChange(cell.justify);
                  onAlignChange(cell.align);
                }
              }}
            >
              <SvgAlignDot row={r} col={c} />
            </button>
          );
        }),
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SVG edge icon for stroke-side expansion
   ═══════════════════════════════════════════════════════════════════════════ */

/** Collapsed: 2 edges (top & bottom) */
function SvgTwoEdges() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Stroke Editor (expandable, with position/style/dash controls)
   ═══════════════════════════════════════════════════════════════════════════ */

function StrokeEditor({ border, borderTopWidth, borderRightWidth, borderBottomWidth, borderLeftWidth, borderColor, borderStyle, onChange }: {
  border: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderColor: string;
  borderStyle: string;
  onChange: (key: keyof ManualEditStyles, value: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [strokePosition, setStrokePosition] = useState<'center' | 'inside' | 'outside'>('center');
  const [dashGap, setDashGap] = useState('');

  // Extract width from individual sides or border shorthand
  const borderNumeric = stripBorderWidth(borderTopWidth) || stripBorderWidth(border);

  const handleWidthChange = (v: string) => {
    onChange('borderTopWidth', v);
    onChange('borderRightWidth', v);
    onChange('borderBottomWidth', v);
    onChange('borderLeftWidth', v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Color + width row */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <ColorRow label="" value={borderColor} onChange={(v) => onChange('borderColor', v)} compact />
        <UnitRow label={t('manualEdit.label.strokeWidth')} value={borderNumeric || ''} onChange={handleWidthChange} unit="px" autoUnit min={0} />
      </div>

      {/* Toolbar: expand, position, style, dash */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`pp-icon-btn${expanded ? ' pp-icon-btn-active' : ''}`}
          data-tooltip={t('manualEdit.label.expandStroke')}
          onClick={() => setExpanded((v) => !v)}
        >
          <SvgTwoEdges />
        </button>

        {/* Stroke position: center / inside / outside */}
        <button
          type="button"
          className={`pp-icon-btn${strokePosition === 'center' ? ' pp-icon-btn-active' : ''}`}
          data-tooltip={t('manualEdit.label.strokeCenter')}
          onClick={() => setStrokePosition('center')}
        >
          <SvgStrokeCenter />
        </button>
        <button
          type="button"
          className={`pp-icon-btn${strokePosition === 'inside' ? ' pp-icon-btn-active' : ''}`}
          data-tooltip={t('manualEdit.label.strokeInside')}
          onClick={() => setStrokePosition('inside')}
        >
          <SvgStrokeInside />
        </button>
        <button
          type="button"
          className={`pp-icon-btn${strokePosition === 'outside' ? ' pp-icon-btn-active' : ''}`}
          data-tooltip={t('manualEdit.label.strokeOutside')}
          onClick={() => setStrokePosition('outside')}
        >
          <SvgStrokeOutside />
        </button>

        <span style={{ width: 4 }} />

        {/* Stroke style: solid / dashed */}
        <button
          type="button"
          className={`pp-icon-btn${borderStyle !== 'dashed' ? ' pp-icon-btn-active' : ''}`}
          data-tooltip={t('manualEdit.label.strokeSolid')}
          onClick={() => onChange('borderStyle', 'solid')}
        >
          <SvgStrokeSolid />
        </button>
        <button
          type="button"
          className={`pp-icon-btn${borderStyle === 'dashed' ? ' pp-icon-btn-active' : ''}`}
          data-tooltip={t('manualEdit.label.strokeDashed')}
          onClick={() => onChange('borderStyle', 'dashed')}
        >
          <SvgStrokeDashed />
        </button>
      </div>

      {/* Dash gap input (only when dashed) */}
      {borderStyle === 'dashed' ? (
        <UnitRow label={t('manualEdit.label.dashGap')} value={dashGap} onChange={setDashGap} unit="px" autoUnit min={0} />
      ) : null}

      {/* Expanded: individual side widths */}
      {expanded ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <UnitRow label="T" value={stripBorderWidth(borderTopWidth || border)} onChange={(v) => onChange('borderTopWidth', v)} unit="px" autoUnit min={0} />
          <UnitRow label="R" value={stripBorderWidth(borderRightWidth || border)} onChange={(v) => onChange('borderRightWidth', v)} unit="px" autoUnit min={0} />
          <UnitRow label="B" value={stripBorderWidth(borderBottomWidth || border)} onChange={(v) => onChange('borderBottomWidth', v)} unit="px" autoUnit min={0} />
          <UnitRow label="L" value={stripBorderWidth(borderLeftWidth || border)} onChange={(v) => onChange('borderLeftWidth', v)} unit="px" autoUnit min={0} />
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SVG stroke icons
   ═══════════════════════════════════════════════════════════════════════════ */

/** Stroke position: center */
function SvgStrokeCenter() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Stroke position: inside */
function SvgStrokeInside() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Stroke position: outside */
function SvgStrokeOutside() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
    </svg>
  );
}

/** Solid stroke line */
function SvgStrokeSolid() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Dashed stroke line */
function SvgStrokeDashed() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
    </svg>
  );
}

type SizingMode = 'content' | 'fixed' | 'fill';

function SizingModeSelect({ axis, value, testId, onChange }: {
  axis: 'width' | 'height';
  value: SizingMode;
  testId: string;
  onChange: (value: SizingMode) => void;
}) {
  return (
    <label className="pp-size-mode-field" data-size-axis={axis}>
      <span className="pp-size-mode-icon" aria-hidden="true">
        <SvgSizeAxis axis={axis} />
      </span>
      <select
        data-testid={testId}
        className="pp-size-mode-select"
        value={value}
        aria-label={axis === 'width' ? 'Width sizing mode' : 'Height sizing mode'}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next === 'fill' || next === 'content' ? next : 'fixed');
        }}
      >
        <option value="content">适应内容</option>
        <option value="fixed">{axis === 'width' ? '固定宽度' : '固定高度'}</option>
        <option value="fill">撑满容器</option>
      </select>
    </label>
  );
}

function SvgSizeAxis({ axis }: { axis: 'width' | 'height' }) {
  if (axis === 'width') {
    return (
      <svg data-size-icon="width" width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="2.5" y="4.5" width="10" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.5 7.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M5.8 6.2 4.5 7.5l1.3 1.3M9.2 6.2l1.3 1.3-1.3 1.3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg data-size-icon="height" width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="4.5" y="2.5" width="6" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7.5 4.5v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6.2 5.8 7.5 4.5l1.3 1.3M6.2 9.2l1.3 1.3 1.3-1.3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ScrubInput — shared mini drag-to-scrub input for gap/margin fields
   Extracted as a top-level component so React does NOT unmount/remount
   on every parent render (which would reset the input and break dragging).
   ═══════════════════════════════════════════════════════════════════════════ */

function ScrubInput({ value, onChange, placeholder, spacingSide }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  spacingSide?: 'top' | 'right' | 'bottom' | 'left' | 'horizontal' | 'vertical' | 'main';
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const display = stripPxUnit(value);
  const numeric = isNumericInput(display);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onDown = useCallback((e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!numeric) return;
    e.preventDefault();
    const startX = e.clientX;
    const startVal = Number(display);
    const divisor = 3;
    const shiftMultiplier = 5;
    const ownerDoc = inputRef.current?.ownerDocument ?? document;
    const onMove = (me: PointerEvent) => {
      const raw = Math.round((me.clientX - startX) / divisor);
      const delta = me.shiftKey ? raw * shiftMultiplier : raw;
      if (delta === 0) return;
      const next = Math.max(0, startVal + delta);
      onChangeRef.current(`${next}px`);
    };
    const onUp = () => {
      ownerDoc.removeEventListener('pointermove', onMove);
      ownerDoc.removeEventListener('pointerup', onUp);
      ownerDoc.removeEventListener('pointercancel', onUp);
    };
    ownerDoc.addEventListener('pointermove', onMove);
    ownerDoc.addEventListener('pointerup', onUp);
    ownerDoc.addEventListener('pointercancel', onUp);
  }, [numeric, display]);

  return (
    <div className="pp-gap-field" data-spacing-side={spacingSide}>
      <span
        className={`pp-gap-field-label${numeric ? ' pp-gap-drag' : ''}`}
        onPointerDown={onDown}
      >
        <SpacingIcon side={spacingSide} fallback={placeholder} />
      </span>
      <input
        ref={inputRef}
        value={display}
        placeholder="0"
        onChange={(e) => {
          const raw = e.currentTarget.value.trim();
          const val = raw && isNumericInput(raw) ? `${raw}px` : raw;
          onChange(val);
        }}
      />
    </div>
  );
}

function SpacingIcon({ side, fallback }: {
  side?: 'top' | 'right' | 'bottom' | 'left' | 'horizontal' | 'vertical' | 'main';
  fallback?: string;
}) {
  if (!side) return <>{fallback}</>;
  const iconName = side === 'main' ? 'spacing-gap' : `spacing-${side}`;
  if (side === 'horizontal' || side === 'vertical' || side === 'main') {
    const asset = side === 'horizontal'
      ? 'horizontal-margin'
      : side === 'vertical'
        ? 'vertical-margin'
        : 'horizontal-gap';
    return (
      <img
        src={`/manual-edit-icons/${asset}.svg`}
        alt=""
        aria-hidden="true"
        className="pp-asset-icon"
        data-spacing-icon={iconName}
      />
    );
  }
  const sideAsset = {
    top: 'spacing-top',
    right: 'spacing-right',
    bottom: 'spacing-bottom',
    left: 'spacing-left',
  }[side];
  return (
    <img
      src={`/manual-edit-icons/${sideAsset}.svg`}
      alt=""
      aria-hidden="true"
      className="pp-asset-icon"
      data-spacing-icon={iconName}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Gap panel (padding controls + main-axis gap control)
   Collapsed: padding left+right / top+bottom pairs
   Expanded: 4 individual padding directions
   Gap writes only the current flex main-axis gap
   ═══════════════════════════════════════════════════════════════════════════ */

function GapPanel({
  mainAxisGap,
  mainAxisGapLabel,
  onMainAxisGapChange,
  paddingTop,
  paddingRight,
  paddingBottom,
  paddingLeft,
  onPaddingChange,
  onArrangementChange,
}: {
  mainAxisGap: string;
  mainAxisGapLabel: string;
  onMainAxisGapChange: (v: string) => void;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  onPaddingChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void;
  onArrangementChange: (axis: 'vertical' | 'horizontal') => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  // Collapsed mode shows combined padding pairs
  const paddingH = paddingLeft || paddingRight || '0px';
  const paddingV = paddingTop || paddingBottom || '0px';

  return (
    <div className="pp-gap-panel">
      <div className="pp-gap-header">
        <span className="cc-label cc-label-scrub">{t('manualEdit.label.padding')}</span>
        <span className="pp-spacing-header-actions" aria-hidden="false">
          <button
            type="button"
            className={`pp-gap-toggle${expanded ? ' pp-gap-toggle-active' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            data-tooltip={expanded ? t('manualEdit.label.collapseSpacing') : t('manualEdit.label.expandSpacing')}
          >
            <ManualEditIcon name="expanded-margin" />
          </button>
          <button
            type="button"
            className="pp-gap-toggle"
            data-padding-arrangement="vertical"
            data-tooltip="Vertical space between"
            onClick={() => onArrangementChange('vertical')}
          >
            <ManualEditIcon name="vertical-margin" />
          </button>
          <button
            type="button"
            className="pp-gap-toggle"
            data-padding-arrangement="horizontal"
            data-tooltip="Horizontal space between"
            onClick={() => onArrangementChange('horizontal')}
          >
            <ManualEditIcon name="horizontal-margin" />
          </button>
        </span>
      </div>
      {expanded ? (
        <div className="pp-gap-fields">
          <div className="pp-gap-row">
            <ScrubInput placeholder="↑" spacingSide="top" value={paddingTop} onChange={(v) => onPaddingChange('t', v)} />
            <ScrubInput placeholder="↓" spacingSide="bottom" value={paddingBottom} onChange={(v) => onPaddingChange('b', v)} />
          </div>
          <div className="pp-gap-row">
            <ScrubInput placeholder="←" spacingSide="left" value={paddingLeft} onChange={(v) => onPaddingChange('l', v)} />
            <ScrubInput placeholder="→" spacingSide="right" value={paddingRight} onChange={(v) => onPaddingChange('r', v)} />
          </div>
        </div>
      ) : (
        <div className="pp-gap-fields">
          <ScrubInput placeholder="↔" spacingSide="horizontal" value={paddingH} onChange={(v) => { onPaddingChange('l', v); onPaddingChange('r', v); }} />
          <ScrubInput placeholder="↕" spacingSide="vertical" value={paddingV} onChange={(v) => { onPaddingChange('t', v); onPaddingChange('b', v); }} />
        </div>
      )}
      <div className="pp-gap-fields pp-main-axis-gap" style={{ marginTop: 2 }}>
        <ScrubInput placeholder={mainAxisGapLabel} spacingSide="main" value={mainAxisGap} onChange={onMainAxisGapChange} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Margin panel (always show 4 individual direction values)
   ═══════════════════════════════════════════════════════════════════════════ */

function MarginPanel({ marginTop, marginRight, marginBottom, marginLeft, onChange }: {
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  onChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void;
}) {
  const t = useT();

  return (
    <div className="pp-gap-panel">
      <div className="pp-gap-header">
        <span className="cc-label">{t('manualEdit.label.outerMargin')}</span>
      </div>
      <div className="pp-gap-fields">
        <div className="pp-gap-row">
          <ScrubInput placeholder="↑" spacingSide="top" value={marginTop} onChange={(v) => onChange('t', v)} />
          <ScrubInput placeholder="↓" spacingSide="bottom" value={marginBottom} onChange={(v) => onChange('b', v)} />
        </div>
        <div className="pp-gap-row">
          <ScrubInput placeholder="←" spacingSide="left" value={marginLeft} onChange={(v) => onChange('l', v)} />
          <ScrubInput placeholder="→" spacingSide="right" value={marginRight} onChange={(v) => onChange('r', v)} />
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   Reusable sub-components (kept from original)
   ═══════════════════════════════════════════════════════════════════════════ */

function readableManualEditTargetName(target: ManualEditTarget): string {
  const explicit = firstReadableText(
    target.attributes['data-od-label'],
    target.attributes['aria-label'],
    target.attributes.title,
  );
  if (explicit) return explicit;

  if (target.kind === 'text' || target.kind === 'link' || target.kind === 'token') {
    const textName = readableContentName(target.text || target.fields.text || target.label);
    if (textName) return textName;
  }
  if (target.kind === 'image') {
    const imageName = readableContentName(target.fields.alt || target.label);
    if (imageName) return imageName;
  }

  const identifierName = readableIdentifierName(
    target.attributes.id ||
    target.attributes['data-od-id'] ||
    target.id,
  );
  if (identifierName) return identifierName;

  const className = readableClassName(target.className);
  if (className) return className;

  const labelName = readableContentName(target.label);
  if (labelName && !looksCodeLikeLabel(labelName)) return labelName;

  if (target.kind === 'container') return 'Container';
  if (target.kind === 'image') return 'Image';
  if (target.kind === 'link') return 'Link';
  return 'Text';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sizeModeFor(value: string): SizingMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === '100%') return 'fill';
  if (!normalized || normalized === 'auto' || normalized === 'fit-content' || normalized === 'max-content') return 'content';
  return 'fixed';
}

function sizeValueForMode(mode: SizingMode, measuredPx: number): string {
  if (mode === 'content') return 'auto';
  if (mode === 'fill') return '100%';
  return `${Math.max(0, measuredPx)}px`;
}

function firstReadableText(...values: Array<string | undefined>): string {
  for (const value of values) {
    const readable = readableContentName(value);
    if (readable) return readable;
  }
  return '';
}

function readableContentName(value: string | undefined): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (looksGeneratedIdentifier(clean)) return '';
  return clean.length > 42 ? `${clean.slice(0, 39).trim()}...` : clean;
}

function readableIdentifierName(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw || looksGeneratedIdentifier(raw)) return '';
  const lastSelectorPart = (raw.includes('.') ? raw.split('.').filter(Boolean).at(-1) : raw) ?? '';
  const lastIdPart = (lastSelectorPart.includes('#') ? lastSelectorPart.split('#').filter(Boolean).at(-1) : lastSelectorPart) ?? '';
  return humanizeIdentifier(lastIdPart);
}

function readableClassName(value: string | undefined): string {
  const classes = (value ?? '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
  const candidate = classes.find((item) => {
    const lower = item.toLowerCase();
    return !looksGeneratedIdentifier(item) && !['container', 'wrapper', 'group', 'section', 'row', 'col'].includes(lower);
  }) ?? classes.find((item) => !looksGeneratedIdentifier(item));
  return humanizeIdentifier(candidate);
}

function humanizeIdentifier(value: string | undefined): string {
  const clean = (value ?? '')
    .replace(/^[_#.\s-]+|[_#.\s-]+$/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || looksGeneratedIdentifier(clean)) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function looksCodeLikeLabel(value: string): boolean {
  return /^[a-z][a-z0-9-]*(?:[#.][\w-]+)+$/i.test(value) || /^[a-z][a-z0-9-]*\s+#/.test(value);
}

function looksGeneratedIdentifier(value: string): boolean {
  return /^path(?:-\d+)+$/i.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

function PageInspector({
  enabled,
  onStyleChange,
}: {
  enabled: boolean;
  onStyleChange: (styles: Partial<ManualEditStyles>) => void;
}) {
  const t = useT();
  const [bg, setBg] = useState('');
  const [font, setFont] = useState('');
  const [size, setSize] = useState('');
  const update = (next: { bg?: string; font?: string; size?: string }) => {
    if ('bg' in next) {
      const value = next.bg ?? '';
      setBg(value);
      onStyleChange({ backgroundColor: value });
    }
    if ('font' in next) {
      const value = next.font ?? '';
      setFont(value);
      onStyleChange({ fontFamily: value });
    }
    if ('size' in next) {
      const value = next.size ?? '';
      setSize(value);
      onStyleChange({ fontSize: value });
    }
  };

  return (
    <div className="pp-section">
      <div className="pp-section-body">
        {enabled ? (
          <>
            <ColorRow label={t('manualEdit.background')} value={bg} onChange={(value) => update({ bg: value })} />
            <FontRow value={font} onChange={(value) => update({ font: value })} />
            <UnitRow label={t('manualEdit.fontSize')} value={size} onChange={(value) => update({ size: value })} unit="px" autoUnit />
          </>
        ) : (
          <p className="cc-section-hint">Page styles are available only for full HTML documents.</p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Constants & helpers
   ═══════════════════════════════════════════════════════════════════════════ */

const FONT_OPTS = [
  { label: 'inherit', value: '' },
  { label: 'Space Grotesk', value: '"Space Grotesk", Inter, system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Roboto', value: 'Roboto, Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'monospace', value: 'SFMono-Regular, Consolas, "Liberation Mono", monospace' },
] as const;
const WEIGHT_OPTS = ['', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const ALIGN_OPTS = ['', 'left', 'center', 'right', 'justify', 'start', 'end'];
const DIRECTION_OPTS = ['', 'row', 'column', 'row-reverse', 'column-reverse'];
const JUSTIFY_OPTS = ['', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'];
const ITEMS_OPTS = ['', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
const BORDER_STYLE_OPTS = ['', 'solid', 'dashed', 'dotted', 'double', 'none'];
const EDITOR_SWATCH_COLORS = [
  '#000000', '#ffffff', '#374151', '#ef4444', '#f97316', '#f59e0b',
  '#84cc16', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
] as const;

type NormalizeResult =
  | { ok: true; styles: Partial<ManualEditStyles> }
  | { ok: false; error: string };

const PX_STYLE_PROPS = new Set<keyof ManualEditStyles>([
  'fontSize', 'letterSpacing', 'width', 'height', 'minHeight', 'gap', 'columnGap', 'rowGap',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius',
]);
const COLOR_STYLE_PROPS = new Set<keyof ManualEditStyles>(['color', 'backgroundColor', 'borderColor']);
const SELECT_STYLE_OPTIONS: Partial<Record<keyof ManualEditStyles, ReadonlyArray<string>>> = {
  fontFamily: FONT_OPTS.map((option) => option.value),
  fontWeight: WEIGHT_OPTS,
  textAlign: ALIGN_OPTS,
  display: ['', 'block', 'flex', 'inline-flex', 'grid'],
  flexDirection: DIRECTION_OPTS,
  justifyContent: JUSTIFY_OPTS,
  alignItems: ITEMS_OPTS,
  borderStyle: BORDER_STYLE_OPTS,
};
const LAYOUT_STYLE_PROPS = new Set<keyof ManualEditStyles>(['display', 'gap', 'columnGap', 'rowGap', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems']);

export function normalizeManualEditStyles(
  styles: Partial<ManualEditStyles>,
  { layoutEnabled }: { layoutEnabled: boolean },
): NormalizeResult {
  const normalized: Partial<ManualEditStyles> = {};
  for (const [rawKey, rawValue] of Object.entries(styles) as Array<[keyof ManualEditStyles, string]>) {
    if (LAYOUT_STYLE_PROPS.has(rawKey) && !layoutEnabled) continue;
    const value = rawValue.trim();
    if (value === '') {
      normalized[rawKey] = '';
      continue;
    }
    if (rawKey === 'width' || rawKey === 'height') {
      const size = normalizeSizeValue(value);
      if (!size) return { ok: false, error: `${styleLabel(rawKey)} must be a number, px, or percent value.` };
      normalized[rawKey] = size;
      continue;
    }
    if (PX_STYLE_PROPS.has(rawKey)) {
      const px = normalizePxValue(value);
      if (!px) return { ok: false, error: `${styleLabel(rawKey)} must be a number or px value.` };
      normalized[rawKey] = px;
      continue;
    }
    if (COLOR_STYLE_PROPS.has(rawKey)) {
      const color = normalizeHexColor(value);
      if (!color) return { ok: false, error: `${styleLabel(rawKey)} must be a hex color.` };
      normalized[rawKey] = color;
      continue;
    }
    if (rawKey === 'opacity') {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Opacity must be a number.' };
      normalized.opacity = String(Math.max(0, Math.min(1, n)));
      continue;
    }
    if (rawKey === 'lineHeight') {
      const lineHeight = normalizeLineHeightValue(value);
      if (!lineHeight) return { ok: false, error: 'Line height must be a positive number or px value.' };
      normalized.lineHeight = lineHeight;
      continue;
    }
    const options = SELECT_STYLE_OPTIONS[rawKey];
    if (options) {
      if (!options.includes(value)) return { ok: false, error: `${styleLabel(rawKey)} has an unsupported value.` };
      normalized[rawKey] = value;
      continue;
    }
    normalized[rawKey] = value;
  }
  return { ok: true, styles: normalized };
}

function normalizePxValue(value: string): string | null {
  if (/^-?\d+(\.\d+)?$/.test(value)) return `${value}px`;
  if (/^-?\d+(\.\d+)?px$/i.test(value)) return value.toLowerCase();
  return null;
}

function normalizeSizeValue(value: string): string | null {
  const px = normalizePxValue(value);
  if (px) return px;
  if (/^\d+(\.\d+)?%$/.test(value)) return value;
  if (value.toLowerCase() === 'auto') return 'auto';
  return null;
}

function normalizeLineHeightValue(value: string): string | null {
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 0 ? String(n) : null;
  }
  if (/^\d+(\.\d+)?px$/i.test(value)) {
    const n = Number(value.slice(0, -2));
    return n > 0 ? value.toLowerCase() : null;
  }
  return null;
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function styleLabel(key: keyof ManualEditStyles): string {
  return key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Input sub-components
   ═══════════════════════════════════════════════════════════════════════════ */

function UnitRow({ label, value, onChange, unit, autoUnit, disabled, min, max }: {
  label: string; value: string; onChange: (v: string) => void;
  unit: string; autoUnit?: boolean; disabled?: boolean;
  min?: number; max?: number;
}) {
  const display = unit === 'px' ? stripPxUnit(value) : value;
  const step = unit === 'px' ? 1 : 0.1;
  const canStep = !disabled && isNumericInput(display);
  const valueFromDisplay = (raw: string) => {
    const trimmed = raw.trim();
    if (autoUnit && trimmed && isNumericInput(trimmed)) return `${trimmed}px`;
    if (autoUnit && /^-?\d+(\.\d+)?px$/i.test(trimmed)) return trimmed.toLowerCase();
    return raw;
  };
  // Clamp a stepped value to min/max bounds
  const clampValue = (num: number): number => {
    if (min !== undefined && num < min) return min;
    if (max !== undefined && num > max) return max;
    return num;
  };
  const handle = (raw: string) => {
    const next = valueFromDisplay(raw);
    if (next !== value) onChange(next);
  };

  // Drag-to-scrub on the label (Figma-style)
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const onLabelPointerDown = useCallback((e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!canStep) return;
    e.preventDefault();
    const startX = e.clientX;
    const startVal = Number(display);
    const divisor = 3;
    const shiftMultiplier = 5;
    const ownerDoc = labelRef.current?.ownerDocument ?? document;
    const onMove = (me: PointerEvent) => {
      const raw = Math.round((me.clientX - startX) / divisor);
      const delta = me.shiftKey ? raw * shiftMultiplier : raw;
      if (delta === 0) return;
      const stepped = formatSteppedNumber(startVal + delta * step, display, step);
      const clamped = clampValue(Number(stepped));
      onChange(valueFromDisplay(String(clamped)));
    };
    const onUp = () => {
      ownerDoc.removeEventListener('pointermove', onMove);
      ownerDoc.removeEventListener('pointerup', onUp);
      ownerDoc.removeEventListener('pointercancel', onUp);
    };
    ownerDoc.addEventListener('pointermove', onMove);
    ownerDoc.addEventListener('pointerup', onUp);
    ownerDoc.addEventListener('pointercancel', onUp);
  }, [canStep, display, step, autoUnit, value, min, max]);

  // Show unit suffix for %
  const showUnit = unit === '%';

  return (
    <label className="cc-row">
      <span
        ref={labelRef}
        className={`cc-label${canStep ? ' cc-label-scrub' : ''}`}
        style={canStep ? { paddingLeft: 10, paddingRight: 10 } : undefined}
        onPointerDown={onLabelPointerDown}
      >{label}</span>
      <span className="cc-value">
        <input value={display} placeholder="" disabled={disabled} onChange={(e) => onChange(valueFromDisplay(e.currentTarget.value))} onBlur={(e) => handle(e.currentTarget.value)} />
        {showUnit ? <em className="cc-unit">{unit}</em> : null}
      </span>
    </label>
  );
}

function DropdownRow({ label, value, onChange, options, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: ReadonlyArray<string>; placeholder?: string; disabled?: boolean;
}) {
  return (
    <label className="cc-row">
      <span className="cc-label">{label}</span>
      <span className="cc-value cc-select">
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
          {!options.includes(value) && value ? <option value={value}>{value}</option> : null}
          {options.map((opt) => <option key={opt || '__'} value={opt}>{opt || (placeholder ?? '–')}</option>)}
        </select>
        <em className="cc-chevron">▾</em>
      </span>
    </label>
  );
}

function FontRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const normalizedValue = normalizeFontFamilyForSelect(value);
  const customValue = normalizedValue === value ? value : '';
  return (
    <label className="cc-row">
      <span className="cc-label">Font</span>
      <span className="cc-value cc-select">
        <select value={normalizedValue} onChange={(event) => onChange(event.currentTarget.value)}>
          {customValue && !FONT_OPTS.some((option) => option.value === customValue) ? (
            <option value={customValue}>{fontFamilyLabel(customValue)}</option>
          ) : null}
          {FONT_OPTS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
        <em className="cc-chevron">▾</em>
      </span>
    </label>
  );
}

function normalizeFontFamilyForSelect(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const direct = FONT_OPTS.find((option) => option.value === trimmed);
  if (direct) return direct.value;
  const families = parseFontFamilies(trimmed);
  const primaryFamily = families[0];
  const match = FONT_OPTS.find((option) => {
    if (!option.value) return false;
    const optionFamilies = parseFontFamilies(option.value);
    return optionFamilies[0] === primaryFamily;
  });
  return match?.value ?? trimmed;
}

function fontFamilyLabel(value: string): string {
  return parseFontFamilies(value)[0] ?? value;
}

function parseFontFamilies(value: string): string[] {
  return value
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);
}

function ColorRow({ label, value, onChange, compact }: {
  label: string; value: string; onChange: (v: string) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const [popStyle, setPopStyle] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    // Position the popover via fixed positioning so it isn't clipped by parent overflow:hidden
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const popWidth = 168;
      const alignRight = compact || rect.left + popWidth > window.innerWidth - 16;
      setPopStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: alignRight ? undefined : rect.left,
        right: alignRight ? window.innerWidth - rect.right : undefined,
        zIndex: 9999,
      });
    }
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, compact]);
  return (
    <label className="cc-row">
      {compact ? null : <span className="cc-label">{label}</span>}
      <span className={`cc-value cc-color ${compact ? 'cc-color-compact' : ''}`} ref={ref}>
        <button type="button" className="cc-swatch" style={{ background: value || 'transparent' }}
          onClick={() => setOpen((v) => !v)} aria-label={`Pick ${label}`} />
        <input value={value} placeholder="#000000"
          onChange={(e) => onChange(e.currentTarget.value)} onFocus={() => setOpen(true)} />
        {open ? (
          <div className="cc-color-popover" style={popStyle}>
            <div className="cc-color-grid">
              {EDITOR_SWATCH_COLORS.map((hex) => (
                <button key={hex} type="button" className="cc-color-tile" style={{ background: hex }}
                  onClick={() => { onChange(hex); setOpen(false); }} aria-label={hex} />
              ))}
            </div>
            <input type="color" className="cc-color-native" value={normalizeColorForPicker(value)}
              onChange={(e) => onChange(e.currentTarget.value)} />
          </div>
        ) : null}
      </span>
    </label>
  );
}

function QuadRow({ label, values, onChange }: {
  label: string; values: { t: string; r: string; b: string; l: string };
  onChange: (side: 't' | 'r' | 'b' | 'l', value: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const allEqualValue = (() => {
    const v = values.t;
    return v === values.r && v === values.b && v === values.l ? v : null;
  })();
  return (
    <div className="cc-quad">
      <button type="button" className="cc-quad-head" onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        {!open && allEqualValue !== null ? <em>{allEqualValue || '0 px'}</em> : <span className="cc-chevron-small">{open ? '▾' : '▸'}</span>}
      </button>
      {open ? (
        <div className="cc-quad-grid">
          <QuadCell axis="T" value={values.t} onChange={(v) => onChange('t', v)} />
          <QuadCell axis="R" value={values.r} onChange={(v) => onChange('r', v)} />
          <QuadCell axis="B" value={values.b} onChange={(v) => onChange('b', v)} />
          <QuadCell axis="L" value={values.l} onChange={(v) => onChange('l', v)} />
        </div>
      ) : null}
    </div>
  );
}

function QuadCell({ axis, value, onChange }: { axis: string; value: string; onChange: (v: string) => void }) {
  const display = stripPxUnit(value);
  const canStep = isNumericInput(display);
  const stepBy = (direction: -1 | 1) => {
    if (!canStep) return;
    onChange(`${formatSteppedNumber(Number(display) + direction, display, 1)}px`);
  };
  return (
    <span className="cc-quad-cell">
      <em className="cc-quad-axis">{axis}</em>
      <button type="button" className="cc-step cc-step-quad" disabled={!canStep} aria-label={`${axis} decrease`} onClick={() => stepBy(-1)}>−</button>
      <input value={display} placeholder="0"
        onChange={(e) => {
          const raw = e.currentTarget.value.trim();
          if (raw === '') onChange('');
          else if (isNumericInput(raw)) onChange(`${raw}px`);
          else if (/^-?\d+(\.\d+)?px$/i.test(raw)) onChange(raw.toLowerCase());
          else onChange(e.currentTarget.value);
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          const next = v && isNumericInput(v) ? `${v}px` : e.currentTarget.value;
          if (next !== value) onChange(next);
        }} />
      <button type="button" className="cc-step cc-step-quad" disabled={!canStep} aria-label={`${axis} increase`} onClick={() => stepBy(1)}>+</button>
      <em className="cc-quad-unit">px</em>
    </span>
  );
}

function stripPxUnit(value: string): string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  return match?.[1] ?? value;
}

/** Extract the numeric width from a border shorthand like "1px solid rgb(...)" or "none". */
function stripBorderWidth(value: string): string {
  if (!value?.trim()) return '';
  const match = value.match(/^(\d+(?:\.\d+)?px)/i);
  return match?.[1] ?? '';
}

function borderWidthNumber(value: string): number {
  if (!value?.trim()) return 0;
  const match = value.match(/(?:^|\s)(\d+(?:\.\d+)?)px\b/i);
  if (!match) return 0;
  const width = Number(match[1]);
  return Number.isFinite(width) ? width : 0;
}

function hasVisibleFill(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === 'transparent') return false;
  if (/^rgba?\(/i.test(trimmed) && normalizeManualEditInspectorTransparent(value)) return false;
  return true;
}

function normalizeManualEditInspectorTransparent(value: string): boolean {
  const match = value.trim().match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([\d.]+))?\s*\)$/i);
  return !!match && match[1] !== undefined && Number(match[1]) === 0;
}

function hasVisibleStroke(styles: ManualEditStyles): boolean {
  const widths = [
    styles.border,
    styles.borderTopWidth,
    styles.borderRightWidth,
    styles.borderBottomWidth,
    styles.borderLeftWidth,
  ];
  const hasWidth = widths.some((value) => borderWidthNumber(value) > 0);
  const style = styles.borderStyle.trim().toLowerCase();
  const borderShorthand = styles.border.trim().toLowerCase();
  const explicitStyle = style || (/\bnone\b/.test(borderShorthand) ? 'none' : borderShorthand ? 'solid' : '');
  if (explicitStyle === 'none') return false;
  return hasWidth;
}

function hasVisibleShadow(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return !!trimmed && trimmed !== 'none';
}

function isNumericInput(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function formatSteppedNumber(value: number, current: string, step: number): string {
  const decimals = Math.max(decimalPlaces(current), decimalPlaces(String(step)));
  return decimals > 0
    ? value.toFixed(decimals).replace(/\.?0+$/, '')
    : String(Math.round(value));
}

function decimalPlaces(value: string): number {
  const match = value.match(/\.(\d+)/);
  return match?.[1]?.length ?? 0;
}

function sideToProp(base: 'padding' | 'margin', side: 't' | 'r' | 'b' | 'l'): keyof ManualEditStyles {
  return `${base}${sideUpper(side)}` as keyof ManualEditStyles;
}
function sideUpper(side: 't' | 'r' | 'b' | 'l'): 'Top' | 'Right' | 'Bottom' | 'Left' {
  return side === 't' ? 'Top' : side === 'r' ? 'Right' : side === 'b' ? 'Bottom' : 'Left';
}

function normalizeColorForPicker(value: string): string {
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1]!, g = trimmed[2]!, b = trimmed[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(match[1]!)}${toHex(match[2]!)}${toHex(match[3]!)}`;
  }
  return '#000000';
}

export function manualEditPatchSummary(patch: ManualEditPatch): string {
  if (patch.kind === 'set-full-source') return JSON.stringify({ kind: patch.kind, bytes: patch.source.length });
  if (patch.kind === 'set-outer-html') return JSON.stringify({ id: patch.id, kind: patch.kind, bytes: patch.html.length });
  return JSON.stringify(patch);
}
