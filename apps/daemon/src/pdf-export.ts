import path from 'node:path';

import type { DesktopExportPdfInput } from '@open-design/sidecar-proto';

import { inlineRelativeAssets, type InlineAssetReader } from './inline-assets.js';
import { readProjectFile, resolveProjectFilePath } from './projects.js';

export interface BuildDesktopPdfExportInputOptions {
  daemonUrl: string;
  deck?: boolean;
  fileName: string;
  metadata?: unknown;
  projectId: string;
  projectsRoot: string;
  title?: string;
}

export async function buildDesktopPdfExportInput(
  options: BuildDesktopPdfExportInputOptions,
): Promise<DesktopExportPdfInput> {
  const file = await readProjectFile(options.projectsRoot, options.projectId, options.fileName, options.metadata);
  const title = displayTitle(options.title, options.fileName);
  const rawHtml = file.buffer.toString('utf8');
  const ownerFileName = file.name || options.fileName;
  const html = await inlineProjectAssetsForPdf(rawHtml, ownerFileName, options);
  return {
    baseHref: rawBaseHref(options.daemonUrl, options.projectId, ownerFileName),
    deck: options.deck === true,
    defaultFilename: `${safeFilename(title, 'artifact')}.pdf`,
    html,
    sourceUrl: rawFileUrl(options.daemonUrl, options.projectId, ownerFileName),
    title,
  };
}

async function inlineProjectAssetsForPdf(
  html: string,
  ownerFileName: string,
  options: BuildDesktopPdfExportInputOptions,
): Promise<string> {
  const reader: InlineAssetReader = async (relPath) => {
    let meta;
    try {
      meta = await resolveProjectFilePath(
        options.projectsRoot,
        options.projectId,
        relPath,
        options.metadata,
      );
    } catch {
      return null;
    }
    return {
      size: meta.size,
      read: async () => {
        try {
          const file = await readProjectFile(
            options.projectsRoot,
            options.projectId,
            relPath,
            options.metadata,
          );
          return file.buffer.toString('utf8');
        } catch {
          return null;
        }
      },
    };
  };

  try {
    return await inlineRelativeAssets(html, ownerFileName, reader);
  } catch {
    return html;
  }
}

function displayTitle(title: string | undefined, fileName: string): string {
  if (typeof title === 'string' && title.trim().length > 0) return title.trim();
  const base = path.posix.basename(fileName);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base || 'artifact';
}

function rawBaseHref(daemonUrl: string, projectId: string, fileName: string): string {
  const dir = path.posix.dirname(fileName.replace(/^\/+/, ''));
  const safeProjectId = encodeURIComponent(projectId);
  const rawBase = `${daemonUrl.replace(/\/+$/, '')}/api/projects/${safeProjectId}/raw/`;
  if (!dir || dir === '.') return rawBase;
  return `${rawBase}${encodePathSegments(dir)}/`;
}

function rawFileUrl(daemonUrl: string, projectId: string, fileName: string): string {
  const safeProjectId = encodeURIComponent(projectId);
  const rawBase = `${daemonUrl.replace(/\/+$/, '')}/api/projects/${safeProjectId}/raw/`;
  return `${rawBase}${encodePathSegments(fileName.replace(/^\/+/, ''))}`;
}

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function safeFilename(name: string, fallback: string): string {
  const slug = (name || fallback)
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
