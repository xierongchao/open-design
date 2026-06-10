import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useAnalytics } from '../analytics/provider';
import { trackFileManagerClick } from '../analytics/events';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { projectFileUrl } from '../providers/registry';
import type { LiveArtifactWorkspaceEntry, ProjectFile, ProjectFileKind, ProjectFolder } from '../types';
import {
  createFileSystemReadError,
  FILE_SYSTEM_READ_ERROR_MESSAGE,
  isFileSystemReadError,
} from '../utils/fileSystemErrors';
import type { PluginFolderAgentAction } from './design-files/pluginFolderActions';
import { getPluginFolderCandidates } from './design-files/pluginFolders';
import { Icon } from './Icon';
import { LiveArtifactBadges } from './LiveArtifactBadges';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export interface DesignFilesNavState {
  kindFilter: Set<ProjectFileKind>;
  currentDir: string;
  page: number;
  pageSize: number | 'all';
}

interface Props {
  projectId: string;
  // Basename of the project's working directory when the user has chosen a
  // real folder (e.g. "openclaw"). Shown as the breadcrumb root instead of
  // the generic "project" label. Undefined for default-storage projects.
  rootDirName?: string;
  // True while the host is reindexing a freshly replaced working dir. Drives
  // a loading overlay so the panel doesn't sit silently on the stale tree.
  reloading?: boolean;
  files: ProjectFile[];
  // Persisted folders from `/api/projects/:id/folders`, including empty ones
  // that no file lives under. Without these, a folder only appears once a file
  // with a matching path prefix exists, so empty (user-created or imported)
  // folders would vanish from the tree.
  folders?: ProjectFolder[];
  liveArtifacts: LiveArtifactWorkspaceEntry[];
  onRefreshFiles: () => Promise<void> | void;
  onOpenFile: (name: string) => void;
  onOpenLiveArtifact: (tabId: LiveArtifactWorkspaceEntry['tabId']) => void;
  onRenameFile: (from: string, to: string) => Promise<ProjectFile | null> | ProjectFile | null;
  onDeleteFile: (name: string) => void;
  onDeleteFiles: (names: string[]) => Promise<void> | void;
  onCreateFolder?: (path: string) => Promise<ProjectFolder | null> | ProjectFolder | null;
  onDeleteFolder?: (path: string) => Promise<boolean> | boolean;
  onRenameFolder?: (fromPath: string, toPath: string) => Promise<ProjectFolder | null> | ProjectFolder | null;
  onMoveFiles?: (names: string[], targetDir: string) => Promise<void> | void;
  onUpload: () => void;
  onUploadFiles: (files: File[]) => void;
  onPaste: () => void;
  onNewSketch: () => void;
  // Reports the folder the panel is currently viewing so the parent can create
  // new files (upload / paste / new sketch / dropped files) under it instead
  // of the project root. Fires whenever the user navigates folders.
  onCurrentDirChange?: (dir: string) => void;
  uploadError?: string | null;
  onClearUploadError?: () => void;
  onPluginFolderAgentAction?: (
    relativePath: string,
    action: PluginFolderAgentAction,
  ) => Promise<{ message?: string; url?: string } | void> | { message?: string; url?: string } | void;
  activePluginActionPaths?: Set<string>;
  hiddenPluginActionPaths?: Set<string>;
  navState?: DesignFilesNavState;
  onNavStateChange?: (state: DesignFilesNavState) => void;
}

interface ActionNotice {
  message: string;
  url?: string;
}

interface FolderTreeNode {
  name: string;
  path: string;
  fileCount: number;
  children: FolderTreeNode[];
}

type FolderDropMode = 'inside' | 'before' | 'after';

interface FolderDragTarget {
  path: string;
  mode: FolderDropMode;
}

type FolderOrderMap = Record<string, string[]>;

// Display-only refinement of ProjectFileKind. The contract `kind` lumps all
// source under `code`; the Design Files surface splits CSS/SCSS/etc. into a
// dedicated "Stylesheets" section to mirror Claude Design. Everything else
// maps 1:1 to its kind.
type FileCategory = ProjectFileKind | 'stylesheet';

const STYLESHEET_EXTENSIONS = new Set(['css', 'scss', 'sass', 'less']);

function fileCategory(file: ProjectFile): FileCategory {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (STYLESHEET_EXTENSIONS.has(ext)) return 'stylesheet';
  return file.kind;
}

type FileSystemEntryWithReader = FileSystemEntry & {
  createReader?: () => FileSystemDirectoryReader;
};
type FileSystemFileEntryWithFile = FileSystemFileEntry & {
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
};
type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

function buildActionNotice(message: string, url?: string): ActionNotice {
  const trimmedMessage = message.trim();
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) return { message: trimmedMessage };
  const normalizedMessage = trimmedMessage.replace(new RegExp(`\\s*${escapeRegExp(trimmedUrl)}\\s*$`), '');
  return { message: normalizedMessage.trim() || trimmedUrl, url: trimmedUrl };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ActionNoticeView({ notice }: { notice: ActionNotice | null }) {
  if (!notice) return null;
  return (
    <>
      <span>{notice.message}</span>
      {notice.url ? (
        <>
          {' '}
          <a href={notice.url} target="_blank" rel="noreferrer">
            {notice.url}
          </a>
        </>
      ) : null}
    </>
  );
}

/**
 * Full-panel browser for a project's `.od/projects/<id>/` folder. Mirrors
 * Claude Design's "Design Files" surface: a single-line toolbar (up / refresh
 * / breadcrumbs + actions), semantic sections (Folders, Stylesheets, Scripts,
 * Documents, Images …), hover-revealed row checkbox + menu, a right-side
 * file management surface with semantic sections, nested folders, row actions,
 * and a static "useful info" footer. Triggered as a sticky first tab in
 * FileWorkspace.
 */
