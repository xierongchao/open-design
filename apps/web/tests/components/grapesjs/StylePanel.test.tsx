// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StylePanel } from '../../../src/components/grapesjs/StylePanel';
import type {
  GrapesjsEditorHandle,
  SelectionSnapshot,
} from '../../../src/components/grapesjs/GrapesjsEditor';

afterEach(cleanup);

function renderPanel(styles: Record<string, string> = {}) {
  const applyStyle = vi.fn();
  const editorRef = {
    current: {
      applyStyle,
    } as unknown as GrapesjsEditorHandle,
  };
  const selection: SelectionSnapshot = {
    hasSelection: true,
    tagName: 'div',
    selector: 'div.color-grid',
    styles: {
      display: 'block',
      width: '320px',
      height: '180px',
      backgroundColor: 'rgb(255, 255, 255)',
      borderColor: 'rgb(0, 0, 0)',
      borderTopWidth: '0px',
      borderStyle: 'none',
      opacity: '1',
      ...styles,
    },
  };

  render(<StylePanel editorRef={editorRef} selection={selection} />);
  return { applyStyle };
}

describe('StylePanel', () => {
  it('renders the Figma-style Chinese property groups', () => {
    renderPanel();

    for (const title of ['位置', '自动布局', '外观', '填充', '描边', '效果', '已选颜色']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
  });

  it('adds Chinese tooltips to icon controls and applies horizontal flow', () => {
    const { applyStyle } = renderPanel();
    const horizontalFlow = screen.getByRole('button', { name: '水平流' });

    expect(horizontalFlow.getAttribute('data-tooltip')).toBe('水平流');
    fireEvent.click(horizontalFlow);

    expect(applyStyle).toHaveBeenCalledWith({
      display: 'flex',
      'flex-direction': 'row',
      'flex-wrap': 'nowrap',
    });
  });

  it('maps the clip content control to overflow', () => {
    const { applyStyle } = renderPanel({ overflow: 'visible' });

    fireEvent.click(screen.getByRole('checkbox', { name: '裁剪内容' }));

    expect(applyStyle).toHaveBeenCalledWith({ overflow: 'hidden' });
  });

  it('expands the four-corner and four-side controls', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '分别设置四个圆角' }));
    expect(screen.getByRole('spinbutton', { name: '左上圆角' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: '右下圆角' })).toBeTruthy();

    expect(screen.getByRole('spinbutton', { name: '上描边' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: '左描边' })).toBeTruthy();
  });

  it('opens the custom color and advanced stroke panels', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '填充取色器' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '颜色集合' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }));

    fireEvent.click(screen.getByRole('button', { name: '高级描边设置' }));
    expect(screen.getByText('描边设置')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '基础' })).toBeTruthy();
  });

  it('shows the selected-color batch editor', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '批量修改颜色' }));

    expect(screen.getByText('已选择 0 个颜色')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择替换颜色' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '替换' }).hasAttribute('disabled')).toBe(true);
  });
});
