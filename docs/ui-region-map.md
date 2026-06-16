# UI 区域 → 代码文件地图

这份文档把常用的 UI 区域叫法映射到实际代码文件，方便人或 AI 快速定位。

> 仓库结构：所有路径相对仓库根目录。Web 端代码主要在 `apps/web/src/`。
> 编辑画布有两条路径：**GrapesJS WYSIWYG**（HTML 文件默认路径，`useGrapesjs = true`）和 **iframe 手动编辑**（旧路径，`ManualEditPanel` + `edit-mode/bridge.ts`）。两者都挂在同一个 `FileViewer` 下。

---

## 1. HTML 区域（中央编辑/预览画布）

中央那块所见即所得的 HTML 画布，由 GrapesJS 渲染。

| 关注点 | 文件 | 关键位置 |
|---|---|---|
| **画布主组件** | `apps/web/src/components/grapesjs/GrapesjsEditor.tsx` | 组件声明 `function GrapesjsEditor` ~L420；canvas `<div ref={containerRef}>` ~L3291 |
| **启动引导（boot effect）** | 同上 | `grapesjs.init({...})` 的 `useEffect` ~L566；`init` 调用 ~L579；`styleManager.sectors` 配置 ~L599 |
| **`on('load')` 挂载** | 同上 | ~L1387（Layers/StyleManager 面板 reparent 到宿主容器） |
| **对外命令接口** | 同上 | `GrapesjsEditorHandle` 接口 ~L299；`useImperativeHandle` ~L3057 |
| **缩放** | 同上 | `ZOOM_MIN/MAX` 25/300 ~L1461；`onWheelCanvas`（Cmd/Ctrl+滚轮聚焦缩放）~L1657；Cmd+0 重置 / Cmd+9 fit ~L1620 |
| **键盘快捷键** | 同上 | `onKeyDownCanvas`：Esc 取消选中 ~L1559；Delete/Backspace 删除 ~L1574；Cmd+Z/Y 撤销重做 ~L1605；Space 平移 ~L1540 |
| **间距拖拽/输入框** | 同上 | `positionSpacingHandles` ~L1050；`openSpacingInputEditor` ~L1206；`onSpacingDragStart`（单击 vs 拖拽阈值）~L1280 |
| **选择/hover 处理** | 同上 | `component:selected` ~L1354；flex 容器 hover 重定向 `onMouseOver` ~L2439；子元素虚线描边 `od-flex-child-hover` ~L2419 |
| **Shift+A 编组** | 同上 | ~L2000（新建包裹 div，按 DOM 顺序，保持位置） |
| **画布挂载点** | `apps/web/src/components/FileViewer.tsx` | `<GrapesjsEditor ref={grapesjsEditorRef} …>` ~L9007，在 `viewer-body` ~L8984 内 |
| **HTML 文档解析/重组** | `apps/web/src/components/grapesjs/html-document.ts` | `parseHtmlDocument` / `reassembleDocument` / `applyCanvasHeadAssets` |
| **桥接适配器（纯函数）** | `apps/web/src/components/grapesjs/grapesjs-bridge-adapter.ts` | `getOdIdFromComponent` / `getElementFromComponent` / `getComponentFromElement` 等 |
| **右键层级菜单** | `apps/web/src/components/grapesjs/CanvasContextMenu.tsx` | 渲染处 GrapesjsEditor ~L3297 |
| **其它支持文件** | `apps/web/src/components/grapesjs/` 下 `od-stable-id-plugin.ts`、`od-resizable-plugin.ts`、`image-upload.ts`、`GrapesjsEditor.module.css`、`index.ts` | |

**旧路径（iframe 手动编辑，非 HTML/GrapesJS）**：FileViewer ~L9216–9350（`manual-edit-workspace`）；iframe 内桥接脚本由 `apps/web/src/edit-mode/bridge.ts` 生成（`buildManualEditBridge` ~L58）。是否走 GrapesJS 由 `shouldUseGrapesjs(...)` 决定，FileViewer ~L4987。

