import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('project file copy route', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function createProject() {
    const id = `copy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: { id: string } };
    return body.project.id;
  }

  async function writeText(
    projectId: string,
    name: string,
    content: string,
    artifactManifest?: Record<string, unknown>,
  ) {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, artifactManifest }),
    });
    expect(response.status).toBe(200);
  }

  it('copies a file to the next available numeric-suffix name', async () => {
    const projectId = await createProject();
    await writeText(projectId, 'page.html', '<h1>original</h1>');
    await writeText(projectId, 'page1.html', '<h1>existing</h1>');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'page.html' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sourceName: string;
      newName: string;
      file: { name: string };
    };
    expect(body.sourceName).toBe('page.html');
    expect(body.newName).toBe('page2.html');
    expect(body.file.name).toBe('page2.html');

    const copied = await fetch(`${baseUrl}/api/projects/${projectId}/raw/page2.html`);
    expect(copied.status).toBe(200);
    expect(await copied.text()).toBe('<h1>original</h1>');

    const original = await fetch(`${baseUrl}/api/projects/${projectId}/raw/page.html`);
    expect(await original.text()).toBe('<h1>original</h1>');
  });

  it('continues the original numeric sequence when copying an indexed file', async () => {
    const projectId = await createProject();
    await writeText(projectId, 'draft1.html', '<h1>first copy</h1>');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'draft1.html' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { newName: string };
    expect(body.newName).toBe('draft2.html');

    const copied = await fetch(`${baseUrl}/api/projects/${projectId}/raw/draft2.html`);
    expect(await copied.text()).toBe('<h1>first copy</h1>');
  });

  it('copies an artifact manifest and rewrites its entry to the new file', async () => {
    const projectId = await createProject();
    await writeText(projectId, 'prototype.html', '<h1>prototype</h1>', {
      version: 1,
      kind: 'html',
      title: 'Prototype',
      entry: 'prototype.html',
      renderer: 'html',
      status: 'complete',
      exports: ['html'],
    });

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'prototype.html' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      file: { name: string; artifactManifest?: { entry?: string } };
    };
    expect(body.file.name).toBe('prototype1.html');
    expect(body.file.artifactManifest?.entry).toBe('prototype1.html');

    const filesResponse = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
    const filesBody = (await filesResponse.json()) as {
      files: Array<{ name: string; artifactManifest?: { entry?: string } }>;
    };
    expect(
      filesBody.files.find((file) => file.name === 'prototype1.html')?.artifactManifest?.entry,
    ).toBe('prototype1.html');
  });
});