export function DesignFilesPanel({
  projectId,
  rootDirName,
  reloading,
  files,
  folders,
  liveArtifacts,
  onOpenFile,
  onOpenLiveArtifact,
  onRenameFile,
  onDeleteFile,
  onDeleteFiles,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onMoveFiles,
  onUpload,
  onUploadFiles,
  onPaste,
  onNewSketch,
  uploadError = null,
  onClearUploadError,
  onCurrentDirChange,
  onPluginFolderAgentAction,
  activePluginActionPaths = new Set(),
  hiddenPluginActionPaths = new Set(),
  navState,
  onNavStateChange,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [dropReadError, setDropReadError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const [hover, setHover] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ name: string; top: number; left: number } | null>(null);
  const [folderMenuPos, setFolderMenuPos] = useState<{ path: string; top: number; left: number } | null>(null);
  const MENU_ESTIMATED_HEIGHT = 145;
  const FOLDER_MENU_ESTIMATED_HEIGHT = 86;
  const MENU_SAFE_PADDING = 8;
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastKeyPress = useRef<Map<string, number>>(new Map());
  const [deleting, setDeleting] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [folderNotice, setFolderNotice] = useState<ActionNotice | null>(null);
  const [folderAction, setFolderAction] =
    useState<{ kind: 'creating' | 'deleting' | 'renaming' | 'moving'; path: string } | null>(null);
  const [draggedProjectFiles, setDraggedProjectFiles] = useState<string[]>([]);
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);
  const [draggedFolderPath, setDraggedFolderPath] = useState<string | null>(null);
  const [folderDragTarget, setFolderDragTarget] = useState<FolderDragTarget | null>(null);
  const [folderOrder, setFolderOrder] = useState<FolderOrderMap>(() => readFolderOrder(projectId));
  const [installingFolder, setInstallingFolder] = useState<string | null>(null);
  const [sharingFolder, setSharingFolder] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<ActionNotice | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; draft: string; saving: boolean } | null>(null);
  const [currentDir, setCurrentDir] = useState<string>(() => navState?.currentDir ?? '');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [rootExpanded, setRootExpanded] = useState(true);

  useEffect(() => {
    setFolderOrder(readFolderOrder(projectId));
  }, [projectId]);

  // Keep the parent's create-target in sync with the folder being viewed, so
  // uploads / pastes / new sketches / dropped files land in the open folder
  // rather than the project root.
  useEffect(() => {
    onCurrentDirChange?.(currentDir);
  }, [currentDir, onCurrentDirChange]);

  useEffect(() => {
    onNavStateChange?.({
      kindFilter: navState?.kindFilter ?? new Set(),
      currentDir,
      page: 0,
      pageSize: 30,
    });
  }, [currentDir, navState?.kindFilter, onNavStateChange]);

  // Derive files at the current directory level from the flat file list.
  const filesAtCurrentDir = useMemo(() => {
    const prefix = currentDir === '' ? '' : `${currentDir}/`;
    const localFiles: ProjectFile[] = [];
    for (const f of files) {
      if (!f.name.startsWith(prefix)) continue;
      const remainder = f.name.slice(prefix.length);
      const slashIdx = remainder.indexOf('/');
      if (slashIdx === -1) {
        localFiles.push(f);
      }
    }
    return localFiles;
  }, [files, currentDir]);

  const folderTree = useMemo(() => buildFolderTree(files, folders ?? [], folderOrder), [files, folders, folderOrder]);
  const tableFiles = useMemo(
    () => [...filesAtCurrentDir].sort((a, b) => b.mtime - a.mtime),
    [filesAtCurrentDir],
  );

  // Reset selection and renaming state when the user navigates into or out of
  // a directory.
  useEffect(() => {
    setSelected(new Set());
    setRenaming(null);
  }, [currentDir]);

  useEffect(() => {
    if (currentDir === '') return;
    const ancestors = folderAncestors(currentDir);
    setExpandedFolders((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const path of ancestors) {
        if (!next.has(path)) {
          next.add(path);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentDir]);

  // Navigate up to the nearest ancestor that still exists when the current
  // directory disappears (e.g. after deleting the last file in a subfolder).
  // A directory "exists" if it has files under it OR is a persisted folder
  // (possibly empty) — otherwise navigating into an empty folder would bounce
  // straight back to the root.
  useEffect(() => {
    if (currentDir === '') return;
    const dirExists = (dir: string) =>
      files.some((f) => f.name.startsWith(`${dir}/`)) ||
      (folders ?? []).some((fo) => fo.path === dir || fo.path.startsWith(`${dir}/`));
    if (dirExists(currentDir)) return;
    const parts = currentDir.split('/');
    for (let i = parts.length - 1; i > 0; i--) {
      const ancestor = parts.slice(0, i).join('/');
      if (dirExists(ancestor)) {
        setCurrentDir(ancestor);
        return;
      }
    }
    setCurrentDir('');
  }, [files, folders, currentDir]);

  const pluginFolders = useMemo(() => getPluginFolderCandidates(files), [files]);

  // Prune selections that no longer exist in the current file list
  // (e.g. after a refresh or delete within the same project).
  // Cross-project leaks are handled by the parent remounting this
  // component via key={projectId}.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const names = new Set(files.map((f) => f.name));
      const next = new Set(prev);
      let changed = false;
      for (const n of next) {
        if (!names.has(n)) {
          next.delete(n);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [files]);

  useEffect(() => {
    if (!activeFile) return;
    if (files.some((f) => f.name === activeFile)) return;
    setActiveFile(null);
  }, [activeFile, files]);

  useEffect(() => {
    if (!menuPos && !folderMenuPos) return;
    const close = () => {
      setMenuPos(null);
      setFolderMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuPos, folderMenuPos]);

  useEffect(() => {
    if (currentDir !== '') setRootExpanded(true);
  }, [currentDir]);

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function openMenuFor(name: string, el: HTMLElement) {
    const rect = el.closest('.df-row-menu')?.getBoundingClientRect();
    if (!rect) return;

    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    let top: number;
    if (spaceBelow >= MENU_ESTIMATED_HEIGHT + MENU_SAFE_PADDING) {
      top = rect.bottom + 4;
    } else if (spaceAbove >= MENU_ESTIMATED_HEIGHT + MENU_SAFE_PADDING) {
      top = rect.top - MENU_ESTIMATED_HEIGHT - 4;
    } else {
      top = Math.max(
        MENU_SAFE_PADDING,
        viewportHeight - MENU_ESTIMATED_HEIGHT - MENU_SAFE_PADDING,
      );
    }

    const left = Math.max(MENU_SAFE_PADDING, rect.right - 160);

    setMenuPos({ name, top, left });
  }

  function openFolderMenuFor(path: string, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top: number;
    if (spaceBelow >= FOLDER_MENU_ESTIMATED_HEIGHT + MENU_SAFE_PADDING) {
      top = rect.bottom + 4;
    } else if (spaceAbove >= FOLDER_MENU_ESTIMATED_HEIGHT + MENU_SAFE_PADDING) {
      top = rect.top - FOLDER_MENU_ESTIMATED_HEIGHT - 4;
    } else {
      top = Math.max(
        MENU_SAFE_PADDING,
        viewportHeight - FOLDER_MENU_ESTIMATED_HEIGHT - MENU_SAFE_PADDING,
      );
    }
    const left = Math.max(MENU_SAFE_PADDING, Math.min(rect.left + 18, window.innerWidth - 172));
    setMenuPos(null);
    setFolderMenuPos({ path, top, left });
  }

  function startRename(name: string) {
    setMenuPos(null);
    setActiveFile(name);
    const draft = currentDir === '' ? name : name.slice(currentDir.length + 1);
    setRenaming({ name, draft, saving: false });
  }

  async function startRenameFolder(path: string) {
    if (!onRenameFolder || folderAction) return;
    setFolderMenuPos(null);
    const currentLeaf = basenameForPath(path);
    const nextLeaf = window.prompt(t('designs.renamePrompt', { name: path }), currentLeaf);
    if (nextLeaf === null) return;
    const trimmedLeaf = nextLeaf.trim();
    if (!trimmedLeaf || trimmedLeaf === currentLeaf) return;
    const parent = dirnameForPath(path);
    const nextPath = parent ? `${parent}/${trimmedLeaf}` : trimmedLeaf;
    setFolderAction({ kind: 'renaming', path });
    setFolderNotice(null);
    try {
      const folder = await onRenameFolder(path, nextPath);
      if (!folder) throw new Error('Folder could not be renamed');
      setFolderNotice({ message: `${t('common.rename')}: ${folder.path}` });
      setCurrentDir((dir) => {
        if (dir === path) return folder.path;
        if (dir.startsWith(`${path}/`)) return `${folder.path}/${dir.slice(path.length + 1)}`;
        return dir;
      });
      expandFolderPath(folder.path);
    } catch (err) {
      setFolderNotice({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setFolderAction(null);
    }
  }

  async function commitRename(name: string, draft: string) {
    const nextBasename = draft.trim();
    if (!nextBasename) {
      setRenaming(null);
      return;
    }
    const nextName = currentDir === '' ? nextBasename : `${currentDir}/${nextBasename}`;
    if (nextName === name) {
      setRenaming(null);
      return;
    }
    setRenaming({ name, draft, saving: true });
    try {
      const renamed = await onRenameFile(name, nextName);
      if (!renamed) throw new Error('Rename failed');
      setActiveFile((curr) => (curr === name ? renamed.name : curr));
      setSelected((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        next.add(renamed.name);
        return next;
      });
      setRenaming(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setRenaming({ name, draft, saving: false });
    }
  }

  async function handleBatchDelete() {
    if (deleting) return;
    const fileList = [...selected];
    if (fileList.length === 0) return;
    setDeleting(true);
    try {
      await onDeleteFiles(fileList);
      // Don't clear `selected` here: confirm-cancel and all-fail paths
      // should leave the user's selection intact for retry. The
      // `useEffect` above prunes successfully-deleted names automatically
      // once `files` refreshes.
    } finally {
      setDeleting(false);
    }
  }

  function startCreateFolder() {
    setFolderDraft('');
    setFolderNotice(null);
    setCreatingFolder(true);
  }

  async function commitCreateFolder() {
    if (!onCreateFolder || folderAction) return;
    const leafName = folderDraft.trim();
    if (!leafName) {
      setCreatingFolder(false);
      return;
    }
    const path = currentDir === '' ? leafName : `${currentDir}/${leafName}`;
    setFolderAction({ kind: 'creating', path });
    setFolderNotice(null);
    try {
      const folder = await onCreateFolder(path);
      if (!folder) throw new Error('Folder could not be created');
      setFolderDraft('');
      setCreatingFolder(false);
      setFolderNotice({ message: t('designFiles.folderCreated', { name: folder.path }) });
    } catch (err) {
      setFolderNotice({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setFolderAction(null);
    }
  }

  async function handleDeleteFolder(path: string) {
    if (!onDeleteFolder || folderAction) return;
    if (!window.confirm(t('designFiles.deleteFolderConfirm', { name: path }))) return;
    setFolderAction({ kind: 'deleting', path });
    setFolderNotice(null);
    try {
      const ok = await onDeleteFolder(path);
      if (!ok) throw new Error('Folder could not be deleted');
      setFolderNotice({ message: t('designFiles.folderDeleted', { name: path }) });
    } catch (err) {
      setFolderNotice({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setFolderAction(null);
    }
  }

  function draggedNamesForFile(name: string): string[] {
    return selected.has(name) ? [...selected] : [name];
  }

  function readProjectFileDrag(dataTransfer: DataTransfer): string[] {
    const raw = dataTransfer.getData(DESIGN_FILE_DRAG_TYPE);
    if (!raw) return draggedProjectFiles;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : draggedProjectFiles;
    } catch {
      return draggedProjectFiles;
    }
  }

  function isProjectFileDrag(dataTransfer: DataTransfer): boolean {
    return draggedProjectFiles.length > 0 || Array.from(dataTransfer.types ?? []).includes(DESIGN_FILE_DRAG_TYPE);
  }

  async function moveFilesToFolder(names: string[], targetDir: string) {
    if (!onMoveFiles || folderAction) return;
    const uniqueNames = [...new Set(names)];
    const movable = uniqueNames.filter((name) => {
      const basename = basenameForPath(name);
      const nextName = targetDir ? `${targetDir}/${basename}` : basename;
      return nextName !== name;
    });
    if (movable.length === 0) return;
    setFolderAction({ kind: 'moving', path: targetDir });
    setFolderNotice(null);
    try {
      await onMoveFiles(movable, targetDir);
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const name of movable) next.delete(name);
        return next;
      });
      const dest = targetDir || t('designFiles.moveRoot');
      setFolderNotice({ message: t('designFiles.filesMoved', { n: movable.length, dest }) });
    } catch (err) {
      setFolderNotice({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setFolderAction(null);
    }
  }

  function readProjectFolderDrag(dataTransfer: DataTransfer): string | null {
    const raw = dataTransfer.getData(DESIGN_FOLDER_DRAG_TYPE);
    return normalizeFolderPath(raw || draggedFolderPath || '') || null;
  }

  function isProjectFolderDrag(dataTransfer: DataTransfer): boolean {
    if (draggedFolderPath !== null) return true;
    if (Array.from(dataTransfer.types ?? []).includes(DESIGN_FOLDER_DRAG_TYPE)) return true;
    try {
      return Boolean(dataTransfer.getData(DESIGN_FOLDER_DRAG_TYPE));
    } catch {
      return false;
    }
  }

  function setOrderedFolders(updater: (prev: FolderOrderMap) => FolderOrderMap) {
    setFolderOrder((prev) => {
      const next = updater(prev);
      writeFolderOrder(projectId, next);
      return next;
    });
  }

  function folderDropTargetFromEvent(
    event: ReactDragEvent<HTMLDivElement>,
    targetPath: string,
  ): FolderDragTarget {
    if (!targetPath) return { path: '', mode: 'inside' };
    const rect = event.currentTarget.getBoundingClientRect();
    if (!Number.isFinite(event.clientY) || rect.height <= 0 || event.clientY <= 0) {
      return { path: targetPath, mode: 'inside' };
    }
    const y = event.clientY - rect.top;
    if (y < rect.height * 0.25) return { path: targetPath, mode: 'before' };
    if (y > rect.height * 0.75) return { path: targetPath, mode: 'after' };
    return { path: targetPath, mode: 'inside' };
  }

  function folderDropTargetIsValid(sourcePath: string, target: FolderDragTarget): boolean {
    const source = normalizeFolderPath(sourcePath);
    const targetPath = normalizeFolderPath(target.path);
    if (!source) return false;
    if (targetPath === source) return target.mode === 'before' || target.mode === 'after';
    if (targetPath.startsWith(`${source}/`)) return false;
    const targetParent = target.mode === 'inside' ? targetPath : dirnameForPath(targetPath);
    if (targetParent === source || targetParent.startsWith(`${source}/`)) return false;
    return true;
  }

  function updateFolderDropTarget(
    event: ReactDragEvent<HTMLDivElement>,
    targetPath: string,
  ): FolderDragTarget | null {
    const source = readProjectFolderDrag(event.dataTransfer);
    if (!source) return null;
    const target = folderDropTargetFromEvent(event, targetPath);
    const valid = folderDropTargetIsValid(source, target);
    setFolderDragTarget(valid ? target : null);
    return valid ? target : null;
  }

  function reorderFolderSibling(sourcePath: string, anchorPath: string, mode: Extract<FolderDropMode, 'before' | 'after'>) {
    const parent = dirnameForPath(anchorPath);
    const siblings = childFolderPathsForParent(folderTree, parent);
    const nextOrder = reorderFolderPathList(siblings, sourcePath, anchorPath, mode);
    setOrderedFolders((prev) => ({ ...prev, [parent]: nextOrder }));
  }

  function updateFolderOrderAfterMove(sourcePath: string, newPath: string, target: FolderDragTarget) {
    const oldParent = dirnameForPath(sourcePath);
    const newParent = dirnameForPath(newPath);
    const targetMode = target.mode === 'before' || target.mode === 'after' ? target.mode : 'after';
    const anchorPath = target.mode === 'before' || target.mode === 'after' ? target.path : '';
    setOrderedFolders((prev) => {
      const next = remapFolderOrderMap(prev, sourcePath, newPath);
      if (oldParent !== newParent) {
        const oldSiblings = childFolderPathsForParent(folderTree, oldParent)
          .map((path) => remapFolderPath(path, sourcePath, newPath))
          .filter((path) => path !== newPath);
        next[oldParent] = oldSiblings;
      }
      const targetSiblings = childFolderPathsForParent(folderTree, newParent)
        .map((path) => remapFolderPath(path, sourcePath, newPath))
        .filter((path) => path !== sourcePath && path !== newPath);
      next[newParent] = insertFolderPath(targetSiblings, newPath, anchorPath, targetMode);
      return next;
    });
  }

  async function moveFolderToTarget(sourcePath: string, target: FolderDragTarget) {
    if (!onRenameFolder || folderAction) return;
    const source = normalizeFolderPath(sourcePath);
    if (!folderDropTargetIsValid(source, target)) return;
    const sourceLeaf = basenameForPath(source);
    const targetParent = target.mode === 'inside'
      ? normalizeFolderPath(target.path)
      : dirnameForPath(normalizeFolderPath(target.path));
    const nextPath = targetParent ? `${targetParent}/${sourceLeaf}` : sourceLeaf;

    if (nextPath === source) {
      if ((target.mode === 'before' || target.mode === 'after') && target.path !== source) {
        reorderFolderSibling(source, target.path, target.mode);
      }
      return;
    }

    setFolderAction({ kind: 'moving', path: targetParent });
    setFolderNotice(null);
    try {
      const folder = await onRenameFolder(source, nextPath);
      if (!folder) throw new Error('Folder could not be moved');
      setFolderNotice({ message: `${source} -> ${folder.path}` });
      setCurrentDir((dir) => {
        if (dir === source) return folder.path;
        if (dir.startsWith(`${source}/`)) return `${folder.path}/${dir.slice(source.length + 1)}`;
        return dir;
      });
      updateFolderOrderAfterMove(source, folder.path, target);
      expandFolderPath(folder.path);
      if (targetParent) expandFolderPath(targetParent);
    } catch (err) {
      setFolderNotice({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setFolderAction(null);
    }
  }

  function renderFileRow(f: ProjectFile, category: FileCategory) {
    const active = activeFile === f.name;
    const isSelected = selected.has(f.name);
    const isHovered = hover === f.name;
    const renameState = renaming?.name === f.name ? renaming : null;
    return (
      <div
        key={f.name}
        data-testid={`design-file-row-${f.name}`}
        className={`df-row df-file-row ${active ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
        onMouseEnter={() => setHover(f.name)}
        onMouseLeave={() => setHover((c) => (c === f.name ? null : c))}
        draggable={!renameState}
        onDragStart={(e) => {
          const names = draggedNamesForFile(f.name);
          setDraggedProjectFiles(names);
          setActiveFile(f.name);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DESIGN_FILE_DRAG_TYPE, JSON.stringify(names));
          e.dataTransfer.setData('text/plain', names.join('\n'));
        }}
        onDragEnd={() => {
          setDraggedProjectFiles([]);
          setFolderDropTarget(null);
        }}
      >
        <span
          className="df-row-check"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(f.name);
          }}
          role="checkbox"
          aria-checked={isSelected}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              toggleSelect(f.name);
            }
          }}
        >
          {isSelected ? '☑' : '☐'}
        </span>
        <span
          className="df-row-icon df-row-openable"
          data-kind={category}
          aria-hidden
          onClick={() => setActiveFile(f.name)}
          onDoubleClick={() => onOpenFile(f.name)}
        >
          {categoryGlyph(category)}
        </span>
        <div className="df-row-name-wrap">
          {renameState ? (
            <input
              autoFocus
              className="df-rename-input"
              value={renameState.draft}
              disabled={renameState.saving}
              onChange={(e) => setRenaming({ ...renameState, draft: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (e.currentTarget.dataset.skipRenameCommit === '1') return;
                void commitRename(f.name, renameState.draft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.dataset.skipRenameCommit = '1';
                  void commitRename(f.name, renameState.draft);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.currentTarget.dataset.skipRenameCommit = '1';
                  setRenaming(null);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="df-row-name-btn"
              onClick={() => setActiveFile(f.name)}
              onDoubleClick={() => onOpenFile(f.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  const now = Date.now();
                  const last = lastKeyPress.current.get(f.name) ?? 0;
                  if (now - last < 300) {
                    lastKeyPress.current.delete(f.name);
                    onOpenFile(f.name);
                  } else {
                    lastKeyPress.current.set(f.name, now);
                    setActiveFile(f.name);
                  }
                }
              }}
            >
              <span className="df-row-name-wrap">
                <span
                  className="df-row-name"
                  title={currentDir === '' ? f.name : f.name.slice(currentDir.length + 1)}
                >
                  {currentDir === '' ? f.name : f.name.slice(currentDir.length + 1)}
                </span>
                <span className="df-row-sub">{categoryLabel(category, t)}</span>
              </span>
            </button>
          )}
        </div>
        <span className="df-row-kind">{categoryLabel(category, t)}</span>
        <span className="df-row-size">{humanBytes(f.size)}</span>
        <span
          className="df-row-time df-row-openable"
          onClick={() => setActiveFile(f.name)}
          onDoubleClick={() => onOpenFile(f.name)}
        >
          {relativeTime(f.mtime, t)}
        </span>
        <span
          data-testid={`design-file-menu-${f.name}`}
          className="df-row-menu"
          style={isHovered || active ? { opacity: 1 } : undefined}
          role="button"
          tabIndex={0}
          aria-label={t('designFiles.rowMenu')}
          onClick={(e) => {
            e.stopPropagation();
            openMenuFor(f.name, e.target as HTMLElement);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              openMenuFor(f.name, e.currentTarget as HTMLElement);
            }
          }}
        >
          ⋯
        </span>
      </div>
    );
  }

  function expandFolderPath(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const ancestor of folderAncestors(path)) next.add(ancestor);
      return next;
    });
  }

  function openFolderPath(path: string) {
    expandFolderPath(path);
    setCurrentDir(path);
  }

  function toggleFolderExpansion(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function renderFolderDropZone(
    targetDir: string,
    className: string,
    children: ReactNode,
    onClick?: () => void,
    testId?: string,
    onContextMenu?: (ev: ReactMouseEvent<HTMLDivElement>) => void,
    draggableFolder?: { path: string; label: string },
  ) {
    const deletingThisFolder = folderAction?.kind === 'deleting' && folderAction.path === targetDir;
    const movingIntoThisFolder = folderAction?.kind === 'moving' && folderAction.path === targetDir;
    const isDropTarget = folderDropTarget === targetDir;
    const folderDropMode =
      folderDragTarget?.path === targetDir ? folderDragTarget.mode : null;
    const draggingThisFolder = draggableFolder?.path === draggedFolderPath;
    return (
      <div
        className={[
          className,
          isDropTarget ? 'is-drop-target' : '',
          folderDropMode ? `is-folder-drop-${folderDropMode}` : '',
          draggingThisFolder ? 'is-folder-dragging' : '',
          deletingThisFolder || movingIntoThisFolder ? 'is-busy' : '',
        ].filter(Boolean).join(' ')}
        data-testid={testId}
        draggable={Boolean(draggableFolder && onRenameFolder)}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragStart={(ev) => {
          if (!draggableFolder || !onRenameFolder) return;
          ev.stopPropagation();
          setDraggedFolderPath(draggableFolder.path);
          setFolderMenuPos(null);
          setMenuPos(null);
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData(DESIGN_FOLDER_DRAG_TYPE, draggableFolder.path);
          ev.dataTransfer.setData('text/plain', draggableFolder.label);
          setFolderDragImage(ev.dataTransfer, draggableFolder.label);
        }}
        onDragEnter={(ev) => {
          if (isProjectFolderDrag(ev.dataTransfer)) {
            ev.preventDefault();
            ev.stopPropagation();
            updateFolderDropTarget(ev, targetDir);
            return;
          }
          if (!isProjectFileDrag(ev.dataTransfer)) return;
          ev.preventDefault();
          ev.stopPropagation();
          setFolderDropTarget(targetDir);
        }}
        onDragOver={(ev) => {
          if (isProjectFolderDrag(ev.dataTransfer)) {
            ev.preventDefault();
            ev.stopPropagation();
            const target = updateFolderDropTarget(ev, targetDir);
            ev.dataTransfer.dropEffect = target ? 'move' : 'none';
            return;
          }
          if (!isProjectFileDrag(ev.dataTransfer)) return;
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = 'move';
          setFolderDropTarget(targetDir);
        }}
        onDragLeave={(ev) => {
          if (ev.currentTarget.contains(ev.relatedTarget as Node | null)) return;
          setFolderDropTarget((current) => (current === targetDir ? null : current));
          setFolderDragTarget((current) => (current?.path === targetDir ? null : current));
        }}
        onDrop={(ev) => {
          if (isProjectFolderDrag(ev.dataTransfer)) {
            ev.preventDefault();
            ev.stopPropagation();
            const source = readProjectFolderDrag(ev.dataTransfer);
            const target = folderDropTargetFromEvent(ev, targetDir);
            setDraggedFolderPath(null);
            setFolderDragTarget(null);
            if (source && folderDropTargetIsValid(source, target)) {
              void moveFolderToTarget(source, target);
            }
            return;
          }
          if (!isProjectFileDrag(ev.dataTransfer)) return;
          ev.preventDefault();
          ev.stopPropagation();
          const names = readProjectFileDrag(ev.dataTransfer);
          setDraggedProjectFiles([]);
          setFolderDropTarget(null);
          void moveFilesToFolder(names, targetDir);
        }}
        onDragEnd={() => {
          if (!draggableFolder) return;
          setDraggedFolderPath(null);
          setFolderDragTarget(null);
        }}
      >
        {children}
      </div>
    );
  }

  function renderTreeRoot() {
    const hasChildren = folderTree.length > 0 || creatingFolder;
    return renderFolderDropZone(
      '',
      [
        'df-tree-row',
        'df-tree-root',
        currentDir === '' ? 'active' : '',
      ].filter(Boolean).join(' '),
      <>
        <span className="df-tree-indent" aria-hidden />
        <button
          type="button"
          className="df-tree-toggle"
          disabled={!hasChildren}
          aria-label={rootExpanded ? 'Collapse folder' : 'Expand folder'}
          aria-expanded={hasChildren ? rootExpanded : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setRootExpanded((expanded) => !expanded);
          }}
        >
          {hasChildren ? (
            <Icon name={rootExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
          ) : null}
        </button>
        <span className="df-tree-folder-icon" aria-hidden>
          <Icon name="folder-filled" size={15} />
        </span>
        <button type="button" className="df-row-name-btn" onClick={() => openFolderPath('')}>
          <span className="df-tree-name" title={rootDirName ?? t('designFiles.crumbs')}>
            {rootDirName ?? t('designFiles.crumbs')}
          </span>
        </button>
      </>,
      () => openFolderPath(''),
      undefined,
      undefined,
      undefined,
    );
  }

  function renderTreeNode(node: FolderTreeNode, depth = 0): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const expanded = expandedFolders.has(node.path) || currentDir.startsWith(`${node.path}/`);
    const deletingThisFolder = folderAction?.kind === 'deleting' && folderAction.path === node.path;
    const renamingThisFolder = folderAction?.kind === 'renaming' && folderAction.path === node.path;
    const row = renderFolderDropZone(
      node.path,
      [
        'df-tree-row',
        'df-dir-row',
        currentDir === node.path ? 'active' : '',
      ].filter(Boolean).join(' '),
      <>
        <span className="df-tree-indent" style={{ '--df-tree-depth': depth } as CSSProperties} aria-hidden />
        <button
          type="button"
          className="df-tree-toggle"
          disabled={!hasChildren}
          aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
          aria-expanded={hasChildren ? expanded : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleFolderExpansion(node.path);
          }}
        >
          {hasChildren ? (
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
          ) : null}
        </button>
        <span className="df-tree-folder-icon" aria-hidden>
          <Icon name={currentDir === node.path ? 'folder-filled' : 'folder'} size={15} />
        </span>
        <button type="button" className="df-row-name-btn" onClick={() => openFolderPath(node.path)}>
          <span className="df-tree-name" title={node.name}>{node.name}</span>
        </button>
      </>,
      () => openFolderPath(node.path),
      `design-folder-row-${node.path}`,
      (ev) => {
        if (!onRenameFolder && !onDeleteFolder) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (deletingThisFolder || renamingThisFolder) return;
        openFolderMenuFor(node.path, ev.currentTarget);
      },
      { path: node.path, label: node.name },
    );
    return (
      <div key={`dir:${node.path}`} className="df-tree-node">
        {row}
        {expanded && node.children.length > 0 ? (
          <div className="df-tree-children">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCreateFolderRow() {
    const creatingThisFolder = folderAction?.kind === 'creating';
    return (
      <form
        className="df-row df-folder-create-row"
        data-testid="design-folder-create-row"
        onSubmit={(e) => {
          e.preventDefault();
          void commitCreateFolder();
        }}
      >
        <span className="df-row-check" aria-hidden />
        <span className="df-row-icon" data-kind="folder" aria-hidden>
          <Icon name="folder" size={14} />
        </span>
        <div className="df-row-name-wrap">
          <input
            autoFocus
            className="df-rename-input"
            value={folderDraft}
            disabled={creatingThisFolder}
            placeholder={t('designFiles.newFolderLabel')}
            onChange={(e) => setFolderDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setCreatingFolder(false);
                setFolderDraft('');
              }
            }}
          />
        </div>
        <span className="df-row-time" />
        <span className="df-folder-create-actions">
          <button type="submit" disabled={creatingThisFolder || !folderDraft.trim()} title={t('common.save')}>
            <Icon name="check" size={13} />
          </button>
          <button
            type="button"
            disabled={creatingThisFolder}
            title={t('common.cancel')}
            onClick={() => {
              setCreatingFolder(false);
              setFolderDraft('');
            }}
          >
            <Icon name="close" size={13} />
          </button>
        </span>
      </form>
    );
  }

  async function handleBatchDownload() {
    const fileList = [...selected];
    if (fileList.length === 0) return;
    try {
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileList }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        throw new Error(err?.message || `request failed (${resp.status})`);
      }
      const blob = await resp.blob();
      const header = resp.headers.get('content-disposition') || '';
      const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
      let filename = 'project.zip';
      if (star && star[1]) {
        try {
          filename = decodeURIComponent(star[1]);
        } catch {
          filename = star[1];
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.warn('[batchDownload] failed:', err);
    }
  }

  async function handleDrop(ev: React.DragEvent<HTMLDivElement>) {
    if (!dataTransferHasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    setDropReadError(null);
    try {
      const dropped = await filesFromDataTransfer(ev.dataTransfer);
      if (dropped.length > 0) onUploadFiles(dropped);
    } catch (error) {
      if (!isFileSystemReadError(error)) throw error;
      setDropReadError(FILE_SYSTEM_READ_ERROR_MESSAGE);
    }
  }

  async function handlePluginFolderAgentAction(
    relativePath: string,
    action: PluginFolderAgentAction,
  ) {
    if (!onPluginFolderAgentAction || installingFolder || sharingFolder) return;
    setInstallNotice(null);
    if (action === 'install') {
      setInstallingFolder(relativePath);
    } else {
      setSharingFolder(`${action}:${relativePath}`);
    }
    try {
      const outcome = await onPluginFolderAgentAction(relativePath, action);
      const url = outcome && typeof outcome === 'object' && typeof outcome.url === 'string'
        ? outcome.url
        : '';
      const message = outcome && typeof outcome === 'object' && typeof outcome.message === 'string'
        ? outcome.message
        : '';
      if (message || url) setInstallNotice(buildActionNotice(message || url, url));
    } catch (err) {
      setInstallNotice({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setInstallingFolder(null);
      setSharingFolder(null);
    }
  }

  const fileActions = (
    <div className="df-actions">
      <button type="button" onClick={onNewSketch} title={t('designFiles.newSketch')}>
        <Icon name="pencil" size={13} />
        <span>{t('designFiles.newSketch')}</span>
      </button>
      <button type="button" onClick={onPaste} title={t('designFiles.paste.title')}>
        <Icon name="copy" size={13} />
        <span>{t('designFiles.paste.label')}</span>
      </button>
      <button
        type="button"
        data-testid="design-files-upload-trigger"
        onClick={onUpload}
        title={t('designFiles.upload.title')}
      >
        <Icon name="upload" size={13} />
        <span>{t('designFiles.upload.label')}</span>
      </button>
    </div>
  );

  const breadcrumbs = (
    <nav className="df-breadcrumbs" aria-label={t('designFiles.crumbs')}>
      {currentDir === '' ? (
        <span className="df-breadcrumb-current">
          {rootDirName ?? t('designFiles.crumbs')}
        </span>
      ) : (
        <button
          type="button"
          className="df-breadcrumb-btn"
          onClick={() => setCurrentDir('')}
        >
          {rootDirName ?? t('designFiles.crumbs')}
        </button>
      )}
      {currentDir.split('/').filter(Boolean).map((segment, idx, parts) => {
        const path = parts.slice(0, idx + 1).join('/');
        const isLast = idx === parts.length - 1;
        return (
          <span key={path} className="df-breadcrumb-segment">
            <span className="df-breadcrumb-sep" aria-hidden>/</span>
            {isLast ? (
              <span className="df-breadcrumb-current">{segment}</span>
            ) : (
              <button
                type="button"
                className="df-breadcrumb-btn"
                onClick={() => setCurrentDir(path)}
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );

  const visibleUploadError = uploadError ?? dropReadError;
  const hasSelection = selected.size > 0;
  const dropZone = (
    <div
      className={`df-drop ${draggingFiles ? 'dragging' : ''}`}
      onDragEnter={(ev) => {
        if (!dataTransferHasFiles(ev.dataTransfer)) return;
        ev.preventDefault();
        dragDepthRef.current += 1;
        setDraggingFiles(true);
      }}
      onDragOver={(ev) => {
        if (!dataTransferHasFiles(ev.dataTransfer)) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) {
          dragDepthRef.current = 0;
          setDraggingFiles(false);
          return;
        }
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDraggingFiles(false);
      }}
      onDrop={handleDrop}
    >
      <span className="label">{t('designFiles.dropTitle')}</span>
      <span className="desc">{t('designFiles.dropDesc')}</span>
    </div>
  );

  return (
    <div className={`df-panel no-preview ${hasSelection ? 'has-selection' : ''} ${draggedFolderPath ? 'is-folder-dragging' : ''}`}>
      {reloading ? (
        <div className="df-reloading-overlay" data-testid="design-files-reloading">
          <span className="loading-spinner">
            <Icon name="spinner" size={16} />
            <span className="loading-spinner-label">{t('common.loading')}</span>
          </span>
        </div>
      ) : null}
      <div className="df-main">
        <div className="df-topbar">
          <div className="df-topbar-left">{breadcrumbs}</div>
          <div className="df-topbar-right">{fileActions}</div>
        </div>
        <div className="df-body">
          {visibleUploadError ? (
            <div className="df-upload-banner" data-testid="upload-error-banner">
              <span>{visibleUploadError}</span>
              {onClearUploadError || dropReadError ? (
                <button
                  type="button"
                  data-testid="upload-error-dismiss"
                  onClick={() => {
                    setDropReadError(null);
                    onClearUploadError?.();
                  }}
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          ) : null}
          {hasSelection ? (
            <div className="df-batch-bar" data-testid="design-files-batch-bar">
              <span className="df-batch-count">
                {t('designFiles.downloadSelected', { n: selected.size })}
              </span>
              <div className="df-batch-actions">
                <button
                  type="button"
                  onClick={() => {
                    trackFileManagerClick(analytics.track, {
                      page_name: 'file_manager',
                      area: 'file_manager',
                      element: 'download_as_zip',
                    });
                    void handleBatchDownload();
                  }}
                  title={t('designFiles.downloadSelected', { n: selected.size })}
                >
                  <Icon name="download" size={13} />
                  <span>{t('designFiles.download')}</span>
                </button>
                <button
                  type="button"
                  className="danger"
                  data-testid="design-files-batch-delete"
                  disabled={deleting}
                  onClick={() => void handleBatchDelete()}
                  title={t('designFiles.deleteSelected', { n: selected.size })}
                >
                  <span>{t('designFiles.delete')}</span>
                </button>
                <button type="button" className="df-batch-clear" onClick={clearSelection}>
                  {t('designFiles.clearSelection')}
                </button>
              </div>
            </div>
          ) : null}
          <div className="df-browser">
            <aside className="df-tree-pane" aria-label={t('designFiles.sectionFolders')}>
              <div className="df-tree-head">
                <span>{t('designFiles.sectionFolders')}</span>
                {onCreateFolder ? (
                  <button
                    type="button"
                    className="df-tree-add od-tooltip"
                    aria-label={t('designFiles.newFolderTitle')}
                    title={t('designFiles.newFolderTitle')}
                    data-tooltip={t('designFiles.newFolderTitle')}
                    data-tooltip-placement="right"
                    onClick={startCreateFolder}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                ) : null}
              </div>
              <div className="df-tree-scroll">
                {renderTreeRoot()}
                {rootExpanded ? (
                  <>
                    {creatingFolder ? (
                      <div className="df-tree-create">
                        <span className="df-tree-create-path">
                          {currentDir || (rootDirName ?? t('designFiles.crumbs'))}
                        </span>
                        {renderCreateFolderRow()}
                      </div>
                    ) : null}
                    {folderTree.map((node) => renderTreeNode(node))}
                  </>
                ) : null}
              </div>
            </aside>
            <section className="df-file-table-panel">
              <div className="df-file-table-head">
                <div className="df-file-table-title">
                  <span>{currentDir || (rootDirName ?? t('designFiles.crumbs'))}</span>
                  <span>{t('designFiles.folderCount', { n: tableFiles.length })}</span>
                </div>
              </div>
              {folderNotice ? (
                <div className="df-inline-notice" role="status">
                  <ActionNoticeView notice={folderNotice} />
                </div>
              ) : null}
              {installNotice ? (
                <div className="df-inline-notice" role="status">
                  <ActionNoticeView notice={installNotice} />
                </div>
              ) : null}
              {files.length === 0 && liveArtifacts.length === 0 && (folders?.length ?? 0) === 0 ? (
                <div className="df-empty" data-testid="design-files-empty">
                  <div className="df-empty-pill">
                    <span className="df-empty-title">
                      {t('designFiles.empty')}
                    </span>
                    <button
                      type="button"
                      className="df-empty-cta"
                      data-testid="design-files-empty-new-sketch"
                      onClick={onNewSketch}
                      title={t('designFiles.newSketch')}
                    >
                      <Icon name="pencil" size={13} />
                      <span>{t('designFiles.newSketch')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {currentDir === '' && liveArtifacts.length > 0 ? (
                    <div className="df-live-strip">
                      {liveArtifacts.map((artifact) => (
                        <button
                          key={artifact.artifactId}
                          type="button"
                          data-testid={`design-file-row-${artifact.tabId}`}
                          className="df-row df-row-live-artifact"
                          onDoubleClick={() => onOpenLiveArtifact(artifact.tabId)}
                          onClick={() => onOpenLiveArtifact(artifact.tabId)}
                        >
                          <span className="df-row-icon" data-kind="live-artifact" aria-hidden>
                            ◉
                          </span>
                          <span className="df-row-name-wrap">
                            <span className="df-row-name" title={artifact.title}>
                              {artifact.title}
                            </span>
                            <span className="df-row-sub">
                              <span>{t('designFiles.kindLiveArtifact')}</span>
                              <LiveArtifactBadges
                                compact
                                status={artifact.status}
                                refreshStatus={artifact.refreshStatus}
                              />
                            </span>
                          </span>
                          <span className="df-row-time">
                            {relativeTime(Date.parse(artifact.updatedAt) || Date.now(), t)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {currentDir === '' && pluginFolders.length > 0 ? (
                    <div className="df-plugin-strip">
                      {pluginFolders.filter((folder) => !hiddenPluginActionPaths.has(folder.path)).map((folder) => {
                        const actionBusy = activePluginActionPaths.has(folder.path);
                        return (
                          <div
                            key={folder.path}
                            className="df-row df-row-plugin-folder"
                            data-testid={`design-plugin-folder-${folder.path}`}
                          >
                            <button
                              type="button"
                              className="df-row-folder-main"
                              onClick={() => setActiveFile(folder.manifestPath)}
                            >
                              <span className="df-row-icon" data-kind="folder" aria-hidden>
                                <Icon name="folder" size={14} />
                              </span>
                              <span className="df-row-name-wrap">
                                <span className="df-row-name">{folder.path}</span>
                                <span className="df-row-sub">
                                  {folder.fileCount} files · ready to add to My plugins
                                </span>
                              </span>
                            </button>
                            <span className="df-row-time">{relativeTime(folder.updatedAt, t)}</span>
                            {onPluginFolderAgentAction ? (
                              <div className="df-plugin-actions">
                                <button
                                  type="button"
                                  className="df-plugin-install"
                                  data-testid={`design-plugin-folder-install-${folder.path}`}
                                  disabled={actionBusy || installingFolder !== null || sharingFolder !== null}
                                  onClick={() =>
                                    void handlePluginFolderAgentAction(folder.path, 'install')
                                  }
                                >
                                  {installingFolder === folder.path ? 'Sending…' : 'Add to My plugins'}
                                </button>
                                <button
                                  type="button"
                                  className="df-plugin-install"
                                  data-testid={`design-plugin-folder-publish-${folder.path}`}
                                  disabled={actionBusy || installingFolder !== null || sharingFolder !== null}
                                  onClick={() =>
                                    void handlePluginFolderAgentAction(folder.path, 'publish')
                                  }
                                >
                                  {sharingFolder === `publish:${folder.path}` ? 'Sending…' : 'Publish repo'}
                                </button>
                                <button
                                  type="button"
                                  className="df-plugin-install"
                                  data-testid={`design-plugin-folder-contribute-${folder.path}`}
                                  disabled={actionBusy || installingFolder !== null || sharingFolder !== null}
                                  onClick={() =>
                                    void handlePluginFolderAgentAction(folder.path, 'contribute')
                                  }
                                >
                                  {sharingFolder === `contribute:${folder.path}` ? 'Sending…' : 'Open Design PR'}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="df-file-table" role="table" aria-label="Project files">
                    <div className="df-file-table-header" role="row">
                      <span>Name</span>
                      <span>Kind</span>
                      <span>Size</span>
                      <span>Modified</span>
                      <span aria-hidden />
                    </div>
                    {tableFiles.length > 0 ? (
                      tableFiles.map((f) => renderFileRow(f, fileCategory(f)))
                    ) : (
                      <div className="df-table-empty">
                        {t('designFiles.empty')}
                      </div>
                    )}
                  </div>
                </>
              )}
              {dropZone}
            </section>
          </div>
        </div>
      </div>
      {menuPos ? (
        <div
          data-testid="design-file-menu-popover"
          className="df-row-popover"
          style={{ top: menuPos.top, left: menuPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const name = menuPos.name;
              setMenuPos(null);
              onOpenFile(name);
            }}
          >
            {t('designFiles.openInTab')}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startRename(menuPos.name);
            }}
          >
            {t('common.rename')}
          </button>
          <a
            href={projectFileUrl(projectId, menuPos.name)}
            download={menuPos.name}
            style={{ textDecoration: 'none' }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuPos(null);
              }}
            >
              {t('designFiles.download')}
            </button>
          </a>
          <button
            type="button"
            className="danger"
            data-testid={`design-file-delete-${menuPos.name}`}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const name = menuPos.name;
              setMenuPos(null);
              onDeleteFile(name);
            }}
          >
            {t('designFiles.delete')}
          </button>
        </div>
      ) : null}
      {folderMenuPos ? (
        <div
          data-testid="design-folder-menu-popover"
          className="df-row-popover"
          style={{ top: folderMenuPos.top, left: folderMenuPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {onRenameFolder ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void startRenameFolder(folderMenuPos.path);
              }}
            >
              {t('common.rename')}
            </button>
          ) : null}
          {onDeleteFolder ? (
            <button
              type="button"
              className="danger"
              data-testid={`design-folder-delete-${folderMenuPos.path}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const path = folderMenuPos.path;
                setFolderMenuPos(null);
                void handleDeleteFolder(path);
              }}
            >
              {t('designFiles.delete')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Singular row subtitle for a category.
function categoryLabel(category: FileCategory, t: TranslateFn): string {
  if (category === 'stylesheet') return t('designFiles.kindStylesheet');
  return kindLabel(category, t);
}

function categoryGlyph(category: FileCategory): string {
  if (category === 'stylesheet') return '#';
  return kindGlyph(category);
}

async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const fallbackFiles = Array.from(dataTransfer.files ?? []);
  if (items.length === 0) return fallbackFiles;

  const results = await Promise.allSettled(items.map(filesFromDataTransferItem));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) {
    if (fallbackFiles.length > 0) return fallbackFiles;
    throw rejected.reason;
  }
  const files = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  return files.length > 0 ? files : fallbackFiles;
}

async function filesFromDataTransferItem(item: DataTransferItem): Promise<File[]> {
  const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
  if (!entry) {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    return file ? [file] : [];
  }
  return filesFromFileSystemEntry(entry);
}

async function filesFromFileSystemEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await fileFromEntry(entry as FileSystemFileEntryWithFile)];
  if (!entry.isDirectory) return [];

  const reader = (entry as FileSystemEntryWithReader).createReader?.();
  if (!reader) return [];

  const files: File[] = [];
  for (;;) {
    const entries = await readEntryBatch(reader);
    if (entries.length === 0) break;
    const nested = await Promise.all(entries.map(filesFromFileSystemEntry));
    files.push(...nested.flat());
  }
  return files;
}

function fileFromEntry(entry: FileSystemFileEntryWithFile): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, (error) => {
      reject(createFileSystemReadError('Could not read dropped file', error));
    });
  });
}

function readEntryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, (error) => {
      reject(createFileSystemReadError('Could not read dropped folder', error));
    });
  });
}

function kindGlyph(kind: ProjectFileKind): string {
  if (kind === 'html') return '⟨⟩';
  if (kind === 'image') return '▣';
  if (kind === 'sketch') return '✎';
  if (kind === 'text') return '¶';
  if (kind === 'code') return '{}';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'document') return 'DOC';
  if (kind === 'presentation') return 'PPT';
  if (kind === 'spreadsheet') return 'XLS';
  return '·';
}

function kindLabel(kind: ProjectFileKind, t: TranslateFn): string {
  if (kind === 'html') return t('designFiles.kindHtml');
  if (kind === 'image') return t('designFiles.kindImage');
  if (kind === 'sketch') return t('designFiles.kindSketch');
  if (kind === 'text') return t('designFiles.kindText');
  if (kind === 'code') return t('designFiles.kindCode');
  if (kind === 'pdf') return t('designFiles.kindPdf');
  if (kind === 'document') return t('designFiles.kindDocument');
  if (kind === 'presentation') return t('designFiles.kindPresentation');
  if (kind === 'spreadsheet') return t('designFiles.kindSpreadsheet');
  return t('designFiles.kindBinary');
}

const DESIGN_FILE_DRAG_TYPE = 'application/x-open-design-project-files';
const DESIGN_FOLDER_DRAG_TYPE = 'application/x-open-design-project-folder';
const FOLDER_ORDER_STORAGE_PREFIX = 'open-design:design-files-folder-order:v1:';

function basenameForPath(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function dataTransferHasFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

function buildFolderTree(files: ProjectFile[], folders: ProjectFolder[], orderMap: FolderOrderMap = {}): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>();
  const ensureNode = (path: string): FolderTreeNode | null => {
    const normalized = normalizeFolderPath(path);
    if (!normalized) return null;
    const existing = nodes.get(normalized);
    if (existing) return existing;
    const node: FolderTreeNode = {
      name: basenameForPath(normalized),
      path: normalized,
      fileCount: 0,
      children: [],
    };
    nodes.set(normalized, node);
    const parentPath = dirnameForPath(normalized);
    const parent = parentPath ? ensureNode(parentPath) : null;
    if (parent) parent.children.push(node);
    return node;
  };

  for (const folder of folders) {
    ensureNode(folder.path);
  }

  for (const file of files) {
    const parts = file.name.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      ensureNode(parts.slice(0, i).join('/'));
    }
    for (let i = 1; i < parts.length; i++) {
      const node = nodes.get(parts.slice(0, i).join('/'));
      if (node) node.fileCount += 1;
    }
  }

  const roots: FolderTreeNode[] = [];
  for (const node of nodes.values()) {
    if (!dirnameForPath(node.path)) roots.push(node);
  }
  const sortNodes = (items: FolderTreeNode[], parentPath: string) => {
    const order = orderMap[parentPath] ?? [];
    const orderIndex = new Map(order.map((path, index) => [path, index] as const));
    items.sort((a, b) => {
      const aIndex = orderIndex.get(a.path);
      const bIndex = orderIndex.get(b.path);
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
      if (aIndex !== undefined) return -1;
      if (bIndex !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of items) sortNodes(item.children, item.path);
  };
  sortNodes(roots, '');
  return roots;
}

function childFolderPathsForParent(nodes: FolderTreeNode[], parentPath: string): string[] {
  if (!parentPath) return nodes.map((node) => node.path);
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.path === parentPath) return node.children.map((child) => child.path);
    stack.push(...node.children);
  }
  return [];
}