---

## 2. 左侧文件树

注意：文件树不是整个应用最左侧的常驻栏，而是 **`DesignFilesPanel` 里的 `df-tree-pane` 列**（工作区"Design Files"标签下的子区域）。

| 关注点 | 文件 | 关键位置 |
|---|---|---|
| **文件树主组件** | `apps/web/src/components/DesignFilesPanel.tsx` | `export function DesignFilesPanel` ~L167 |
| **树数据** | 同上 | `FolderTreeNode` ~L89；`buildFolderTree`（`folderTree` memo）~L265 |
| **面板渲染** | 同上 | `<div className="df-panel …">` ~L1426；树列 `<aside className="df-tree-pane">` ~L1508；滚动区 `df-tree-scroll` ~L1633 |
| **行渲染** | 同上 | 根行 ~L940；文件行 `df-tree-file-row` ~L994；实时产物行 ~L1100；文件夹行 ~L1129；递归 `renderTreeNode` ~L1199 |
| **展开/收起、宽度** | 同上 | `expandedFolders` ~L236；`treePaneWidth` + 拖拽把手 ~L238 / ~L1653 |
| **文件夹拖拽** | 同上 | `folderDropTarget` / `draggedFolderPath` ~L222；`renderFolderDropZone` ~L830 |
| **工作区父级（挂载文件树）** | `apps/web/src/components/FileWorkspace.tsx` | `<DesignFilesPanel …>` ~L2539；标签栏 `ws-tabs-bar` ~L2182 |
| **顶层项目屏（外层布局）** | `apps/web/src/components/ProjectView.tsx` | `.split` 容器 ~L5397；`<FileWorkspace …>` ~L5644 |
| **支持文件** | `apps/web/src/components/design-files/pluginFolderActions.ts`、`pluginFolders.ts`；`apps/web/src/types.ts`（`ProjectFolder`） | |

> 歧义说明：如果你说的"左侧"其实指聊天/编辑侧栏（Chat/Edit 标签那一列），那是 `ProjectView.tsx` ~L5414–5447 的 `workspace-side-tab-rail`，由 `.split` / `split-chat-slot` 的 CSS 决定它在左还是在右。

---

## 3. 右侧编辑面板（属性/样式检查器）

右侧的属性面板外壳属于 `ProjectView`；GrapesJS 的 `StylePanel` 通过 portal 挂进去。

| 关注点 | 文件 | 关键位置 |
|---|---|---|
| **侧栏外壳 + 标签** | `apps/web/src/components/ProjectView.tsx` | `workspace-side-panel-shell` ~L5414；Chat/Edit 标签 `workspace-side-tab-rail` ~L5417（Chat ~L5421，Edit ~L5434） |
| **Edit 标签容器 + portal 目标** | 同上 | `workspace-side-edit-view` ~L5609；**portal 目标** `id={editInspectorPortalId}` 的 `workspace-edit-panel-host` ~L5614 |
| **样式面板内容（GrapesJS）** | `apps/web/src/components/grapesjs/StylePanel.tsx` | `export function StylePanel` ~L1547；根渲染 ~L1966；区块：位置 ~L1973、填充/描边/效果 其下；`PropertySection` ~L1319 |
| **应用样式路径** | 同上 | `apply()` ~L1623 → `editorRef.current?.applyStyle(...)`；读画布样式 `getCanvasStyles()` ~L1606 |
| **StylePanel 挂进 portal** | `apps/web/src/components/FileViewer.tsx` | 构建 `<aside className="grapesjs-sidebar">` 含 `<StylePanel>` ~L9201；`createPortal(...)` ~L9206；portal 宿主解析 effect ~L5027 |
| **GrapesJS 原生 Layers/StyleManager reparent** | `apps/web/src/components/grapesjs/GrapesjsEditor.tsx` | props `layersPanelRef` ~L411 / `stylePanelRef` ~L416；`on('load')` reparent ~L1422 |
| **旧路径编辑面板（非 GrapesJS）** | `apps/web/src/components/ManualEditPanel.tsx` | FileViewer 挂载 ~L8476；共用同一个 `workspace-edit-panel-host` portal |

