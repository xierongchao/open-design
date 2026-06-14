// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  applyCanvasHeadAssets,
  extractCanvasHeadAssets,
  parseHtmlDocument,
  resolveCanvasAssetUrl,
} from '../../src/components/grapesjs/html-document';

describe('GrapesJS HTML document helpers', () => {
  const env = {
    origin: 'http://localhost:17573',
    protocol: 'http:',
  };

  it('extracts stylesheet links and inline CSS from the original head', () => {
    const parsed = parseHtmlDocument(`<!doctype html>
<html>
  <head>
    <link rel="preload" href="../css/skip.css">
    <link rel="stylesheet" href="../css/admin-kit.css" media="screen">
    <style>.hero { min-height: 100vh; }</style>
  </head>
  <body><main class="hero">Hello</main></body>
</html>`);

    expect(extractCanvasHeadAssets(parsed.head)).toEqual({
      inlineCss: '.hero { min-height: 100vh; }',
      stylesheetLinks: [{ href: '../css/admin-kit.css', media: 'screen' }],
    });
  });

  it('resolves relative canvas assets against the project raw directory', () => {
    expect(resolveCanvasAssetUrl(
      '../css/admin-kit.css',
      '/api/projects/sf1/raw/%E9%A1%B5%E9%9D%A2/',
      env,
    )).toBe('http://localhost:17573/api/projects/sf1/raw/css/admin-kit.css');
  });

  it('injects project base, linked stylesheets, and inline styles into the canvas document', () => {
    const parsed = parseHtmlDocument(`<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../css/admin-kit.css">
    <style>body { margin: 0; }</style>
  </head>
  <body><img src="../assets/logo.svg"></body>
</html>`);
    const doc = document.implementation.createHTMLDocument('canvas');

    applyCanvasHeadAssets(
      doc,
      parsed,
      '/api/projects/sf1/raw/%E9%A1%B5%E9%9D%A2/',
      env,
    );

    expect(doc.head.querySelector('base')?.getAttribute('href')).toBe(
      'http://localhost:17573/api/projects/sf1/raw/%E9%A1%B5%E9%9D%A2/',
    );
    expect(doc.head.querySelector('link')?.getAttribute('href')).toBe(
      'http://localhost:17573/api/projects/sf1/raw/css/admin-kit.css',
    );
    expect(doc.head.querySelector('style')?.textContent).toBe('body { margin: 0; }');
  });
});
