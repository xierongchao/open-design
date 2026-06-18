// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StylePanel } from '../../../src/components/grapesjs/StylePanel';
import { readImageFileToDataUrl } from '../../../src/components/grapesjs/image-upload';
import type {
  GrapesjsEditorHandle,
  SelectionSnapshot,
} from '../../../src/components/grapesjs/GrapesjsEditor';

vi.mock('../../../src/components/grapesjs/image-upload', () => ({
  readImageFileToDataUrl: vi.fn(),
}));

let canvasGetContextSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  canvasGetContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    fillStyle: '',
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }) as unknown as CanvasRenderingContext2D) as unknown as HTMLCanvasElement['getContext']);
});

afterEach(() => {
  cleanup();
  canvasGetContextSpy?.mockRestore();
  canvasGetContextSpy = null;
  vi.clearAllMocks();
});

function renderPanel(styles: Record<string, string> = {}) {
  const applyStyle = vi.fn();
  const editorRef = {
    current: {
      applyStyle,
      replaceColors: vi.fn(),
      reselectCurrent: vi.fn(),
      setCropMode: vi.fn(),
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
    selectedColors: ['#ffffff'],
  };

  render(<StylePanel editorRef={editorRef} selection={selection} />);
  return { applyStyle };
}

function renderCanvasPanel(styles: Record<string, string> = { backgroundColor: 'rgb(246, 246, 246)', fontSize: '16px' }) {
  const setCanvasStyles = vi.fn();
  const setCanvasSize = vi.fn();
  const editorRef = {
    current: {
      getCanvasState: vi.fn(() => ({
        styles,
        size: { width: 390, height: 1190 },
      })),
      getCanvasStyles: vi.fn(() => styles),
      setCanvasStyles,
      setCanvasSize,
      reselectCurrent: vi.fn(),
      setCropMode: vi.fn(),
    } as unknown as GrapesjsEditorHandle,
  };

  render(<StylePanel editorRef={editorRef} selection={{ hasSelection: false, tagName: '', selector: '', styles: {}, selectedColors: [] }} />);
  return { setCanvasStyles, setCanvasSize };
}

describe('StylePanel', () => {
  it('renders the Figma-style Chinese property groups', () => {
    renderPanel();

    for (const title of ['位置', '自动布局', '外观', '已选颜色']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    for (const title of ['填充', '描边', '效果']) {
      expect(screen.getByRole('button', { name: title })).toBeTruthy();
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
    renderPanel({
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderStyle: 'solid',
    });

    fireEvent.click(screen.getByRole('button', { name: '分别设置四个圆角' }));
    expect(screen.getByRole('spinbutton', { name: '左上圆角' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: '右下圆角' })).toBeTruthy();

    expect(screen.getByRole('spinbutton', { name: '上描边' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: '左描边' })).toBeTruthy();
  });

  it('opens the custom color and advanced stroke panels', () => {
    renderPanel({ borderTopWidth: '1px', borderStyle: 'solid' });

    fireEvent.click(screen.getByRole('button', { name: '填充取色器' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '颜色集合' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }));

    fireEvent.click(screen.getByRole('button', { name: '高级描边设置' }));
    expect(screen.getByText('描边设置')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '基础' })).toBeTruthy();
  });

  it('applies advanced stroke cap and join controls', () => {
    const { applyStyle } = renderPanel({
      borderTopWidth: '1px',
      borderStyle: 'solid',
      strokeLinecap: 'butt',
      strokeLinejoin: 'miter',
    });

    fireEvent.click(screen.getByRole('button', { name: '高级描边设置' }));
    fireEvent.click(screen.getByRole('button', { name: '圆头端点' }));
    fireEvent.click(screen.getByRole('button', { name: '斜角连接' }));

    expect(applyStyle).toHaveBeenCalledWith({ 'stroke-linecap': 'round' });
    expect(applyStyle).toHaveBeenCalledWith({ 'stroke-linejoin': 'bevel' });
  });

  it('applies effect changes from the floating effect settings title', () => {
    const { applyStyle } = renderPanel({
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
    });

    fireEvent.click(screen.getByRole('button', { name: '打开效果参数' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: '效果类型' }), {
      target: { value: 'background-blur' },
    });

    expect(applyStyle).toHaveBeenCalledWith({
      'backdrop-filter': 'blur(8px)',
      '-webkit-backdrop-filter': 'blur(8px)',
    });
  });

  it('commits a manually typed fill color when the field blurs', () => {
    const { applyStyle } = renderPanel();
    const fillInput = screen.getByRole('textbox', { name: '填充颜色值' });

    fireEvent.change(fillInput, { target: { value: 'f6f6f6' } });
    fireEvent.blur(fillInput);

    expect(applyStyle).toHaveBeenCalledWith({
      'background-color': '#f6f6f6',
      'background-image': 'none',
    });
  });

  it('does not commit short hex while the user is still typing a full color', () => {
    const { applyStyle } = renderPanel();
    const fillInput = screen.getByRole('textbox', { name: '填充颜色值' });

    fireEvent.change(fillInput, { target: { value: 'f6f' } });
    fireEvent.blur(fillInput);

    expect(applyStyle).not.toHaveBeenCalled();
  });

  it('lets the floating color editor accept partial typing before blur commit', () => {
    const { applyStyle } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '填充取色器' }));
    const dialog = screen.getByRole('dialog');
    const colorInput = within(dialog).getByRole('textbox', { name: '填充颜色值' }) as HTMLInputElement;

    fireEvent.change(colorInput, { target: { value: 'f' } });
    expect(colorInput.value).toBe('f');

    fireEvent.change(colorInput, { target: { value: 'f6f6f6' } });
    fireEvent.blur(colorInput);

    expect(applyStyle).toHaveBeenCalledWith({
      'background-color': '#f6f6f6',
      'background-image': 'none',
    });
  });

  it('keeps short hex in the floating color editor as an uncommitted draft', () => {
    const { applyStyle } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '填充取色器' }));
    const dialog = screen.getByRole('dialog');
    const colorInput = within(dialog).getByRole('textbox', { name: '填充颜色值' }) as HTMLInputElement;

    fireEvent.change(colorInput, { target: { value: 'f6f' } });
    fireEvent.blur(colorInput);

    expect(applyStyle).not.toHaveBeenCalled();
  });

  it('shows the live canvas size and background when nothing is selected', async () => {
    renderCanvasPanel();

    await waitFor(() => {
      expect((screen.getByRole('spinbutton', { name: '画板宽度' }) as HTMLInputElement).value).toBe('390');
      expect((screen.getByRole('spinbutton', { name: '画板高度' }) as HTMLInputElement).value).toBe('1190');
      expect((screen.getByRole('textbox', { name: 'HTML 背景颜色值' }) as HTMLInputElement).value).toBe('F6F6F6');
    });
  });

  it('shows a neutral draft value for transparent HTML background', async () => {
    renderCanvasPanel({ backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '16px' });

    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: 'HTML 背景颜色值' }) as HTMLInputElement).value).toBe('FFFFFF');
      expect(screen.getByRole('button', { name: '显示HTML 背景' })).toBeTruthy();
    });
  });

  it('shows the selected-color batch editor', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '批量修改颜色' }));

    expect(screen.getByText('已选择 0 个颜色')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择替换颜色' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '替换' }).hasAttribute('disabled')).toBe(true);
  });

  it('keeps image replacement available while crop mode is active', () => {
    renderPanel({
      backgroundImage: 'url("data:image/png;base64,abc")',
      backgroundSize: 'auto',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });

    expect(screen.getByRole('button', { name: '点击替换图片' })).toBeTruthy();
    expect(screen.getByLabelText('图片缩放')).toBeTruthy();
  });

  it('uploads replacement images from crop mode without leaving crop sizing', async () => {
    vi.mocked(readImageFileToDataUrl).mockResolvedValue({
      dataUrl: 'data:image/png;base64,next',
      width: 10,
      height: 10,
    });
    const { applyStyle } = renderPanel({
      backgroundImage: 'url("data:image/png;base64,abc")',
      backgroundSize: 'auto',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });
    const file = new File(['img'], 'next.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('选择图片文件'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(applyStyle).toHaveBeenCalledWith({
        'background-image': 'url("data:image/png;base64,next")',
        'background-size': 'auto',
        'background-position': 'center',
        'background-repeat': 'no-repeat',
      });
    });
  });
});
