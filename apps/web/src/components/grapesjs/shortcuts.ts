export type GrapesjsShortcutGroupId =
  | 'basic'
  | 'tools'
  | 'view'
  | 'edit'
  | 'arrange'
  | 'components';

export type GrapesjsShortcutItem = {
  label: string;
  shortcut: string;
  icon: string;
};

export type GrapesjsShortcutGroup = {
  id: GrapesjsShortcutGroupId;
  title: string;
  items: GrapesjsShortcutItem[];
};

export const GRAPESJS_SHORTCUT_GROUPS: GrapesjsShortcutGroup[] = [
  {
    id: 'basic',
    title: '基础',
    items: [
      { label: '保存', shortcut: '⌘ S', icon: 'save-line' },
      { label: '撤销', shortcut: '⌘ Z', icon: 'arrow-go-back-line' },
      { label: '重做', shortcut: '⇧ ⌘ Z', icon: 'arrow-go-forward-line' },
      { label: '刷新预览', shortcut: '⌘ R', icon: 'refresh-line' },
      { label: '取消选择', shortcut: 'Esc', icon: 'close-circle-line' },
      { label: '删除选中元素', shortcut: 'Delete', icon: 'delete-bin-line' },
    ],
  },
  {
    id: 'tools',
    title: '工具',
    items: [
      { label: '光标', shortcut: 'V', icon: 'cursor-line' },
      { label: '矩形', shortcut: 'R', icon: 'square-line' },
      { label: '直线', shortcut: 'L', icon: 'subtract-line' },
      { label: '圆形', shortcut: 'O', icon: 'circle-line' },
      { label: '文本', shortcut: 'T', icon: 'font-size' },
      { label: '图片', shortcut: '⇧ ⌘ K', icon: 'image-line' },
      { label: '标注', shortcut: 'C', icon: 'focus-3-line' },
      { label: '截图粘贴', shortcut: '⌘ V', icon: 'screenshot-2-line' },
    ],
  },
  {
    id: 'view',
    title: '视图',
    items: [
      { label: '拖动画布', shortcut: 'Space 拖动', icon: 'drag-move-line' },
      { label: '滚轮缩放', shortcut: '⌘ 滚轮', icon: 'zoom-in-line' },
      { label: '拖动画布元素', shortcut: '拖动', icon: 'cursor-line' },
      { label: '复制并拖动', shortcut: '⌥ 拖动', icon: 'file-copy-line' },
      { label: '多选元素', shortcut: '⇧ 点击', icon: 'checkbox-multiple-blank-line' },
    ],
  },
  {
    id: 'edit',
    title: '编辑',
    items: [
      { label: '复制元素', shortcut: '⌘ C', icon: 'file-copy-line' },
      { label: '剪切元素', shortcut: '⌘ X', icon: 'scissors-cut-line' },
      { label: '粘贴元素', shortcut: '⌘ V', icon: 'clipboard-line' },
      { label: '复制 CSS 属性', shortcut: '⌘ ⌥ C', icon: 'css3-line' },
      { label: '粘贴 CSS 属性', shortcut: '⌘ ⌥ V', icon: 'brush-line' },
      { label: '精细移动', shortcut: '方向键', icon: 'arrow-left-right-line' },
      { label: '大步移动', shortcut: '⇧ 方向键', icon: 'expand-left-right-line' },
    ],
  },
  {
    id: 'arrange',
    title: '排列',
    items: [
      { label: '左对齐', shortcut: '⌥ A', icon: 'align-left' },
      { label: '左右居中对齐', shortcut: '⌥ H', icon: 'align-center' },
      { label: '右对齐', shortcut: '⌥ D', icon: 'align-right' },
      { label: '顶对齐', shortcut: '⌥ W', icon: 'align-top' },
      { label: '上下居中对齐', shortcut: '⌥ V', icon: 'align-vertically' },
      { label: '底对齐', shortcut: '⌥ S', icon: 'align-bottom' },
      { label: '垂直平均分布', shortcut: '⇧ ⌥ V', icon: 'layout-column-line' },
      { label: '水平平均分布', shortcut: '⇧ ⌥ H', icon: 'layout-row-line' },
      { label: '添加自动布局', shortcut: '⇧ A', icon: 'layout-row-line' },
      { label: '取消自动布局', shortcut: '⇧ ⌥ A', icon: 'layout-column-line' },
    ],
  },
  {
    id: 'components',
    title: '组件',
    items: [
      { label: '进入文字编辑', shortcut: '双击文本', icon: 'font-size' },
      { label: '替换图片', shortcut: '双击图片', icon: 'image-edit-line' },
      { label: '调整圆角', shortcut: '拖动圆角点', icon: 'crop-line' },
      { label: '调整间距', shortcut: '拖动间距带', icon: 'expand-left-right-line' },
    ],
  },
];