function reorderFolderPathList(
  paths: string[],
  sourcePath: string,
  anchorPath: string,
  mode: Extract<FolderDropMode, 'before' | 'after'>,
): string[] {
  return insertFolderPath(
    paths.filter((path) => path !== sourcePath),
    sourcePath,
    anchorPath,
    mode,
  );
}

function insertFolderPath(
  paths: string[],
  sourcePath: string,
  anchorPath: string,
  mode: Extract<FolderDropMode, 'before' | 'after'>,
): string[] {
  const next = paths.filter((path) => path !== sourcePath);
  const anchorIndex = anchorPath ? next.indexOf(anchorPath) : -1;
  if (anchorIndex < 0) return [...next, sourcePath];
  next.splice(mode === 'before' ? anchorIndex : anchorIndex + 1, 0, sourcePath);
  return next;
}

function remapFolderOrderMap(orderMap: FolderOrderMap, fromPath: string, toPath: string): FolderOrderMap {
  const next: FolderOrderMap = {};
  for (const [parentPath, children] of Object.entries(orderMap)) {
    const nextParent = remapFolderPath(parentPath, fromPath, toPath);
    next[nextParent] = children.map((path) => remapFolderPath(path, fromPath, toPath));
  }
  return next;
}

function remapFolderPath(path: string, fromPath: string, toPath: string): string {
  if (path === fromPath) return toPath;
  if (path.startsWith(`${fromPath}/`)) return `${toPath}/${path.slice(fromPath.length + 1)}`;
  return path;
}