---

## 4. 顶部工具条

顶部工具条在每个打开文件的 `FileViewer` 里；最顶层还有一条窗口级的 `AppChromeHeader`。

| 关注点 | 文件 | 关键位置 |
|---|---|---|
| **文件级工具条主区** | `apps/web/src/components/FileViewer.tsx` | `<div className="viewer-toolbar">` ~L8741 |
| **左簇**（重载/Preview-Source 标签/交互模式/视口/幻灯片） | 同上 | `viewer-toolbar-left` ~L8742；视口切换 `<PreviewViewportControls>` ~L8792 |
| **右簇**（截图/评论/标注/**缩放菜单**） | 同上 | `viewer-toolbar-actions` ~L8840；**缩放菜单** `zoom-menu viewer-toolbar-zoom` ~L8915（档位 50/75/100/125/150/200 ~L8933，选中调用 `Canvas.setZoom` ~L8941） |
| **视口切换子组件** | `apps/web/src/components/FileViewer.tsx` | `PreviewViewportControls` ~L317（desktop/tablet/mobile）；驱动 GrapesJS 的 effect ~L5050 |
| **演示/导出/分享（portal 到 chrome）** | 同上 | `chromeActionsHost` portal ~L8962 |
| **缩放百分比显示** | 同上 | `grapesjsCanvasZoom`（`onZoomChange`）~L9194；百分比 pill ~L8929 |
| **保存/导出接线** | 同上 | `onSave` → `syncGrapesjsDocumentToSource` + `handleCodeSave` ~L9029；自动保存 ~L9018；导出函数来自 `apps/web/src/runtime/exports.ts`（FileViewer import ~L75） |
| **最外层窗口栏（返回/拖拽区/文件操作槽）** | `apps/web/src/components/AppChromeHeader.tsx` | header ~L29；`APP_CHROME_FILE_ACTIONS_ID` 操作槽 ~L48 |
| **视口/缩放辅助函数** | `apps/web/src/components/viewer-utils.ts` | `previewViewportStyle` / `manualEditZoomPanAtPoint` / `htmlPreviewViewportState` |
| **渲染模式判定** | `apps/web/src/components/file-viewer-render-mode.ts` | URL-load vs srcDoc 决策 |
| **图标** | `apps/web/src/components/Icon.tsx`、`RemixIcon.tsx` | |

> 说明：撤销/重做没有做成工具条按钮，而是键盘驱动，在 GrapesjsEditor ~L1605。其它视图（图片/PDF 等）的工具条是 FileViewer 里平行的 `viewer-toolbar` 块（~L929、L3730、L3870 等），不是 HTML 编辑那条。

---

## 快速索引（一句话版）

| 你说的区域 | 主文件 |
|---|---|
| HTML 区域（画布） | `apps/web/src/components/grapesjs/GrapesjsEditor.tsx`（挂在 `FileViewer.tsx` ~L9007） |
| 左侧文件树 | `apps/web/src/components/DesignFilesPanel.tsx`（`df-tree-pane` ~L1508） |
| 右侧编辑面板 | 外壳 `apps/web/src/components/ProjectView.tsx`（~L5414）；内容 `apps/web/src/components/grapesjs/StylePanel.tsx`（portal 挂载在 `FileViewer.tsx` ~L9206） |
| 顶部工具条 | `apps/web/src/components/FileViewer.tsx`（`viewer-toolbar` ~L8741）；最外层 `apps/web/src/components/AppChromeHeader.tsx` |
| 桥接适配器 | GrapesJS：`grapesjs-bridge-adapter.ts`；旧 iframe：`apps/web/src/edit-mode/bridge.ts` |

> 行号会随代码变动漂移；用文件名 + 区域名（如 `df-tree-pane`、`viewer-toolbar`、`workspace-edit-panel-host`）做锚点搜索最稳。
