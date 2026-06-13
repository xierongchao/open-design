import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useAnalytics } from '../analytics/provider';
import { trackFileManagerClick } from '../analytics/events';
import { useT } from '../i18n';
import { copyToClipboard } from '../lib/copy-to-clipboard';
import { projectFileUrl } from '../providers/registry';
import { displayNameForPath, type FileAliasMap } from '../runtime/file-aliases';
import type { LiveArtifactWorkspaceEntry, ProjectFile, ProjectFileKind, ProjectFolder } from '../types';
import {
  createFileSystemReadError,
  FILE_SYSTEM_READ_ERROR_MESSAGE,
  isFileSystemReadError,
} from '../utils/fileSystemErrors';
import type { PluginFolderAgentAction } from './design-files/pluginFolderActions';
import { getPluginFolderCandidates } from './design-files/pluginFolders';
import { Icon, type IconName } from './Icon';
import { LiveArtifactBadges } from './LiveArtifactBadges';

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
  activeFileName?: string | null;
  headerContent?: ReactNode;
  sidebarFooter?: ReactNode;
  sideTreeOnly?: boolean;
  onBack?: () => void;
  backLabel?: string;
  previewContent?: ReactNode;
  onCopyFile?: (name: string) => Promise<ProjectFile | null> | ProjectFile | null;
  // Display alias map (file path -> alias) the tree renders in place of the
  // real base name. Optional so a panel mounted without alias support keeps
  // working.
  fileAliases?: FileAliasMap;
  // Sets a display alias for a file. The real on-disk path never changes, so
  // HTML/asset references inside the file keep resolving. Returning the
  // (unchanged) file lets the inline rename editor resolve cleanly.
  onSetFileAlias?: (
    name: string,
    alias: string,
  ) => Promise<ProjectFile | null> | ProjectFile | null;
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
  onNewArtboard?: () => void;
  /** When set to a file name, auto-triggers inline rename for that file on next render. */
  autoRenameFile?: string | null;
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
 * Full-panel browser for a project's `.od/projects/<id>/` folder. Files and
 * folders share one compact tree; selecting a file keeps the tree mounted and
 * renders the existing FileWorkspace preview surface beside it.
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
  activeFileName,
  headerContent,
  sidebarFooter,
  sideTreeOnly = false,
  onBack,
  backLabel,
  previewContent,
  onCopyFile,
  fileAliases,
  onSetFileAlias,
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
  onNewArtboard,
  autoRenameFile = null,
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
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ name: string; top: number; left: number } | null>(null);
  const [folderMenuPos, setFolderMenuPos] = useState<{ path: string; top: number; left: number } | null>(null);
  const [rootMenuOpen, setRootMenuOpen] = useState(false);
  const [rootMenuPos, setRootMenuPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_ESTIMATED_HEIGHT = 145;
  const FOLDER_MENU_ESTIMATED_HEIGHT = 128;
  const ROOT_MENU_ESTIMATED_HEIGHT = 128;
  const MENU_SAFE_PADDING = 8;
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const resolvedActiveFile = activeFileName === undefined ? activeFile : activeFileName;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
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
  const [folderRenaming, setFolderRenaming] = useState<{ path: string; draft: string; saving: boolean } | null>(null);
  const folderRenameInputRef = useRef<HTMLInputElement>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movePickerSelected, setMovePickerSelected] = useState<string | null>(null);
  const [movePickerExpanded, setMovePickerExpanded] = useState<Set<string>>(() => new Set());
  const [imageExportOpen, setImageExportOpen] = useState(false);
  const [imageExportFormat, setImageExportFormat] = useState<string>('png');
  const [imageExportScale, setImageExportScale] = useState<number>(2);
  const [batchDownloadOpen, setBatchDownloadOpen] = useState(false);
  const [currentDir, setCurrentDir] = useState<string>(() => navState?.currentDir ?? '');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [rootExpanded, setRootExpanded] = useState(true);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treePaneWidth, setTreePaneWidth] = useState(() => readTreePaneWidth(projectId));
  const [resizingTreePane, setResizingTreePane] = useState(false);
  const treePaneResizeRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

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

  const folderTree = useMemo(() => buildFolderTree(files, folders ?? [], folderOrder), [files, folders, folderOrder]);
  const filesByDirectory = useMemo(() => {
    const grouped = new Map<string, ProjectFile[]>();
    for (const file of files) {
      const slash = file.name.lastIndexOf('/');
      const directory = slash === -1 ? '' : file.name.slice(0, slash);
      const entries = grouped.get(directory) ?? [];
      entries.push(file);
      grouped.set(directory, entries);
    }
    for (const entries of grouped.values()) {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    }
    return grouped;
  }, [files]);
  const filesByName = useMemo(() => new Map(files.map((file) => [file.name, file])), [files]);
  // Flat list of every folder (persisted + derived from file paths) for the
  // "Add to folder" picker.
  const folderPaths = useMemo(() => flattenFolderPaths(folderTree), [folderTree]);

  // Reset selection and renaming state when the user navigates into or out of
  // a directory.
  useEffect(() => {
    setSelected(new Set());
    setRenaming(null);
  }, [currentDir]);

  // Auto-trigger rename when autoRenameFile is set (e.g. after creating an artboard).
  // Uses a ref to ensure rename only triggers once — subsequent clicks on the
  // file name will NOT re-enter rename mode.
  const autoRenameConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoRenameFile || !onSetFileAlias) return;
    if (autoRenameConsumedRef.current === autoRenameFile) return;
    const file = files.find((f) => f.name === autoRenameFile);
    if (file) {
      autoRenameConsumedRef.current = autoRenameFile;
      setActiveFile(autoRenameFile);
      onOpenFile(autoRenameFile); // show preview in the center area
      setRenaming({ name: autoRenameFile, draft: displayNameForPath(autoRenameFile, fileAliases), saving: false });
    }
  }, [autoRenameFile, files, onSetFileAlias, fileAliases]);

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
    if (!menuPos && !folderMenuPos && !createMenuOpen && !rootMenuOpen && !batchDownloadOpen) return;
    const close = () => {
      setMenuPos(null);
      setFolderMenuPos(null);
      setRootMenuOpen(false);
      setRootMenuPos(null);
      setBatchDownloadOpen(false);
      setCreateMenuOpen(false);
      setMovePickerOpen(false);
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
  }, [menuPos, folderMenuPos, createMenuOpen, rootMenuOpen, batchDownloadOpen]);

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

  function openRootMenu(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top: number;
    if (spaceBelow >= ROOT_MENU_ESTIMATED_HEIGHT + MENU_SAFE_PADDING) {
      top = rect.bottom + 4;
    } else if (spaceAbove >= ROOT_MENU_ESTIMATED_HEIGHT + MENU_SAFE_PADDING) {
      top = rect.top - ROOT_MENU_ESTIMATED_HEIGHT - 4;
    } else {
      top = Math.max(
        MENU_SAFE_PADDING,
        viewportHeight - ROOT_MENU_ESTIMATED_HEIGHT - MENU_SAFE_PADDING,
      );
    }
    const left = Math.max(MENU_SAFE_PADDING, Math.min(rect.left + 18, window.innerWidth - 172));
    setMenuPos(null);
    setFolderMenuPos(null);
    setRootMenuOpen(true);
    setRootMenuPos({ top, left });
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
    // Seed the editor with the label the row is actually showing (alias if
    // set, otherwise the base name) so renaming an aliased file doesn't
    // discard the alias and flash the real name.
    setRenaming({ name, draft: displayNameForPath(name, fileAliases), saving: false });
  }

  function startRenameFolder(path: string) {
    if (!onRenameFolder || folderAction) return;
    setFolderMenuPos(null);
    setFolderRenaming({ path, draft: basenameForPath(path), saving: false });
  }

  async function commitFolderRename(path: string, draft: string) {
    if (!onRenameFolder) return;
    const trimmedLeaf = draft.trim();
    if (!trimmedLeaf) {
      // Empty names are intercepted, not silently dropped: tell the user and
      // keep them in the editor so the folder is never left nameless.
      window.alert(t('designFiles.folderNameEmpty'));
      requestAnimationFrame(() => folderRenameInputRef.current?.focus());
      return;
    }
    const currentLeaf = basenameForPath(path);
    if (trimmedLeaf === currentLeaf) {
      setFolderRenaming(null);
      return;
    }
    const parent = dirnameForPath(path);
    const nextPath = parent ? `${parent}/${trimmedLeaf}` : trimmedLeaf;
    setFolderRenaming((curr) => (curr ? { ...curr, saving: true } : curr));
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
      setFolderRenaming(null);
    } catch (err) {
      setFolderNotice({ message: err instanceof Error ? err.message : String(err) });
      setFolderRenaming({ path, draft: currentLeaf, saving: false });
      requestAnimationFrame(() => folderRenameInputRef.current?.focus());
    }
  }

  // Default leaf name for "New subfolder", de-duped against the parent's
  // existing direct children (files and folders) so the create never collides.
  function uniqueFolderLeafName(parentPath: string, base: string): string {
    const prefix = parentPath ? `${parentPath}/` : '';
    const taken = new Set<string>();
    const collect = (rest: string) => {
      const slash = rest.indexOf('/');
      const direct = slash === -1 ? rest : rest.slice(0, slash);
      if (direct) taken.add(direct.toLowerCase());
    };
    for (const f of files) {
      if (f.name.startsWith(prefix)) collect(f.name.slice(prefix.length));
    }
    for (const fo of folders ?? []) {
      if (fo.path.startsWith(prefix)) collect(fo.path.slice(prefix.length));
    }
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
  }

  async function startCreateSubfolder(parentPath: string) {
    if (!onCreateFolder || folderAction) return;
    setFolderMenuPos(null);
    const leaf = uniqueFolderLeafName(parentPath, t('designFiles.untitledFolderName'));
    const path = parentPath ? `${parentPath}/${leaf}` : leaf;
    setFolderAction({ kind: 'creating', path });
    setFolderNotice(null);
    try {
      const folder = await onCreateFolder(path);
      if (!folder) throw new Error('Folder could not be created');
      expandFolderPath(parentPath);
      expandFolderPath(folder.path);
      // Drop the freshly created default-named folder straight into inline
      // rename so the user can name it without a second round-trip.
      setFolderRenaming({ path: folder.path, draft: basenameForPath(folder.path), saving: false });
      setFolderNotice({ message: t('designFiles.folderCreated', { name: folder.path }) });
    } catch (err) {
      setFolderNotice({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setFolderAction(null);
    }
  }

  async function commitRename(name: string, draft: string) {
    if (!onSetFileAlias) {
      setRenaming(null);
      return;
    }
    const nextAlias = draft.trim();
    if (!nextAlias) {
      setRenaming(null);
      return;
    }
    // No-op when the typed value matches the label already shown — rename is
    // a display-only alias, so nothing on disk changes either way.
    if (nextAlias === displayNameForPath(name, fileAliases)) {
      setRenaming(null);
      return;
    }
    setRenaming({ name, draft, saving: true });
    try {
      const updated = await onSetFileAlias(name, nextAlias);
      if (!updated) throw new Error('Rename failed');
      // The real path is unchanged (rename only updates the display alias),
      // so active-file / selection keys stay valid — no re-keying needed.
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

  function openContainingFolder(name: string) {
    openFolderPath(dirnameForPath(name));
  }

  async function copyImagePath(name: string) {
    const rawPath = projectFileUrl(projectId, name);
    const path = typeof window === 'undefined'
      ? rawPath
      : new URL(rawPath, window.location.origin).href;
    const copied = await copyToClipboard(path);
    setFolderNotice({
      message: copied ? `${t('designFiles.copiedPath')}: ${path}` : t('designFiles.copyFailed'),
    });
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
    style?: CSSProperties,
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
        style={style}
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
    const hasChildren =
      folderTree.length > 0
      || (filesByDirectory.get('')?.length ?? 0) > 0
      || liveArtifacts.length > 0
      || creatingFolder;
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
        <span
          className="df-tree-folder-icon"
          aria-hidden
          onDoubleClick={(e) => { e.stopPropagation(); if (hasChildren) setRootExpanded((expanded) => !expanded); }}
        >
          <Icon name="folder-filled" size={15} />
        </span>
        <button type="button" className="df-row-name-btn" onClick={() => openFolderPath('')} onDoubleClick={(e) => { e.stopPropagation(); if (hasChildren) setRootExpanded((expanded) => !expanded); }}>
          <span className="df-tree-name" title={rootDirName ?? t('designFiles.crumbs')}>
            {rootDirName ?? t('designFiles.crumbs')}
          </span>
        </button>
      </>,
      () => openFolderPath(''),
      undefined,
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openRootMenu(ev.currentTarget);
      },
      undefined,
      undefined,
    );
  }

  function renderTreeFile(file: ProjectFile, depth: number) {
    const category = fileCategory(file);
    const extBase = basenameForPath(file.name);
    const extDot = extBase.lastIndexOf('.');
    const ext = extDot >= 0 ? extBase.slice(extDot + 1).toLowerCase() : '';
    const active = resolvedActiveFile === file.name;
    const isSelected = selected.has(file.name);
    const renameState = renaming?.name === file.name ? renaming : null;
    const label = displayNameForPath(file.name, fileAliases);
    return (
      <div
        key={`file:${file.name}`}
        data-testid={`design-file-row-${file.name}`}
        className={`df-tree-row df-tree-file-row df-file-row ${active ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
        style={{ '--df-tree-depth': depth } as CSSProperties}
        draggable={!renameState}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const menuButton = event.currentTarget.querySelector<HTMLElement>('.df-row-menu');
          if (menuButton) openMenuFor(file.name, menuButton);
        }}
        onDragStart={(event) => {
          const names = draggedNamesForFile(file.name);
          setDraggedProjectFiles(names);
          setActiveFile(file.name);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(DESIGN_FILE_DRAG_TYPE, JSON.stringify(names));
          event.dataTransfer.setData('text/plain', names.join('\n'));
        }}
        onDragEnd={() => {
          setDraggedProjectFiles([]);
          setFolderDropTarget(null);
        }}
      >
        <span className="df-tree-indent" aria-hidden />
        <span
          className="df-row-check"
          role="checkbox"
          aria-checked={isSelected}
          tabIndex={batchMode ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation();
            if (batchMode) toggleSelect(file.name);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              if (batchMode) toggleSelect(file.name);
            }
          }}
        >
          {isSelected ? '☑' : '☐'}
        </span>
        <span
          className="df-tree-file-icon"
          data-kind={category}
          data-ext={ext}
          aria-hidden
          onClick={() => {
            setActiveFile(file.name);
            onOpenFile(file.name);
          }}
        >
          <Icon name={fileCategoryIconName(category)} size={14} />
        </span>
        {renameState ? (
          <input
            autoFocus
            className="df-rename-input df-tree-rename-input"
            value={renameState.draft}
            disabled={renameState.saving}
            onChange={(event) => setRenaming({ ...renameState, draft: event.target.value })}
            onBlur={() => void commitRename(file.name, renameState.draft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setRenaming(null);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="df-row-name-btn"
            title={file.name}
            onClick={() => {
              setActiveFile(file.name);
              onOpenFile(file.name);
            }}
          >
            <span className="df-tree-name">{label}</span>
          </button>
        )}
        <button
          type="button"
          className="df-row-menu"
          data-testid={`design-file-menu-${file.name}`}
          aria-label={t('designFiles.rowMenu')}
          onClick={(event) => {
            event.stopPropagation();
            openMenuFor(file.name, event.currentTarget);
          }}
        >
          <Icon name="more-horizontal" size={14} />
        </button>
      </div>
    );
  }

  function renderTreeLiveArtifact(artifact: LiveArtifactWorkspaceEntry) {
    return (
      <button
        key={artifact.artifactId}
        type="button"
        data-testid={`design-file-row-${artifact.tabId}`}
        className="df-tree-row df-tree-live-row"
        onClick={() => onOpenLiveArtifact(artifact.tabId)}
      >
        <span className="df-tree-indent" aria-hidden />
        <span className="df-tree-toggle-spacer" aria-hidden />
        <span className="df-tree-file-icon" data-kind="live-artifact" aria-hidden>◉</span>
        <span className="df-tree-live-label">
          <span className="df-tree-name" title={artifact.title}>{artifact.title}</span>
          <LiveArtifactBadges
            compact
            status={artifact.status}
            refreshStatus={artifact.refreshStatus}
          />
        </span>
      </button>
    );
  }

  function renderTreeNode(node: FolderTreeNode, depth = 0): React.ReactNode {
    const directFiles = filesByDirectory.get(node.path) ?? [];
    const hasChildren = node.children.length > 0 || directFiles.length > 0;
    const expanded = expandedFolders.has(node.path) || currentDir.startsWith(`${node.path}/`);
    const deletingThisFolder = folderAction?.kind === 'deleting' && folderAction.path === node.path;
    const renamingThisFolder = folderAction?.kind === 'renaming' && folderAction.path === node.path;
    const isRenamingThisFolder = folderRenaming?.path === node.path;
    const row = renderFolderDropZone(
      node.path,
      [
        'df-tree-row',
        'df-dir-row',
        currentDir === node.path ? 'active' : '',
      ].filter(Boolean).join(' '),
      <>
        <span className="df-tree-indent" aria-hidden />
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
        <span
          className="df-tree-folder-icon"
          aria-hidden
          onDoubleClick={(e) => { e.stopPropagation(); if (hasChildren) toggleFolderExpansion(node.path); }}
        >
          <Icon name={currentDir === node.path ? 'folder-filled' : 'folder'} size={15} />
        </span>
        {isRenamingThisFolder && folderRenaming ? (
          <input
            ref={folderRenameInputRef}
            autoFocus
            className="df-rename-input df-tree-rename-input"
            data-testid="design-folder-rename-input"
            value={folderRenaming.draft}
            disabled={folderRenaming.saving}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setFolderRenaming({ ...folderRenaming, draft: e.target.value })}
            onBlur={() => void commitFolderRename(node.path, folderRenaming.draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setFolderRenaming(null);
              }
            }}
          />
        ) : (
          <button type="button" className="df-row-name-btn" onClick={() => openFolderPath(node.path)} onDoubleClick={(e) => { e.stopPropagation(); if (hasChildren) toggleFolderExpansion(node.path); }}>
            <span className="df-tree-name" title={node.name}>{node.name}</span>
          </button>
        )}
      </>,
      () => openFolderPath(node.path),
      `design-folder-row-${node.path}`,
      (ev) => {
        if (!onCreateFolder && !onRenameFolder && !onDeleteFolder) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (deletingThisFolder || renamingThisFolder) return;
        openFolderMenuFor(node.path, ev.currentTarget);
      },
      { path: node.path, label: node.name },
      { '--df-tree-depth': depth } as CSSProperties,
    );
    return (
      <div key={`dir:${node.path}`} className="df-tree-node">
        {row}
        {expanded && hasChildren ? (
          <div className="df-tree-children">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
            {directFiles.map((file) => renderTreeFile(file, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  function toggleMovePickerExpansion(path: string) {
    setMovePickerExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); } else { next.add(path); }
      return next;
    });
  }

  function renderMovePickerNode(node: FolderTreeNode, depth: number): React.ReactNode {
    const isSelected = movePickerSelected === node.path;
    const expanded = movePickerExpanded.has(node.path);
    const hasChildren = node.children.length > 0;
    return (
      <div key={`move:${node.path}`}>
        <div
          className={`df-move-tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <button
            type="button"
            className="df-tree-toggle"
            disabled={!hasChildren}
            aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
            onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleMovePickerExpansion(node.path); }}
          >
            {hasChildren ? (
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
            ) : null}
          </button>
          <button
            type="button"
            className="df-move-tree-node-btn"
            data-testid={`design-move-target-${node.path}`}
            onClick={() => setMovePickerSelected(node.path)}
          >
            <span className="df-tree-folder-icon" aria-hidden>
              <Icon name={isSelected ? 'folder-filled' : 'folder'} size={15} />
            </span>
            <span className="df-tree-name" title={node.name}>{node.name}</span>
          </button>
        </div>
        {expanded && hasChildren ? (
          <div>
            {node.children.map((child) => renderMovePickerNode(child, depth + 1))}
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
      // Scan HTML files for referenced assets (CSS, JS, images, fonts)
      // and include them in the archive so the downloaded ZIP is self-contained.
      const allFiles = new Set(fileList);
      for (const name of fileList) {
        if (!/\.html?$/i.test(name)) continue;
        try {
          const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(name)}/raw`);
          if (!resp.ok) continue;
          const html = await resp.text();
          const dir = name.lastIndexOf('/') >= 0 ? name.slice(0, name.lastIndexOf('/') + 1) : '';
          // Extract href/src/url() references
          const refs = new Set<string>();
          const re = /(?:href|src)="([^"]+)"|url\(["']?([^"')]+)["']?\)/gi;
          let m;
          while ((m = re.exec(html)) !== null) {
            const ref = (m[1] || m[2] || '').trim();
            if (!ref || ref.startsWith('data:') || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('#') || ref.startsWith('mailto:')) continue;
            // Resolve relative path
            const resolved = dir ? `${dir}${ref}`.replace(/\/[^/]+\/\.\.\//g, '/') : ref;
            if (resolved.includes('..')) continue; // skip paths that escape the project
            refs.add(resolved);
          }
          for (const ref of refs) {
            // Only include files that actually exist in the project
            if (files.some((f) => f.name === ref)) allFiles.add(ref);
          }
        } catch { /* ignore parse errors */ }
      }
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [...allFiles] }),
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

  async function handleBatchPdf() {
    const fileList = [...selected];
    if (fileList.length === 0) return;
    try {
      const htmlFiles = fileList.filter((f) => /\.html?$/i.test(f));
      if (htmlFiles.length === 0) {
        alert('No HTML files selected for PDF export');
        return;
      }
      const { exportAsPdf } = await import('../runtime/exports');
      const { projectRawUrl } = await import('../providers/registry');
      for (const name of htmlFiles) {
        const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(name)}/raw`);
        if (!resp.ok) continue;
        const html = await resp.text();
        const baseName = name.replace(/\.[^.]+$/, '');
        // Compute baseHref for asset resolution (same as DownloadButton)
        const slashIdx = name.lastIndexOf('/');
        const baseDir = slashIdx >= 0 ? name.slice(0, slashIdx + 1) : '';
        const baseHref = projectRawUrl(projectId, baseDir);
        // Delay between exports to avoid browser popup blocking
        await exportAsPdf(html, baseName, baseHref ? { baseHref } : undefined);
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      console.warn('[batchPdf] failed:', err);
    }
  }

  async function handleBatchImages() {
    const fileList = [...selected];
    if (fileList.length === 0) return;
    const htmlFiles = fileList.filter((f) => /\.html?$/i.test(f));
    if (htmlFiles.length === 0) {
      alert(t('designFiles.noHtmlForImage') || 'No HTML files selected for image export');
      return;
    }
    setImageExportOpen(true);
  }

  async function executeImageExport() {
    setImageExportOpen(false);
    const fileList = [...selected];
    const htmlFiles = fileList.filter((f) => /\.html?$/i.test(f));
    if (htmlFiles.length === 0) return;
    const format = imageExportFormat as 'png' | 'jpg' | 'webp' | 'svg';
    const scale = imageExportScale;
    try {
      const { captureHtmlSnapshot, captureHtmlSvg, scaleAndEncodeSnapshot } = await import('../runtime/exports');
      const { projectRawUrl } = await import('../providers/registry');
      for (const name of htmlFiles) {
        const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(name)}/raw`);
        if (!resp.ok) continue;
        const html = await resp.text();
        const baseName = name.replace(/\.[^.]+$/, '');
        const slashIdx = name.lastIndexOf('/');
        const baseDir = slashIdx >= 0 ? name.slice(0, slashIdx + 1) : '';
        const baseHref = projectRawUrl(projectId, baseDir) || undefined;
        if (format === 'svg') {
          const svgResult = await captureHtmlSvg(html, baseHref ? { baseHref } : undefined);
          if (svgResult) {
            const blob = new Blob([svgResult.svg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseName}.svg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          }
        } else {
          const snapshot = await captureHtmlSnapshot(html, baseHref ? { baseHref } : undefined);
          if (snapshot && snapshot.dataUrl) {
            const fmt = format === 'jpg' ? 'jpeg' as const : format === 'webp' ? 'webp' as const : 'png' as const;
            const blob = await scaleAndEncodeSnapshot(snapshot.dataUrl, { scale, format: fmt });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ext = format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : format;
            a.download = `${baseName}@${scale}x.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.warn('[batchImages] failed:', err);
    }
  }

  async function handleDrop(ev: ReactDragEvent<HTMLElement>) {
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

  const visibleUploadError = uploadError ?? dropReadError;
  const hasSelection = selected.size > 0;

  useEffect(() => {
    if (!resizingTreePane) return;
    document.body.classList.add('od-pane-resizing');
    function onPointerMove(event: PointerEvent) {
      event.preventDefault();
      const ref = treePaneResizeRef.current;
      if (!ref) return;
      const delta = event.clientX - ref.startX;
      const nextWidth = normalizeTreePaneWidth(ref.startWidth + delta);
      setTreePaneWidth(nextWidth);
    }
    function onPointerUp() {
      document.body.classList.remove('od-pane-resizing');
      setResizingTreePane(false);
      treePaneResizeRef.current = null;
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onPointerUp);
    return () => {
      document.body.classList.remove('od-pane-resizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
    };
  }, [resizingTreePane]);

  useEffect(() => {
    writeTreePaneWidth(projectId, treePaneWidth);
  }, [projectId, treePaneWidth]);

  return (
    <div className={`df-panel no-preview ${batchMode ? 'df-panel--batch' : ''} ${hasSelection ? 'has-selection' : ''} ${draggedFolderPath ? 'is-folder-dragging' : ''}`}>
      {reloading ? (
        <div className="df-reloading-overlay" data-testid="design-files-reloading">
          <span className="loading-spinner">
            <Icon name="spinner" size={16} />
            <span className="loading-spinner-label">{t('common.loading')}</span>
          </span>
        </div>
      ) : null}
      <div className="df-main">
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
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setBatchDownloadOpen((v) => !v)}
                    title={t('designFiles.download')}
                  >
                    <Icon name="download" size={13} />
                    <span>{t('designFiles.download')}</span>
                  </button>
                  {batchDownloadOpen ? (
                    <div
                      data-testid="design-batch-download-menu"
                      className="df-row-popover"
                      style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 200, minWidth: 160 }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button type="button"
                        onClick={() => { setBatchDownloadOpen(false); void handleBatchDownload(); }}>
                        <Icon name="download" size={14} />
                        <span style={{ marginLeft: 6 }}>{t('designFiles.exportZip')}</span>
                      </button>
                      <button type="button"
                        onClick={() => { setBatchDownloadOpen(false); void handleBatchPdf(); }}>
                        <Icon name="file" size={14} />
                        <span style={{ marginLeft: 6 }}>{t('designFiles.exportPdf')}</span>
                      </button>
                      <button type="button"
                        onClick={() => { setBatchDownloadOpen(false); void handleBatchImages(); }}>
                        <Icon name="image" size={14} />
                        <span style={{ marginLeft: 6 }}>{t('designFiles.exportImages')}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                {onMoveFiles ? (
                  <button
                    type="button"
                    data-testid="design-files-add-to-folder"
                    title={t('designFiles.addToFolder')}
                    onClick={() => {
                      setMovePickerSelected(null);
                      setMovePickerExpanded(new Set());
                      setMovePickerOpen((v) => !v);
                    }}
                  >
                    <Icon name="folder" size={13} />
                    <span>{t('designFiles.addToFolder')}</span>
                  </button>
                ) : null}
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
                <button type="button" className="df-batch-clear" onClick={() => { clearSelection(); setBatchMode(false); }}>
                  {t('designFiles.clearSelection')}
                </button>
              </div>
            </div>
          ) : null}
          <div
            className={[
              'df-browser',
              treeCollapsed ? 'df-browser--tree-collapsed' : '',
              sideTreeOnly ? 'df-browser--tree-only' : '',
            ].filter(Boolean).join(' ')}
            style={{
              '--df-tree-pane-width': treeCollapsed
                ? '0px'
                : sideTreeOnly
                  ? '100%'
                  : `${treePaneWidth}px`,
              '--df-tree-overlay-width': `${treePaneWidth}px`,
            } as CSSProperties}
          >
            <aside className="df-tree-pane" aria-label={t('designFiles.sectionFolders')}>
              <div className="df-tree-head">
                <div className="df-tree-head-main">
                  <div className="df-sidebar-chrome">
                    <button
                      type="button"
                      className="df-sidebar-chrome-btn df-sidebar-collapse-toggle"
                      aria-label={treeCollapsed ? '显示文件树' : '收起文件树'}
                      title={treeCollapsed ? '显示文件树' : '收起文件树'}
                      aria-pressed={treeCollapsed}
                      onClick={(event) => {
                        setTreeCollapsed((value) => !value);
                      }}
                    >
                      <Icon name="panel-left" size={15} />
                    </button>
                    {onBack ? (
                      <button
                        type="button"
                        className="df-sidebar-chrome-btn df-sidebar-back"
                        data-testid="workspace-project-back"
                        aria-label={backLabel ?? 'Back'}
                        title={backLabel ?? 'Back'}
                        onClick={onBack}
                      >
                        <Icon name="arrow-left" size={15} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="df-tree-toolbar">
                <button
                  type="button"
                  className="df-tree-toolbar-path"
                  title={currentDir || (rootDirName ?? t('designFiles.crumbs'))}
                  onClick={() => openFolderPath(currentDir)}
                >
                  <Icon name="folder" size={14} />
                  <span>{currentDir || (rootDirName ?? t('designFiles.crumbs'))}</span>
                </button>
                <div className="df-tree-create-menu-wrap">
                  {(() => {
                    // Single toggle: collapses every folder when the tree is
                    // fully expanded, otherwise expands every folder. Activated
                    // state reads as "tree is fully expanded" so the chip looks
                    // pressed while everything is open.
                    const allExpanded =
                      folderPaths.length > 0 &&
                      rootExpanded &&
                      folderPaths.every((p) => expandedFolders.has(p));
                    return (
                      <button
                        type="button"
                        className={`df-tree-action df-tree-expand-toggle${allExpanded ? ' is-active' : ''}`}
                        data-testid="design-files-expand-toggle"
                        aria-label={allExpanded ? t('designFiles.collapseAll') : t('designFiles.expandAll')}
                        aria-pressed={allExpanded}
                        data-tooltip={allExpanded ? t('designFiles.collapseAll') : t('designFiles.expandAll')}
                        data-tooltip-placement="bottom"
                        disabled={folderPaths.length === 0}
                        onClick={() => {
                          if (allExpanded) {
                            setExpandedFolders(new Set());
                            setRootExpanded(false);
                          } else {
                            setExpandedFolders(new Set(folderPaths));
                            setRootExpanded(true);
                          }
                        }}
                      >
                        <Icon name={allExpanded ? 'chevron-down' : 'chevron-right'} size={13} />
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    className={`df-tree-batch-toggle${batchMode ? ' is-active' : ''}`}
                    aria-label={t('designFiles.batchSelect')}
                    data-tooltip={t('designFiles.batchSelect')}
                    data-tooltip-placement="bottom"
                    onClick={() => {
                      const next = !batchMode;
                      setBatchMode(next);
                      if (!next) clearSelection();
                    }}
                  >
                    <Icon name="check" size={13} />
                  </button>
                  <button
                    type="button"
                    className="df-tree-add"
                    data-testid="design-files-create-menu-trigger"
                    aria-label={t('common.create')}
                    aria-haspopup="menu"
                    aria-expanded={createMenuOpen}
                    data-tooltip={t('common.create')}
                    data-tooltip-placement="bottom"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setCreateMenuOpen((open) => !open);
                    }}
                  >
                    <Icon name="more-horizontal" size={14} />
                  </button>
                  {createMenuOpen ? (
                    <div
                      className="df-create-menu"
                      role="menu"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!onCreateFolder}
                        onClick={() => {
                          setCreateMenuOpen(false);
                          startCreateFolder();
                        }}
                      >
                        <Icon name="folder" size={14} />
                        <span>{t('designFiles.newFolderTitle')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="design-files-upload-trigger"
                        onClick={() => {
                          setCreateMenuOpen(false);
                          onUpload();
                        }}
                      >
                        <Icon name="upload" size={14} />
                        <span>{t('designFiles.upload.label')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setCreateMenuOpen(false);
                          onNewSketch();
                        }}
                      >
                        <Icon name="pencil" size={14} />
                        <span>{t('designFiles.newSketch')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setCreateMenuOpen(false);
                          onNewArtboard?.();
                        }}
                      >
                        <Icon name="plus-filled" size={14} />
                        <span>{t('designFiles.newArtboard')}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setCreateMenuOpen(false);
                          onPaste();
                        }}
                      >
                        <Icon name="copy" size={14} />
                        <span>{t('designFiles.paste.label')}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
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
                    {folderTree.map((node) => renderTreeNode(node, 1))}
                    {(filesByDirectory.get('') ?? []).map((file) => renderTreeFile(file, 1))}
                    {liveArtifacts.map(renderTreeLiveArtifact)}
                  </>
                ) : null}
              </div>
              {sidebarFooter ? (
                <div className="df-tree-footer">{sidebarFooter}</div>
              ) : null}
            </aside>
            {treeCollapsed ? (
              <div className="df-tree-hover-trigger" aria-hidden />
            ) : null}
            {!treeCollapsed && !sideTreeOnly ? (
            <div
              className={`df-tree-resize-handle${resizingTreePane ? ' is-resizing' : ''}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                treePaneResizeRef.current = {
                  startX: event.clientX,
                  startWidth: treePaneWidth,
                };
                document.body.classList.add('od-pane-resizing');
                setResizingTreePane(true);
              }}
            />
            ) : null}
            {!sideTreeOnly ? (
            <section
              className={`df-content-pane ${draggingFiles ? 'dragging' : ''}`}
              onDragEnter={(event) => {
                if (!dataTransferHasFiles(event.dataTransfer)) return;
                event.preventDefault();
                dragDepthRef.current += 1;
                setDraggingFiles(true);
              }}
              onDragOver={(event) => {
                if (!dataTransferHasFiles(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  dragDepthRef.current = 0;
                  setDraggingFiles(false);
                  return;
                }
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDraggingFiles(false);
              }}
              onDrop={handleDrop}
            >
              {treeCollapsed ? (
                <button
                  type="button"
                  className="df-content-tree-toggle od-tooltip"
                  data-tooltip="显示文件树"
                  data-tooltip-placement="bottom"
                  aria-label="显示文件树"
                  aria-pressed="true"
                  title="显示文件树"
                  onClick={(event) => {
                    event.currentTarget.blur();
                    setTreeCollapsed(false);
                  }}
                >
                  <Icon name="panel-left" size={15} />
                </button>
              ) : null}
              {headerContent ? headerContent : null}
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
                            <span className="df-row-sub">{folder.fileCount} files</span>
                          </span>
                        </button>
                        {onPluginFolderAgentAction ? (
                          <div className="df-plugin-actions">
                            <button
                              type="button"
                              className="df-plugin-install"
                              data-testid={`design-plugin-folder-install-${folder.path}`}
                              disabled={actionBusy || installingFolder !== null || sharingFolder !== null}
                              onClick={() => void handlePluginFolderAgentAction(folder.path, 'install')}
                            >
                              {installingFolder === folder.path ? 'Sending…' : 'Add to My plugins'}
                            </button>
                            <button
                              type="button"
                              className="df-plugin-install"
                              data-testid={`design-plugin-folder-publish-${folder.path}`}
                              disabled={actionBusy || installingFolder !== null || sharingFolder !== null}
                              onClick={() => void handlePluginFolderAgentAction(folder.path, 'publish')}
                            >
                              {sharingFolder === `publish:${folder.path}` ? 'Sending…' : 'Publish repo'}
                            </button>
                            <button
                              type="button"
                              className="df-plugin-install"
                              data-testid={`design-plugin-folder-contribute-${folder.path}`}
                              disabled={actionBusy || installingFolder !== null || sharingFolder !== null}
                              onClick={() => void handlePluginFolderAgentAction(folder.path, 'contribute')}
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
              {previewContent != null ? (
                <div className="df-inline-preview" data-testid="design-files-inline-preview">
                  {previewContent}
                </div>
              ) : (
                <div className="df-empty" data-testid="design-files-empty">
                  <div className="df-empty-pill">
                    <span className="df-empty-title">
                      {t('designFiles.empty')}
                    </span>
                    <button
                      type="button"
                      className="df-empty-cta"
                      data-testid="design-files-empty-new-sketch"
                      onClick={onNewArtboard ?? onNewSketch}
                      title={t('designFiles.newArtboard')}
                    >
                      <Icon name="pencil" size={13} />
                      <span>{t('designFiles.newArtboard')}</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
            ) : null}
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
          {onCopyFile ? (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                const name = menuPos.name;
                setMenuPos(null);
                setFolderNotice(null);
                try {
                  const copied = await onCopyFile(name);
                  if (copied) {
                    setFolderNotice({ message: `${t('fileViewer.copied')}: ${copied.name}` });
                  }
                } catch (err) {
                  const raw = err instanceof Error ? err.message : String(err);
                  // Surface backend origin/CSRF rejections and other low-level
                  // failures as a friendly, localized message instead of the
                  // raw "Cross-origin requests are not allowed" string. The
                  // underlying cause is almost always an environment port
                  // mismatch (web port vs daemon port), not a user error.
                  const friendly =
                    /cross-origin|failed to fetch|networkerror/i.test(raw)
                      ? t('designFiles.copyFailed')
                      : raw;
                  setFolderNotice({ message: friendly });
                }
              }}
            >
              {t('fileViewer.copy')}
            </button>
          ) : null}
          {onSetFileAlias ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startRename(menuPos.name);
              }}
            >
              {t('common.rename')}
            </button>
          ) : null}
          {filesByName.get(menuPos.name)?.kind === 'image' ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const name = menuPos.name;
                setMenuPos(null);
                void copyImagePath(name);
              }}
            >
              {t('designFiles.copyPath')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const name = menuPos.name;
              setMenuPos(null);
              openContainingFolder(name);
            }}
          >
            Open folder
          </button>
          {onNewArtboard ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuPos(null);
                onNewArtboard();
              }}
            >
              {t('designFiles.newArtboard')}
            </button>
          ) : null}
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
          {onCreateFolder ? (
            <button
              type="button"
              data-testid={`design-folder-new-subfolder-${folderMenuPos.path}`}
              onClick={(e) => {
                e.stopPropagation();
                void startCreateSubfolder(folderMenuPos.path);
              }}
            >
              {t('designFiles.newSubfolder')}
            </button>
          ) : null}
          {onNewArtboard ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFolderMenuPos(null);
                onNewArtboard();
              }}
            >
              {t('designFiles.newArtboard')}
            </button>
          ) : null}
          {onRenameFolder ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startRenameFolder(folderMenuPos.path);
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
      {rootMenuOpen && rootMenuPos ? (
        <div
          data-testid="design-root-menu-popover"
          className="df-row-popover"
          style={{ top: rootMenuPos.top, left: rootMenuPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {onCreateFolder ? (
            <button
              type="button"
              data-testid="design-root-new-subfolder"
              onClick={(e) => {
                e.stopPropagation();
                setRootMenuOpen(false);
                setRootMenuPos(null);
                void startCreateSubfolder('');
              }}
            >
              {t('designFiles.newSubfolder')}
            </button>
          ) : null}
          {onNewArtboard ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRootMenuOpen(false);
                setRootMenuPos(null);
                onNewArtboard();
              }}
            >
              {t('designFiles.newArtboard')}
            </button>
          ) : null}
        </div>
      ) : null}
      {movePickerOpen && hasSelection ? (
        <div
          data-testid="design-move-picker"
          className="df-move-dialog-overlay"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="df-move-dialog" role="dialog" aria-label={t('designFiles.addToFolder')}>
            <div className="df-move-dialog-header">
              <span className="df-move-dialog-title">{t('designFiles.selectFolder')}</span>
              <button
                type="button"
                className="df-move-dialog-close"
                onClick={() => { setMovePickerOpen(false); setMovePickerSelected(null); }}
                aria-label={t('common.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="df-move-dialog-tree">
              {/* Root option */}
              <button
                type="button"
                className={`df-move-tree-row ${movePickerSelected === '' ? 'selected' : ''}`}
                onClick={() => setMovePickerSelected('')}
                data-testid="design-move-target-"
              >
                <span className="df-tree-folder-icon" aria-hidden>
                  <Icon name="folder-filled" size={15} />
                </span>
                <span className="df-tree-name">{rootDirName ?? t('designFiles.crumbs')}</span>
              </button>
              {folderTree.map((node) => renderMovePickerNode(node, 1))}
            </div>
            <div className="df-move-dialog-footer">
              <button
                type="button"
                className="df-move-dialog-btn-cancel"
                onClick={() => { setMovePickerOpen(false); setMovePickerSelected(null); }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="df-move-dialog-btn-confirm"
                disabled={movePickerSelected === null}
                data-testid="design-move-confirm"
                onClick={() => {
                  if (movePickerSelected === null) return;
                  setMovePickerOpen(false);
                  void moveFilesToFolder([...selected], movePickerSelected);
                  setMovePickerSelected(null);
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {imageExportOpen ? (
        <div
          className="df-move-dialog-overlay"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setImageExportOpen(false); }}
        >
          <div
            className="df-move-dialog"
            role="dialog"
            aria-label={t('designFiles.imageFormatTitle')}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 360 }}
          >
            <div className="df-move-dialog-header">
              <span className="df-move-dialog-title">{t('designFiles.imageFormatTitle')}</span>
              <button
                type="button"
                className="df-move-dialog-close"
                onClick={() => setImageExportOpen(false)}
                aria-label={t('common.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="df-move-dialog-body" style={{ padding: '16px 20px' }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
                  {t('designFiles.imageFormat')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['png', 'jpg', 'webp', 'svg'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className={imageExportFormat === fmt ? 'df-batch-toggle is-active' : 'df-batch-toggle'}
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={() => setImageExportFormat(fmt)}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
                  {t('designFiles.imageScale')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[1, 2, 3, 4].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={imageExportScale === s ? 'df-batch-toggle is-active' : 'df-batch-toggle'}
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={() => setImageExportScale(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="df-move-dialog-footer">
              <button
                type="button"
                className="df-move-dialog-btn-cancel"
                onClick={() => setImageExportOpen(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="df-move-dialog-btn-confirm"
                onClick={() => void executeImageExport()}
              >
                {t('designFiles.exportBtn')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fileCategoryIconName(category: FileCategory): IconName {
  switch (category) {
    case 'html': return 'file-code';
    case 'image': return 'image';
    case 'video': return 'play';
    case 'audio': return 'volume';
    case 'sketch': return 'draw';
    case 'code': return 'file-code';
    case 'stylesheet': return 'file-code';
    case 'pdf': return 'file';
    case 'text': return 'file';
    default: return 'file';
  }
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

function flattenFolderPaths(nodes: FolderTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: FolderTreeNode[]) => {
    for (const node of list) {
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
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

const TREE_PANE_WIDTH_STORAGE_PREFIX = 'open-design:design-files-tree-pane-width:v1:';
const DEFAULT_TREE_PANE_WIDTH = 280;

function normalizeTreePaneWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_TREE_PANE_WIDTH;
  return Math.max(0, Math.round(width));
}

function readTreePaneWidth(projectId: string): number {
  if (typeof window === 'undefined') return DEFAULT_TREE_PANE_WIDTH;
  try {
    const raw = window.localStorage.getItem(`${TREE_PANE_WIDTH_STORAGE_PREFIX}${projectId}`);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? normalizeTreePaneWidth(parsed) : DEFAULT_TREE_PANE_WIDTH;
  } catch {
    return DEFAULT_TREE_PANE_WIDTH;
  }
}

function writeTreePaneWidth(projectId: string, width: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${TREE_PANE_WIDTH_STORAGE_PREFIX}${projectId}`,
      String(normalizeTreePaneWidth(width)),
    );
  } catch {
    /* localStorage may be disabled */
  }
}
