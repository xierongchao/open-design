export type ManualEditKind = 'text' | 'link' | 'image' | 'container' | 'token';

export interface ManualEditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManualEditFields {
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
}

export interface ManualEditStyles {
  left: string;
  top: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  textAlign: string;
  lineHeight: string;
  letterSpacing: string;
  width: string;
  height: string;
  minHeight: string;
  display: string;
  gap: string;
  columnGap: string;
  rowGap: string;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  backgroundColor: string;
  backgroundImage: string;
  opacity: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  border: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderStyle: string;
  borderColor: string;
  borderRadius: string;
  transform: string;
  overflow: string;
  boxShadow: string;
}

export interface ManualEditTarget {
  id: string;
  kind: ManualEditKind;
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: ManualEditRect;
  fields: ManualEditFields;
  attributes: Record<string, string>;
  styles: ManualEditStyles;
  isLayoutContainer: boolean;
  parentId?: string;
  parentLayout?: {
    display: string;
    flexDirection: string;
  };
  isHidden?: boolean;
  outerHtml: string;
}

export type ManualEditMovePosition = 'before' | 'after' | 'inside-start' | 'inside-end';
export type ManualEditAlignMode =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y';

export type ManualEditPatch =
  | { id: string; kind: 'set-text'; value: string }
  | { id: string; kind: 'set-link'; text: string; href: string }
  | { id: string; kind: 'set-image'; src: string; alt: string }
  | { id: string; kind: 'move-element'; targetId: string; position: ManualEditMovePosition }
  | { id: string; kind: 'remove-element' }
  | { kind: 'set-token'; token: string; value: string }
  | { id: string; kind: 'set-style'; styles: Partial<ManualEditStyles> }
  | { kind: 'set-style-batch'; items: Array<{ id: string; styles: Partial<ManualEditStyles> }> }
  | { kind: 'align-elements'; ids: string[]; mode: ManualEditAlignMode; rects: Record<string, ManualEditRect> }
  | { id: string; kind: 'set-attributes'; attributes: Record<string, string> }
  | { id: string; kind: 'set-outer-html'; html: string }
  | { kind: 'set-full-source'; source: string };

export interface ManualEditHistoryEntry {
  id: string;
  label: string;
  patch: ManualEditPatch;
  beforeSource: string;
  afterSource: string;
  createdAt: number;
}

export interface ManualEditTargetMessage {
  type: 'od-edit-targets';
  targets: ManualEditTarget[];
}

export interface ManualEditSelectMessage {
  type: 'od-edit-select';
  target: ManualEditTarget;
  append?: boolean;
}

export interface ManualEditHoverMessage {
  type: 'od-edit-hover';
  target: ManualEditTarget;
}

export interface ManualEditBackgroundMessage {
  type: 'od-edit-background';
}

export interface ManualEditDeselectMessage {
  type: 'od-edit-deselect';
}

export interface ManualEditResizeEndMessage {
  type: 'od-edit-resize-end';
  id: string;
  styles: Partial<Pick<ManualEditStyles, 'width' | 'height'>>;
}

export interface ManualEditDragEndMessage {
  type: 'od-edit-drag-end';
  id: string;
  styles: Partial<Pick<ManualEditStyles, 'marginTop' | 'marginLeft'>>;
}

export interface ManualEditMoveEndMessage {
  type: 'od-edit-move-end';
  id: string;
  targetId: string;
  position: ManualEditMovePosition;
}

export interface ManualEditPreviewAppliedMessage {
  type: 'od-edit-preview-style-applied';
  id: string;
  version: number;
  ok: boolean;
  error?: string;
}

export interface ManualEditTextCommitMessage {
  type: 'od-edit-text-commit';
  id: string;
  value: string;
}

export interface ManualEditViewportWheelMessage {
  type: 'od-edit-viewport-wheel';
  clientX: number;
  clientY: number;
  deltaY: number;
}

export interface ManualEditViewportPanMessage {
  type: 'od-edit-viewport-pan';
  phase: 'start' | 'move' | 'end';
  clientX: number;
  clientY: number;
  screenX?: number;
  screenY?: number;
}

export type ManualEditBridgeMessage =
  | ManualEditTargetMessage
  | ManualEditSelectMessage
  | ManualEditHoverMessage
  | ManualEditBackgroundMessage
  | ManualEditDeselectMessage
  | ManualEditResizeEndMessage
  | ManualEditDragEndMessage
  | ManualEditMoveEndMessage
  | ManualEditPreviewAppliedMessage
  | ManualEditTextCommitMessage
  | ManualEditViewportWheelMessage
  | ManualEditViewportPanMessage
  | { type: 'od-edit-space-held' }
  | { type: 'od-edit-space-released' }
  | { type: 'od-edit-undo' }
  | { type: 'od-edit-redo' }
  | { type: 'od-edit-delete'; id: string };

export const MANUAL_EDIT_STYLE_PROPS: readonly (keyof ManualEditStyles)[] = [
  'left', 'top',
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign', 'lineHeight', 'letterSpacing',
  'width', 'height', 'minHeight',
  'display', 'gap', 'columnGap', 'rowGap', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
  'backgroundColor', 'backgroundImage', 'opacity',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'borderColor', 'borderRadius',
  'transform', 'overflow', 'boxShadow',
];

export function emptyManualEditStyles(): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = '';
    return acc;
  }, {} as ManualEditStyles);
}
