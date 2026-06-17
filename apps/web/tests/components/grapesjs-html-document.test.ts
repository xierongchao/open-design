// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  applyCanvasHeadAssets,
  extractCanvasHeadAssets,
  parseHtmlDocument,
  readCanvasBodyStyleOverrides,
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

  it('reads body appearance styles from the original document CSS', () => {
    const parsed = parseHtmlDocument(`<!doctype html>
<html>
  <head>
    <style>
      .card { background-color: #fff; }
      body {
        font-family: Inter, sans-serif;
        font-size: 16px;
        color: #111827;
        background-color: #f6f6f6;
      }
    </style>
  </head>
  <body><main>审批页</main></body>
</html>`);

    expect(readCanvasBodyStyleOverrides(parsed)).toEqual({
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      color: '#111827',
      backgroundColor: '#f6f6f6',
    });
  });

  it('lets an inline body style override head body CSS', () => {
    const parsed = parseHtmlDocument(`<!doctype html>
<html>
  <head><style>body { background-color: #f6f6f6; }</style></head>
  <body style="background-color:#ffffff; font-size:18px"><main>审批页</main></body>
</html>`);

    expect(readCanvasBodyStyleOverrides(parsed)).toEqual({
      backgroundColor: '#ffffff',
      fontSize: '18px',
    });
  });
});
