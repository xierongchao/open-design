export type GrapesjsIconLibraryId =
  | 'mdi'
  | 'ant'
  | 'iconfont'
  | 'iconpark'
  | 'carbon'
  | 'tabler'
  | 'fluent'
  | 'ionicons';

export type GrapesjsIconVariant = 'linear' | 'fill';

export type GrapesjsIconLibrary = {
  id: GrapesjsIconLibraryId;
  label: string;
};

export type GrapesjsIconDefinition = {
  id: string;
  library: GrapesjsIconLibraryId | 'remote';
  label: string;
  keywords: string[];
  path: string;
  remoteIcon?: string;
  remoteSvgUrl?: string;
};

export type GrapesjsIconInsertInput = {
  label: string;
  path: string;
  library?: GrapesjsIconLibraryId | 'remote';
  size: number;
  strokeWidth: number;
  color: string;
  variant: GrapesjsIconVariant;
  remoteIcon?: string;
  remoteSvgUrl?: string;
};

export const GRAPESJS_ICON_LIBRARIES: GrapesjsIconLibrary[] = [
  { id: 'mdi', label: 'Material Design Icons' },
  { id: 'ant', label: 'Ant Design' },
  { id: 'iconfont', label: 'iconfont' },
  { id: 'iconpark', label: 'IconPark' },
  { id: 'carbon', label: 'Carbon' },
  { id: 'tabler', label: 'Tabler Icons' },
  { id: 'fluent', label: 'Fluent UI' },
  { id: 'ionicons', label: 'Ionicons' },
];

export const GRAPESJS_ICON_PAGE_SIZE = 100;
export const GRAPESJS_REMOTE_ICON_PAGE_SIZE = 100;

const ICONIFY_API_BASE = 'https://api.iconify.design';
const ICONIFY_PREFERRED_PREFIXES = [
  'icon-park-outline',
  'icon-park-solid',
  'ant-design',
  'icon-park-twotone',
  'material-symbols',
  'material-symbols-light',
  'ic',
  'carbon',
  'tabler',
  'lucide',
  'heroicons',
  'fluent',
  'mdi',
  'ion',
  'ri',
  'ph',
  'solar',
  'mingcute',
  'tdesign',
  'weui',
  'hugeicons',
  'line-md',
] as const;

const CHINESE_ICON_QUERY_ALIASES: Record<string, string> = {
  邮件: 'mail',
  邮箱: 'mail',
  信封: 'mail',
  搜索: 'search',
  查找: 'search',
  首页: 'home',
  主页: 'home',
  用户: 'user',
  个人: 'user',
  团队: 'team',
  设置: 'settings',
  删除: 'delete',
  垃圾桶: 'trash',
  图片: 'image',
  图像: 'image',
  下载: 'download',
  上传: 'upload',
  电话: 'phone',
  手机: 'mobile phone',
  移动端: 'mobile phone',
  移动设备: 'mobile device',
  智能手机: 'smartphone',
  设备: 'device',
  日历: 'calendar',
  时间: 'clock',
  购物车: 'cart',
  图表: 'chart',
  文件: 'file',
  文档: 'file',
  文件夹: 'folder',
  警告: 'warning',
  信息: 'info',
  位置: 'map pin',
  定位: 'map pin',
  链接: 'link',
  锁: 'lock',
  解锁: 'unlock',
  播放: 'play',
  暂停: 'pause',
  相机: 'camera',
};

type GrapesjsIconBlueprint = {
  id: string;
  label: string;
  keywords: string[];
  path: string;
};

