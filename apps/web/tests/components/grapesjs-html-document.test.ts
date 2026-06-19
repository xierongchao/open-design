// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  applyCanvasBodyAttributes,
  applyCanvasHeadAssets,
  extractCanvasHeadAssets,
  extractSavedEditorCss,
  normalizeCanvasBodyHtml,
  parseHtmlDocument,
  readCanvasBodyStyleOverrides,
  reassembleDocument,
  resolveCanvasAssetUrl,
  resolveCanvasBodyAssetUrls,
  restoreCanvasBodyAssetUrls,
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

  it('keeps editor-managed CSS out of ordinary canvas head assets', () => {
    const parsed = parseHtmlDocument(`<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../css/admin-kit.css">
    <style>.hero { color: red; }</style>
    <style>* { box-sizing: border-box; } body {margin: 0;}#stale{width:1px;}</style>
    <style data-od-grapesjs-css="">#rect{width:160px;height:96px;}</style>
  </head>
  <body><div id="rect"></div></body>
</html>`);

    expect(extractCanvasHeadAssets(parsed.head)).toEqual({
      inlineCss: '.hero { color: red; }',
      stylesheetLinks: [{ href: '../css/admin-kit.css' }],
    });
    expect(extractSavedEditorCss(parsed.head)).toBe('#rect{width:160px;height:96px;}');
  });

  it('normalizes accidental full-document/body wrappers into body children only', () => {
    expect(normalizeCanvasBodyHtml([
      '<!doctype html>',
      '<html><head><style>.stale { color: red; }</style></head>',
      '<body data-od-id="gjs-body"><div id="rect"></div></body></html>',
    ].join(''))).toBe('<div id="rect"></div>');
  });

  it('replaces saved GrapesJS CSS instead of accumulating stale generated style blocks', () => {
    const parsed = parseHtmlDocument(`<!doctype html>
<html>
  <head>
    <style>body { width: 1920px; min-height: 1080px; background: #fff; }</style>
    <style>* { box-sizing: border-box; } body {margin: 0;}#old{width:10px;}</style>
    <style>* { box-sizing: border-box; } body {margin: 0;}#rect{width:160px;height:96px;}</style>
  </head>
  <body><div id="rect"></div></body>
</html>`);

    const next = reassembleDocument(
      parsed,
      '<div id="rect"></div>',
      '#rect{width:220px;}',
    );

    expect(next).toContain('<style>body { width: 1920px; min-height: 1080px; background: #fff; }</style>');
    expect(next).toContain('<style data-od-grapesjs-css="">');
    expect(next).toContain('*{box-sizing: border-box;}');
    expect(next).toContain('body{margin: 0;}');
    expect(next).toContain('#rect{width:220px;}');
    expect(next).not.toContain('#old{width:10px;}');
    expect((next.match(/data-od-grapesjs-css/g) ?? []).length).toBe(1);
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

  it('mirrors safe body attributes into the GrapesJS canvas document', () => {
    const parsed = parseHtmlDocument(`<!doctype html>
<html>
  <head></head>
  <body class="bg-black text-white" data-theme="dark" onload="alert(1)"><main>审批页</main></body>
</html>`);
    const doc = document.implementation.createHTMLDocument('canvas');

    applyCanvasBodyAttributes(doc, parsed);

    expect(doc.body.getAttribute('class')).toBe('bg-black text-white');
    expect(doc.body.getAttribute('data-theme')).toBe('dark');
    expect(doc.body.getAttribute('onload')).toBeNull();

    const nextParsed = parseHtmlDocument(`<!doctype html>
<html>
  <head></head>
  <body class="bg-white"><main>审批页</main></body>
</html>`);

    applyCanvasBodyAttributes(doc, nextParsed);

    expect(doc.body.getAttribute('class')).toBe('bg-white');
    expect(doc.body.getAttribute('data-theme')).toBeNull();
  });

  it('resolves body image assets before GrapesJS parses canvas components', () => {
    const body = [
      '<section style="background-image: url(\'../assets/hero.jpg\')">',
      '  <img src="../assets/logo.svg" srcset="../assets/logo-small.svg 1x, https://cdn.example/logo.svg 2x">',
      '  <video poster="./poster.png"></video>',
      '</section>',
    ].join('');

    expect(resolveCanvasBodyAssetUrls(
      body,
      '/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/%E5%B0%8F%E7%A8%8B%E5%BA%8F%E9%A1%B5%E9%9D%A2/',
      env,
    )).toBe([
      '<section style="background-image: url(&quot;http://localhost:17573/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/assets/hero.jpg&quot;)">',
      '  <img src="http://localhost:17573/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/assets/logo.svg" srcset="http://localhost:17573/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/assets/logo-small.svg 1x, https://cdn.example/logo.svg 2x">',
      '  <video poster="http://localhost:17573/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/%E5%B0%8F%E7%A8%8B%E5%BA%8F%E9%A1%B5%E9%9D%A2/poster.png"></video>',
      '</section>',
    ].join(''));
  });

  it('restores canvas raw URLs back to project-relative paths before saving', () => {
    const body = [
      '<section style="background-image: url(&quot;http://localhost:17573/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/assets/hero.jpg&quot;)">',
      '  <img src="http://localhost:17573/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/assets/logo.svg">',
      '  <img src="https://cdn.example/remote.svg">',
      '</section>',
    ].join('');

    expect(restoreCanvasBodyAssetUrls(
      body,
      '/api/projects/sf1/raw/%E7%9B%B4%E6%92%AD%E6%A8%A1%E5%9D%97/%E7%8B%AC%E7%AB%8B%E7%9B%B4%E6%92%AD/%E5%B0%8F%E7%A8%8B%E5%BA%8F%E9%A1%B5%E9%9D%A2/',
      env,
    )).toBe([
      '<section style="background-image: url(&quot;../assets/hero.jpg&quot;)">',
      '  <img src="../assets/logo.svg">',
      '  <img src="https://cdn.example/remote.svg">',
      '</section>',
    ].join(''));
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
