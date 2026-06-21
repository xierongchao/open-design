import { describe, expect, it } from 'vitest';

import { pruneOrphanCssRules, reassembleDocument } from '../../../src/components/grapesjs/html-document';

describe('pruneOrphanCssRules', () => {
  it('drops a #id rule whose element is absent from the body', () => {
    const css = '#deleted-id{color:red}';
    const body = '<div id="alive">x</div>';
    expect(pruneOrphanCssRules(css, body)).toBe('');
  });

  it('keeps a #id rule whose element survives in the body', () => {
    const css = '#alive{color:red}';
    const body = '<div id="alive">x</div>';
    expect(pruneOrphanCssRules(css, body)).toBe('#alive{color:red}');
  });

  it('keeps class / tag / universal selectors untouched', () => {
    const css = '.dynamic-class{color:red}div{margin:0}*{box-sizing:border-box}';
    const body = '<div class="dynamic-class">x</div>';
    expect(pruneOrphanCssRules(css, body)).toBe(css);
  });

  it('drops a [data-od-id] rule whose target is gone', () => {
    const css = '[data-od-id="gone"]{background:#fff}';
    const body = '<div data-od-id="alive">x</div>';
    expect(pruneOrphanCssRules(css, body)).toBe('');
  });

  it('keeps a [data-od-id] rule whose target survives', () => {
    const css = '[data-od-id="alive"]{background:#fff}';
    const body = '<div data-od-id="alive">x</div>';
    expect(pruneOrphanCssRules(css, body)).toBe('[data-od-id="alive"]{background:#fff}');
  });

  it('prunes only the orphaned rules in a mixed block', () => {
    const css = [
      '#deleted{color:red}',
      '.keep{color:blue}',
      '#alive{color:green}',
      '[data-od-id="gone"]{opacity:0.5}',
    ].join('\n');
    const body = '<div id="alive"><span class="keep">x</span></div>';
    const result = pruneOrphanCssRules(css, body);
    expect(result).toContain('#alive{color:green}');
    expect(result).toContain('.keep{color:blue}');
    expect(result).not.toContain('#deleted');
    expect(result).not.toContain('data-od-id="gone"');
  });

  it('keeps a comma-list rule if any branch survives', () => {
    const css = '#alive, #deleted{color:red}';
    const body = '<div id="alive">x</div>';
    // At least one surviving branch → keep the whole rule.
    expect(pruneOrphanCssRules(css, body)).toBe('#alive, #deleted{color:red}');
  });

  it('drops a comma-list rule only when every branch is orphaned', () => {
    const css = '#gone-a, #gone-b{color:red}';
    const body = '<div id="alive">x</div>';
    expect(pruneOrphanCssRules(css, body)).toBe('');
  });

  it('returns the input unchanged when there are no orphans', () => {
    const css = '#alive{color:red}';
    const body = '<div id="alive">x</div>';
    expect(pruneOrphanCssRules(css, body)).toBe(css);
  });

  it('handles empty / blank css without throwing', () => {
    expect(pruneOrphanCssRules('', '<div id="alive">x</div>')).toBe('');
    expect(pruneOrphanCssRules('   ', '<div id="alive">x</div>')).toBe('   ');
  });

  it('handles unquoted id and data-od-id attributes', () => {
    const css = '#alive{color:red}[data-od-id=gone]{color:blue}';
    const body = '<div id=alive data-od-id=alive>x</div>';
    const result = pruneOrphanCssRules(css, body);
    expect(result).toContain('#alive{color:red}');
    expect(result).not.toContain('data-od-id=gone');
  });

  it('prunes orphaned rules after merging saved editor CSS seed', () => {
    const result = reassembleDocument(
      {
        doctype: '<!doctype html>',
        htmlOpen: '<html>',
        head: '<head><style data-od-grapesjs-css="">#deleted{color:red}\n#alive{color:blue}</style></head>',
        bodyOpen: '<body>',
        bodyInner: '',
        bodyClose: '</body>',
        htmlClose: '</html>',
      },
      '<div id="alive">x</div>',
      '',
    );

    expect(result).toContain('#alive{color:blue}');
    expect(result).not.toContain('#deleted');
  });
});