const ICON_BLUEPRINTS: GrapesjsIconBlueprint[] = [
  { id: 'mail', label: 'Mail', keywords: ['mail', 'email', 'message', '信封', '邮件'], path: 'M4 6h16v12H4z M4 7l8 6 8-6' },
  { id: 'home', label: 'Home', keywords: ['home', 'house', '主页'], path: 'M3 11l9-8 9 8 M5 10v10h14V10 M9 20v-6h6v6' },
  { id: 'search', label: 'Search', keywords: ['search', 'find', '搜索'], path: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l5 5' },
  { id: 'plus', label: 'Plus', keywords: ['plus', 'add', '添加'], path: 'M12 5v14 M5 12h14' },
  { id: 'check', label: 'Check', keywords: ['check', 'done', '勾选'], path: 'M4 12l5 5L20 6' },
  { id: 'close', label: 'Close', keywords: ['close', 'x', '关闭'], path: 'M6 6l12 12 M18 6L6 18' },
  { id: 'settings', label: 'Settings', keywords: ['settings', 'gear', '设置'], path: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 12h2 M18 12h2 M12 4v2 M12 18v2 M6.3 6.3l1.4 1.4 M16.3 16.3l1.4 1.4 M17.7 6.3l-1.4 1.4 M7.7 16.3l-1.4 1.4' },
  { id: 'delete', label: 'Delete', keywords: ['delete', 'trash', '删除'], path: 'M5 7h14 M10 11v6 M14 11v6 M7 7l1 13h8l1-13 M9 7l1-3h4l1 3' },
  { id: 'user', label: 'User', keywords: ['user', 'person', '用户'], path: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0' },
  { id: 'team', label: 'Team', keywords: ['team', 'users', '团队'], path: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 21a6 6 0 0 1 12 0 M13 21a5 5 0 0 1 8 0' },
  { id: 'calendar', label: 'Calendar', keywords: ['calendar', 'date', '日历'], path: 'M5 5h14v15H5z M5 9h14 M8 3v4 M16 3v4' },
  { id: 'clock', label: 'Clock', keywords: ['clock', 'time', '时间'], path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v6l4 2' },
  { id: 'camera', label: 'Camera', keywords: ['camera', 'photo', '相机'], path: 'M4 8h4l2-3h4l2 3h4v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
  { id: 'image', label: 'Image', keywords: ['image', 'picture', '图片'], path: 'M4 5h16v14H4z M7 16l4-4 3 3 2-2 3 3 M8 9h.01' },
  { id: 'video', label: 'Video', keywords: ['video', 'play', '视频'], path: 'M4 6h11v12H4z M15 10l5-3v10l-5-3z' },
  { id: 'play', label: 'Play', keywords: ['play', 'start', '播放'], path: 'M8 5v14l11-7z' },
  { id: 'pause', label: 'Pause', keywords: ['pause', '暂停'], path: 'M8 5v14 M16 5v14' },
  { id: 'bell', label: 'Bell', keywords: ['bell', 'notice', '通知'], path: 'M6 17h12 M8 17V9a4 4 0 0 1 8 0v8 M10 20h4' },
  { id: 'bookmark', label: 'Bookmark', keywords: ['bookmark', 'save', '书签'], path: 'M6 4h12v16l-6-4-6 4z' },
  { id: 'star', label: 'Star', keywords: ['star', 'favorite', '星标'], path: 'M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z' },
  { id: 'heart', label: 'Heart', keywords: ['heart', 'like', '喜欢'], path: 'M12 21s-8-5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 6-8 11-8 11z' },
  { id: 'folder', label: 'Folder', keywords: ['folder', 'directory', '文件夹'], path: 'M3 7h7l2 2h9v10H3z' },
  { id: 'document', label: 'Document', keywords: ['document', 'file', '文件'], path: 'M7 3h7l5 5v13H7z M14 3v6h5 M9 14h6 M9 18h6' },
  { id: 'download', label: 'Download', keywords: ['download', '下载'], path: 'M12 3v12 M7 10l5 5 5-5 M5 21h14' },
  { id: 'upload', label: 'Upload', keywords: ['upload', '上传'], path: 'M12 21V9 M7 14l5-5 5 5 M5 3h14' },
  { id: 'cloud', label: 'Cloud', keywords: ['cloud', '云'], path: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 18z' },
  { id: 'lock', label: 'Lock', keywords: ['lock', 'secure', '锁'], path: 'M6 10h12v10H6z M8 10V7a4 4 0 0 1 8 0v3' },
  { id: 'unlock', label: 'Unlock', keywords: ['unlock', '解锁'], path: 'M6 10h12v10H6z M9 10V7a4 4 0 0 1 7-2' },
  { id: 'link', label: 'Link', keywords: ['link', 'chain', '链接'], path: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1' },
  { id: 'map-pin', label: 'Map Pin', keywords: ['map', 'pin', 'location', '定位'], path: 'M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  { id: 'phone', label: 'Phone', keywords: ['phone', 'call', '电话'], path: 'M7 4l3 3-2 3a14 14 0 0 0 6 6l3-2 3 3-2 4A17 17 0 0 1 3 6z' },
  { id: 'chat', label: 'Chat', keywords: ['chat', 'message', '聊天'], path: 'M4 5h16v11H8l-4 4z M8 9h8 M8 13h5' },
  { id: 'cart', label: 'Cart', keywords: ['cart', 'shop', '购物车'], path: 'M3 4h2l2 12h10l3-8H6 M9 21h.01 M17 21h.01' },
  { id: 'wallet', label: 'Wallet', keywords: ['wallet', 'pay', '钱包'], path: 'M4 7h16v12H4z M16 11h4v4h-4z M4 7l3-3h10l3 3' },
  { id: 'chart', label: 'Chart', keywords: ['chart', 'analytics', '图表'], path: 'M5 19V5 M5 19h15 M9 16v-5 M13 16V8 M17 16v-8' },
  { id: 'table', label: 'Table', keywords: ['table', 'grid', '表格'], path: 'M4 5h16v14H4z M4 10h16 M9 5v14 M15 5v14' },
  { id: 'filter', label: 'Filter', keywords: ['filter', '筛选'], path: 'M4 5h16l-6 7v6l-4 2v-8z' },
  { id: 'menu', label: 'Menu', keywords: ['menu', 'nav', '菜单'], path: 'M4 7h16 M4 12h16 M4 17h16' },
  { id: 'grid', label: 'Grid', keywords: ['grid', 'layout', '网格'], path: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z' },
  { id: 'list', label: 'List', keywords: ['list', '列表'], path: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01' },
  { id: 'edit', label: 'Edit', keywords: ['edit', 'pen', '编辑'], path: 'M4 20h4l11-11-4-4L4 16z M14 6l4 4' },
  { id: 'copy', label: 'Copy', keywords: ['copy', 'duplicate', '复制'], path: 'M8 8h12v12H8z M4 4h12v12' },
  { id: 'refresh', label: 'Refresh', keywords: ['refresh', 'reload', '刷新'], path: 'M20 6v6h-6 M4 18v-6h6 M19 12a7 7 0 0 0-12-5 M5 12a7 7 0 0 0 12 5' },
  { id: 'arrow-left', label: 'Arrow Left', keywords: ['arrow', 'left', '返回'], path: 'M5 12h14 M5 12l6-6 M5 12l6 6' },
  { id: 'arrow-right', label: 'Arrow Right', keywords: ['arrow', 'right', '前进'], path: 'M19 12H5 M19 12l-6-6 M19 12l-6 6' },
  { id: 'arrow-up', label: 'Arrow Up', keywords: ['arrow', 'up', '上'], path: 'M12 19V5 M12 5l-6 6 M12 5l6 6' },
  { id: 'arrow-down', label: 'Arrow Down', keywords: ['arrow', 'down', '下'], path: 'M12 5v14 M12 19l-6-6 M12 19l6-6' },
  { id: 'warning', label: 'Warning', keywords: ['warning', 'alert', '警告'], path: 'M12 4l9 16H3z M12 9v5 M12 17h.01' },
  { id: 'info', label: 'Info', keywords: ['info', 'help', '信息'], path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7h.01' },
  { id: 'bluetooth', label: 'Bluetooth', keywords: ['bluetooth', '蓝牙'], path: 'M8 5l8 7-8 7V5z M8 5l8 14 M8 19l8-14' },
  { id: 'compass', label: 'Compass', keywords: ['compass', 'direction', '指南针'], path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15 9l-2 5-5 2 2-5z' },
  { id: 'currency-yuan', label: 'Yuan', keywords: ['yuan', 'currency', '人民币'], path: 'M7 4l5 7 5-7 M8 12h8 M8 16h8 M12 11v9' },
  { id: 'tag', label: 'Tag', keywords: ['tag', 'label', '标签'], path: 'M4 4h8l8 8-8 8-8-8z M8 8h.01' },
  { id: 'gift', label: 'Gift', keywords: ['gift', 'present', '礼物'], path: 'M4 10h16v10H4z M4 10V7h16v3 M12 7v13 M8 7a2 2 0 1 1 4 0 M16 7a2 2 0 1 0-4 0' },
  { id: 'flag', label: 'Flag', keywords: ['flag', '标记'], path: 'M6 21V4h11l-2 4 2 4H6' },
  { id: 'eye', label: 'Eye', keywords: ['eye', 'view', '查看'], path: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { id: 'shield', label: 'Shield', keywords: ['shield', 'security', '安全'], path: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z' },
  { id: 'bug', label: 'Bug', keywords: ['bug', 'debug', '缺陷'], path: 'M8 8h8v9a4 4 0 0 1-8 0z M9 4l2 3 M15 4l-2 3 M4 13h4 M16 13h4 M5 19l3-2 M19 19l-3-2' },
  { id: 'rocket', label: 'Rocket', keywords: ['rocket', 'launch', '启动'], path: 'M5 19l4-1 7-7 3-6-6 3-7 7z M9 18l-3 3 M14 6l4 4' },
  { id: 'sparkle', label: 'Sparkle', keywords: ['sparkle', 'magic', '闪光'], path: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z M19 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1z' },
  { id: 'printer', label: 'Printer', keywords: ['printer', 'print', '打印'], path: 'M7 8V4h10v4 M6 17H4v-6h16v6h-2 M7 14h10v6H7z' },
  { id: 'monitor', label: 'Monitor', keywords: ['monitor', 'screen', '屏幕'], path: 'M4 5h16v11H4z M9 21h6 M12 16v5' },
  { id: 'mobile', label: 'Mobile', keywords: ['mobile', 'phone', '手机'], path: 'M8 3h8v18H8z M11 18h2' },
  { id: 'wifi', label: 'Wifi', keywords: ['wifi', 'network', '网络'], path: 'M4 9a12 12 0 0 1 16 0 M7 13a7 7 0 0 1 10 0 M10 17a3 3 0 0 1 4 0 M12 20h.01' },
];

export const GRAPESJS_ICON_CATALOG: GrapesjsIconDefinition[] = GRAPESJS_ICON_LIBRARIES.flatMap((library) =>
  ICON_BLUEPRINTS.map((icon) => ({
    id: `${library.id}-${icon.id}`,
    library: library.id,
    label: icon.label,
    keywords: [...icon.keywords, library.label, library.id],
    path: icon.path,
  })),
);

export function filterGrapesjsIcons(input: {
  library: GrapesjsIconLibraryId | 'all';
  query: string;
}): GrapesjsIconDefinition[] {
  const needle = input.query.trim().toLowerCase();
  return GRAPESJS_ICON_CATALOG.filter((icon) => {
    if (input.library !== 'all' && icon.library !== input.library) return false;
    if (!needle) return true;
    return (
      icon.label.toLowerCase().includes(needle) ||
      icon.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
    );
  });
}

export function visibleGrapesjsIconPage(input: {
  library: GrapesjsIconLibraryId | 'all';
  query: string;
  limit?: number;
  offset?: number;
}): { items: GrapesjsIconDefinition[]; total: number; hasMore: boolean } {
  const limit = Math.max(1, Math.round(input.limit ?? GRAPESJS_ICON_PAGE_SIZE));
  const offset = Math.max(0, Math.round(input.offset ?? 0));
  const filtered = filterGrapesjsIcons(input);
  const end = Math.min(filtered.length, offset + limit);
  return {
    items: filtered.slice(offset, end),
    total: filtered.length,
    hasMore: end < filtered.length,
  };
}

export function translateGrapesjsIconSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  return CHINESE_ICON_QUERY_ALIASES[trimmed] ?? trimmed;
}

export function buildIconifySearchUrl(input: { query: string; limit?: number }): string {
  const query = translateGrapesjsIconSearchQuery(input.query);
  const params = new URLSearchParams({
    query,
    limit: String(Math.max(1, Math.round(input.limit ?? GRAPESJS_REMOTE_ICON_PAGE_SIZE))),
    prefixes: ICONIFY_PREFERRED_PREFIXES.join(','),
  });
  return `${ICONIFY_API_BASE}/search?${params.toString()}`;
}

function titleCaseIconName(value: string): string {
  return value
    .replace(/-(?:outlined|filled|twotone|round|sharp|line|solid)$/i, '')
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function iconifySvgUrl(icon: string): string | null {
  const [prefix, name] = icon.split(':');
  if (!prefix || !name) return null;
  return `${ICONIFY_API_BASE}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;
}

export function iconifySearchResultsToIcons(input: { icons?: string[] }): GrapesjsIconDefinition[] {
  return (input.icons ?? []).flatMap((icon) => {
    const [prefix, name] = icon.split(':');
    const remoteSvgUrl = iconifySvgUrl(icon);
    if (!prefix || !name || !remoteSvgUrl) return [];
    return [{
      id: `remote-${prefix}-${name}`.replace(/[^a-z0-9_-]+/gi, '-'),
      library: 'remote',
      label: titleCaseIconName(name),
      keywords: [icon, prefix, name],
      path: '',
      remoteIcon: icon,
      remoteSvgUrl,
    }];
  });
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderGrapesjsIconSvg(input: GrapesjsIconInsertInput): string {
  if (input.remoteSvgUrl) {
    const url = escapeAttribute(input.remoteSvgUrl);
    return `<span data-od-remote-icon="true" aria-hidden="true" style="display:block;width:100%;height:100%;background-color:currentColor;-webkit-mask-image:url(&quot;${url}&quot;);mask-image:url(&quot;${url}&quot;);-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain"></span>`;
  }
  const path = escapeAttribute(input.path);
  const strokeWidth = Math.max(1, Math.round(input.strokeWidth * 10) / 10);
  const fill = input.variant === 'fill' ? 'currentColor' : 'none';
  const stroke = input.variant === 'fill' ? 'none' : 'currentColor';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block">`,
    `<path d="${path}"/>`,
    '</svg>',
  ].join('');
}
