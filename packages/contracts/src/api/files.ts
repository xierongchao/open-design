import type { OkResponse } from '../common.js';
import type { ArtifactKind, ArtifactManifest } from './artifacts.js';

export type ProjectFileKind =
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'text'
  | 'code'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'binary';

// Surfaced when the daemon's stub-guard runs in `warn` mode and detects a
// likely regression (the agent emitted a placeholder body that is much
// smaller than a prior artifact sharing the same `metadata.identifier`).
// In `reject` mode the daemon returns `422 ARTIFACT_REGRESSION` instead and
// no `ProjectFile` is produced.
export interface ProjectFileStubGuardWarning {
  code: 'ARTIFACT_REGRESSION';
  message: string;
  identifier: string;
  newSize: number;
  priorSize: number;
  priorName: string;
}

export interface ProjectFile {
  name: string;
  path?: string;
  type?: 'file' | 'dir';
  size: number;
  mtime: number;
  kind: ProjectFileKind;
  mime: string;
  artifactKind?: ArtifactKind;
  artifactManifest?: ArtifactManifest;
  stubGuardWarning?: ProjectFileStubGuardWarning;
}

export interface ProjectFolder {
  name: string;
  path: string;
  type: 'dir';
  size: 0;
  mtime: number;
}

export interface ProjectFilesResponse {
  files: ProjectFile[];
}

export interface ProjectFoldersResponse {
  folders: ProjectFolder[];
}

export type ProjectExportManifestFileRole =
  | 'entry'
  | 'artifact'
  | 'supporting'
  | 'asset'
  | 'source'
  | 'other';

export interface ProjectExportManifestFile extends ProjectFile {
  included: boolean;
  role: ProjectExportManifestFileRole;
  reasons: string[];
}

export interface ProjectExportManifestArtifact {
  file: string;
  title: string;
  kind: ArtifactKind | null;
  renderer: string | null;
  status: string | null;
  exports: string[];
  supportingFiles: string[];
  updatedAt: string | null;
}

export const PROJECT_EXPORT_MANIFEST_SCHEMA = 'open-design.project-export-manifest.v1' as const;

export interface ProjectExportManifestResponse {
  schema: typeof PROJECT_EXPORT_MANIFEST_SCHEMA;
  projectId: string;
  projectName: string | null;
  generatedAt: string;
  entryFile: string | null;
  files: ProjectExportManifestFile[];
  artifacts: ProjectExportManifestArtifact[];
}

export interface ProjectPreviewUrlResponse {
  url: string;
  file: string;
  csp: string;
  iframeSandbox: string;
  opaqueOrigin: true;
}

export interface ProjectFileResponse {
  file: ProjectFile;
}

export interface ProjectFolderResponse {
  folder: ProjectFolder;
}

export interface UploadProjectFilesResponse extends ProjectFilesResponse {}

export interface DeleteProjectFileResponse extends OkResponse {}

export interface DeleteProjectFolderResponse extends OkResponse {}

export interface CopyProjectFileRequest {
  name: string;
}

export interface CopyProjectFileResponse {
  file: ProjectFile;
  sourceName: string;
  newName: string;
}

export interface RenameProjectFolderRequest {
  from: string;
  to: string;
}

export interface RenameProjectFolderResponse {
  folder: ProjectFolder;
  oldName: string;
  newName: string;
}

export interface RenameProjectFileRequest {
  from: string;
  to: string;
}

export interface RenameProjectFileResponse {
  file: ProjectFile;
  oldName: string;
  newName: string;
}

export function buildProjectRawFileUrl(
  baseUrl: string,
  projectId: string,
  filePath: unknown,
): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const segments = filePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  if (segments.length === 0) return null;

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return `${normalizedBaseUrl}/api/projects/${encodeURIComponent(projectId)}/raw/${segments}`;
}

// Per-project display aliases: real on-disk path -> cosmetic label. Renaming
// a file in the Design Files tree sets an alias instead of changing the real
// path, so HTML/asset references keep resolving. Stored in the project-side
// `.open-design/aliases.json` so the map travels with the project folder
// (cloud share / multi-user); read/written through dedicated routes because
// the generic file-write endpoint cannot target the dot-prefixed metadata dir.
//
// The value is a union for backward compatibility: legacy data stores a bare
// string (the display name only); newer data stores an object carrying the
// display name plus the last-used canvas viewport preset (desktop/tablet/mobile).
// Readers must handle both shapes; see file-aliases.ts / projects.ts sanitizers.
export type ProjectFileViewportPreset = 'desktop' | 'tablet' | 'mobile';

export interface ProjectFileAliasValue {
  /** Cosmetic display label (the rename target). */
  name?: string;
  /** Last-used canvas viewport preset for this file. */
  viewport?: ProjectFileViewportPreset;
}

export type ProjectFileAliasMap = Record<string, string | ProjectFileAliasValue>;

export interface ProjectFileAliasesResponse {
  aliases: ProjectFileAliasMap;
}

export interface UpdateProjectFileAliasesRequest {
  aliases: ProjectFileAliasMap;
}
