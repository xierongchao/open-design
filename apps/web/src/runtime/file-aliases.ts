// Per-project display aliases for project files. An alias is a purely
// cosmetic label — the real on-disk path never changes, so HTML/asset
// references inside the file keep resolving. The file tree and workspace
// tabs render the alias when one is set, falling back to the file's base
// name otherwise.
//
// Aliases live in a project-side `.open-design/aliases.json` so they travel
// with the project folder: when the folder is shared or synced to the cloud,
// every collaborator sees the same aliases. Reached through dedicated
// `/api/projects/:id/aliases` routes — NOT the generic file endpoints, whose
// name sanitizer strips the leading dot from `.open-design` and would split
// write and read across two paths. External CLIs can still read the file via
// `od files read <id> .open-design/aliases.json`.
//
// The value is a union for backward compatibility: a bare string (legacy,
// display name only) or an object `{ name?, viewport? }` (newer). Sanitizers
// below accept both shapes so old `.open-design/aliases.json` files keep
// working without a migration step.

import type { ProjectFileAliasMap, ProjectFileAliasValue } from '@open-design/contracts';

export type FileAliasMap = ProjectFileAliasMap;
export type FileAliasValue = ProjectFileAliasValue;

// Load the alias map for a project. The daemon returns `{ aliases }`; a
// missing file (fresh project) resolves server-side to an empty map, so a
// non-OK response here is treated as empty rather than fatal.
export async function fetchFileAliases(projectId: string): Promise<FileAliasMap> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/aliases`);
    if (!resp.ok) return {};
    const data = (await resp.json()) as { aliases?: unknown };
    return sanitizeAliasMap(data.aliases);
  } catch {
    return {};
  }
}

// Persist the alias map. Aliases are cosmetic and regenerable, so a failed
// write must never break the workspace — network errors are swallowed.
export async function saveFileAliases(projectId: string, aliases: FileAliasMap): Promise<void> {
  try {
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/aliases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases }),
    });
  } catch {
    // Ignore — aliases are cosmetic; the next successful write re-syncs.
  }
}

function sanitizeAliasMap(value: unknown): FileAliasMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: FileAliasMap = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string') continue;
    // Legacy bare-string value (display name only).
    if (typeof val === 'string') { result[key] = val; continue; }
    // Newer object value { name?, viewport? } — keep only valid fields.
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      const obj: FileAliasValue = {};
      if (typeof v.name === 'string') obj.name = v.name;
      if (v.viewport === 'desktop' || v.viewport === 'tablet' || v.viewport === 'mobile') {
        obj.viewport = v.viewport;
      }
      if (obj.name !== undefined || obj.viewport !== undefined) result[key] = obj;
    }
  }
  return result;
}

/** Resolve a value (string | object) to its display name, if any. */
function aliasNameOf(value: string | FileAliasValue | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  const name = value.name?.trim();
  return name || undefined;
}

/** Resolve a value's viewport preset, if any (object shape only). */
export function aliasViewportOf(
  value: string | FileAliasValue | undefined,
): 'desktop' | 'tablet' | 'mobile' | undefined {
  if (value == null || typeof value === 'string') return undefined;
  return value.viewport;
}

// Display label for a file path: the alias when one is set, otherwise the
// path's base name (never the full folder path). Used by both the file
// tree and the workspace tab bar.
export function displayNameForPath(name: string, aliases: FileAliasMap | undefined): string {
  const alias = aliases ? aliasNameOf(aliases[name]) : undefined;
  if (alias) return alias;
  const slash = name.lastIndexOf('/');
  return slash === -1 ? name : name.slice(slash + 1);
}
