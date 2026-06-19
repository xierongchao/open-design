import type { ProjectFileChangeEvent } from '../providers/project-events';

export const LOCAL_FILE_REFRESH_SUPPRESSION_MS = 1_500;

export type FileWorkspaceRefreshRequest = {
  source?: 'local-save';
  fileName?: string;
  reason?: string;
};

export type LocalFileSaveMarker = {
  at: number;
  fileName?: string;
  reason?: string;
};

export function shouldRefreshWorkspaceAfterFileWorkspaceRequest(
  request?: FileWorkspaceRefreshRequest,
): boolean {
  return request?.source !== 'local-save';
}

export function shouldSuppressFileRefreshAfterLocalSave({
  local,
  events,
  now,
  windowMs = LOCAL_FILE_REFRESH_SUPPRESSION_MS,
}: {
  local: LocalFileSaveMarker | null;
  events: ProjectFileChangeEvent[];
  now: number;
  windowMs?: number;
}): boolean {
  if (!local) return false;
  if (now - local.at > windowMs) return false;
  if (events.length === 0) return true;
  if (!local.fileName) return false;

  const localPath = normalizeProjectPath(local.fileName);
  if (!localPath) return false;
  return events.every((event) => isLocalSaveEchoPath(localPath, event.path));
}

function normalizeProjectPath(path: string | undefined): string {
  if (!path) return '';
  const trimmed = path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function isSameProjectPath(localPath: string, eventPath: string): boolean {
  const normalizedEventPath = normalizeProjectPath(eventPath);
  if (!normalizedEventPath) return false;
  if (normalizedEventPath === localPath) return true;
  return normalizedEventPath.endsWith(`/${localPath}`) || localPath.endsWith(`/${normalizedEventPath}`);
}

function isLocalSaveEchoPath(localPath: string, eventPath: string): boolean {
  if (isSameProjectPath(localPath, eventPath)) return true;
  if (!localPath.toLowerCase().endsWith('.html')) return false;
  return isSameProjectPath(`${localPath}.artifact.json`, eventPath);
}