function readFolderOrder(projectId: string): FolderOrderMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`${FOLDER_ORDER_STORAGE_PREFIX}${projectId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const next: FolderOrderMap = {};
    for (const [parentPath, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      next[normalizeFolderPath(parentPath)] = value
        .filter((path): path is string => typeof path === 'string')
        .map(normalizeFolderPath)
        .filter(Boolean);
    }
    return next;
  } catch {
    return {};
  }
}

function writeFolderOrder(projectId: string, orderMap: FolderOrderMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${FOLDER_ORDER_STORAGE_PREFIX}${projectId}`, JSON.stringify(orderMap));
  } catch {
    /* localStorage may be disabled in hardened contexts. */
  }
}

function setFolderDragImage(dataTransfer: DataTransfer, label: string): void {
  if (typeof document === 'undefined' || typeof dataTransfer.setDragImage !== 'function') return;
  const ghost = document.createElement('div');
  ghost.className = 'df-folder-drag-image';
  ghost.textContent = label;
  document.body.appendChild(ghost);
  dataTransfer.setDragImage(ghost, 18, 18);
  window.setTimeout(() => ghost.remove(), 0);
}

function folderAncestors(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

function dirnameForPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function relativeTime(ts: number, t: TranslateFn): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  if (diff < 30 * day)
    return t('designFiles.weeksAgo', { n: Math.floor(diff / (7 * day)) });
  return new Date(ts).toLocaleDateString();
}
