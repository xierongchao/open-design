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

function renderPanel(
  styles: Record<string, string> = {},
  options: { tagName?: string; selector?: string; selectedSrc?: string; componentType?: string; canvasTool?: string } = {},
) {
  const applyStyle = vi.fn();
  const alignPositionedSelection = vi.fn(() => false);
  const arrangeSelectionAsFlex = vi.fn(() => false);
  const dissolveSelectedFlex = vi.fn(() => false);
  const setSelectedSrc = vi.fn();
  const getSelectedSrc = vi.fn(() => options.selectedSrc ?? '');
  const editorRef = {
    current: {
      applyStyle,
      alignPositionedSelection,
      arrangeSelectionAsFlex,
      dissolveSelectedFlex,
      replaceColors: vi.fn(),
      reselectCurrent: vi.fn(),
      setCropMode: vi.fn(),
      setSelectedSrc,
      getSelectedSrc,
    } as unknown as GrapesjsEditorHandle,
  };
  const selection: SelectionSnapshot = {
    hasSelection: true,
    tagName: options.tagName ?? 'div',
    selector: options.selector ?? 'div.color-grid',
    componentType: options.componentType,
    canvasTool: options.canvasTool,
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
  return { alignPositionedSelection, applyStyle, arrangeSelectionAsFlex, dissolveSelectedFlex, getSelectedSrc, setSelectedSrc };
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

  it('shows auto layout as a plus-only section before it is enabled', () => {
    const { applyStyle } = renderPanel();
    const enableAutoLayout = screen.getByRole('button', { name: '开启自动布局' });

    expect(screen.queryByRole('button', { name: '水平' })).toBeNull();
    expect(screen.queryByRole('button', { name: '自由布局' })).toBeNull();
    expect(enableAutoLayout.getAttribute('data-tooltip')).toBe('开启自动布局');
    fireEvent.click(enableAutoLayout);

    expect(applyStyle).toHaveBeenCalledWith({
      display: 'flex',
      'flex-direction': 'row',
      'flex-wrap': 'nowrap',
    });
  });

  it('adds reference Chinese tooltips to enabled auto layout controls', () => {
    const { applyStyle } = renderPanel({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'nowrap',
      gap: '12px',
    });
    const horizontalFlow = screen.getByRole('button', { name: '水平' });
    const verticalFlow = screen.getByRole('button', { name: '垂直' });
    const wrapFlow = screen.getByRole('button', { name: '换行' });
    const distribution = screen.getByRole('button', { name: '水平分布式' });
    const gap = screen.getByRole('spinbutton', { name: '水平间距' });

    expect(horizontalFlow.getAttribute('data-tooltip')).toBe('水平');
    expect(verticalFlow.getAttribute('data-tooltip')).toBe('垂直');
    expect(wrapFlow.getAttribute('data-tooltip')).toBe('换行');
    expect(distribution.getAttribute('data-tooltip')).toBe('水平分布式');
    expect(gap.getAttribute('aria-label')).toBe('水平间距');
    fireEvent.click(verticalFlow);

    expect(applyStyle).toHaveBeenCalledWith({
      display: 'flex',
      'flex-direction': 'column',
      'flex-wrap': 'nowrap',
    });
  });

  it('uses vertical spacing and distribution labels for vertical auto layout', () => {
    renderPanel({
      display: 'flex',
      flexDirection: 'column',
      flexWrap: 'nowrap',
      gap: '12px',
    });

    expect(screen.getByRole('spinbutton', { name: '垂直间距' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '垂直分布式' }).getAttribute('data-tooltip')).toBe('垂直分布式');
  });

  it('moves size controls into the position section and uses an absolute-position toggle', () => {
    const { applyStyle } = renderPanel({ position: 'static', display: 'flex' });
    const positionSection = screen.getByRole('heading', { name: '位置' }).closest('section');
    const autoLayoutSection = screen.getByRole('heading', { name: '自动布局' }).closest('section');

    expect(positionSection).toBeTruthy();
    expect(autoLayoutSection).toBeTruthy();
    expect(within(positionSection as HTMLElement).getByTestId('dimension-stack-grid')).toBeTruthy();
    expect(within(positionSection as HTMLElement).getByRole('combobox', { name: '宽调整模式' })).toBeTruthy();
    expect(within(positionSection as HTMLElement).getByRole('combobox', { name: '高调整模式' })).toBeTruthy();
    expect(within(positionSection as HTMLElement).getByRole('button', { name: '裁剪内容' })).toBeTruthy();
    expect(within(autoLayoutSection as HTMLElement).queryByText('调整大小')).toBeNull();
    expect(within(autoLayoutSection as HTMLElement).queryByRole('button', { name: '裁剪内容' })).toBeNull();

    const absoluteToggle = within(positionSection as HTMLElement).getByRole('button', { name: '绝对定位' });
    expect(absoluteToggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(absoluteToggle);

    expect(applyStyle).toHaveBeenCalledWith({ position: 'absolute' });
  });

  it('deactivates absolute positioning back to relative positioning', () => {
    const { applyStyle } = renderPanel({ position: 'absolute' });
    const positionSection = screen.getByRole('heading', { name: '位置' }).closest('section') as HTMLElement;
    const absoluteToggle = within(positionSection).getByRole('button', { name: '绝对定位' });

    expect(absoluteToggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(absoluteToggle);

    expect(applyStyle).toHaveBeenCalledWith({ position: 'relative' });
  });

  it('renders enabled auto layout as a compact reference-style grid', () => {
    renderPanel({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'nowrap',
    });
    const autoLayoutSection = screen.getByRole('heading', { name: '自动布局' }).closest('section') as HTMLElement;

    expect(within(autoLayoutSection).getByRole('button', { name: '取消自动布局' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(autoLayoutSection).getByTestId('auto-layout-compact')).toBeTruthy();
    expect(within(autoLayoutSection).getByTestId('auto-layout-actions')).toBeTruthy();
    expect(within(autoLayoutSection).getByTestId('auto-layout-padding-pair')).toBeTruthy();
    expect(within(autoLayoutSection).getByTestId('auto-layout-padding-y')).toBeTruthy();
    expect(within(autoLayoutSection).getByTestId('auto-layout-padding-x')).toBeTruthy();
    expect(within(autoLayoutSection).getByRole('button', { name: '左上对齐' }).querySelector('svg')).toBeTruthy();
    expect(within(autoLayoutSection).queryByText('流向')).toBeNull();
    expect(within(autoLayoutSection).queryByText('对齐')).toBeNull();
  });

  it('keeps expanded padding controls in the auto-layout padding row', () => {
    renderPanel({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'nowrap',
    });
    const autoLayoutSection = screen.getByRole('heading', { name: '自动布局' }).closest('section') as HTMLElement;

    fireEvent.click(within(autoLayoutSection).getByRole('button', { name: '分别设置四边距' }));

    expect(within(autoLayoutSection).getByTestId('auto-layout-padding-expanded')).toBeTruthy();
    expect(within(autoLayoutSection).queryByTestId('auto-layout-padding-pair')).toBeNull();
    expect(within(autoLayoutSection).queryByTestId('auto-layout-padding-y')).toBeNull();
    expect(within(autoLayoutSection).queryByTestId('auto-layout-padding-x')).toBeNull();
    expect(within(autoLayoutSection).getByRole('spinbutton', { name: '左边距' })).toBeTruthy();
    expect(within(autoLayoutSection).getByRole('spinbutton', { name: '下边距' })).toBeTruthy();
  });

  it('places appearance controls above auto layout', () => {
    renderPanel();
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);

    expect(headings.indexOf('外观')).toBeGreaterThan(-1);
    expect(headings.indexOf('外观')).toBeLessThan(headings.indexOf('自动布局'));
  });

  it('uses positioned geometry alignment before falling back to self alignment styles', () => {
    const { alignPositionedSelection, applyStyle } = renderPanel({ position: 'absolute' });
    alignPositionedSelection.mockReturnValueOnce(true);

    fireEvent.click(screen.getByRole('button', { name: '左对齐 ⌥ A' }));

    expect(alignPositionedSelection).toHaveBeenCalledWith('left');
    expect(applyStyle).not.toHaveBeenCalledWith({ justifySelf: 'start' });
  });

  it('renders position alignment as icon-only buttons while preserving tooltips', () => {
    renderPanel({ position: 'absolute' });
    const leftAlign = screen.getByRole('button', { name: '左对齐 ⌥ A' });

    expect(leftAlign.textContent).toBe('');
    expect(leftAlign.querySelector('svg')).toBeTruthy();
    expect(leftAlign.getAttribute('data-tooltip')).toBe('左对齐 ⌥ A');
  });

  it('keeps position alignment style fallback when geometry alignment is unavailable', () => {
    const { alignPositionedSelection, applyStyle } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '上下居中对齐 ⌥ V' }));

    expect(alignPositionedSelection).toHaveBeenCalledWith('center-y');
    expect(applyStyle).toHaveBeenCalledWith({ 'align-self': 'center' });
  });

  it('adds distribution controls to positioned alignment', () => {
    const { alignPositionedSelection } = renderPanel({ position: 'absolute' });

    fireEvent.click(screen.getByRole('button', { name: '垂直平均分布 ⇧ ⌥ V' }));
    fireEvent.click(screen.getByRole('button', { name: '水平平均分布 ⇧ ⌥ H' }));

    expect(alignPositionedSelection).toHaveBeenCalledWith('distribute-y');
    expect(alignPositionedSelection).toHaveBeenCalledWith('distribute-x');
  });

  it('edits icon color through the selected icon color property', () => {
    const { applyStyle } = renderPanel({ color: '#333333' }, { canvasTool: 'icon' });

    fireEvent.change(screen.getByRole('textbox', { name: '图标颜色值' }), {
      target: { value: '#ff5500' },
    });

    expect(applyStyle).toHaveBeenCalledWith({ color: '#ff5500' });
  });

  it('disables position alignment controls when nothing is selected', async () => {
    renderCanvasPanel();

    const leftAlign = await screen.findByRole('button', { name: '左对齐 ⌥ A' });

    expect(leftAlign.hasAttribute('disabled')).toBe(true);
  });

  it('maps the clip content control to overflow', () => {
    const { applyStyle } = renderPanel({ display: 'flex', overflow: 'visible' });
    const positionSection = screen.getByRole('heading', { name: '位置' }).closest('section') as HTMLElement;

    fireEvent.click(within(positionSection).getByRole('button', { name: '裁剪内容' }));

    expect(applyStyle).toHaveBeenCalledWith({ overflow: 'hidden' });
  });

  it('shows fixed and fill sizing for non-text elements and maps fill to 100%', () => {
    const { applyStyle } = renderPanel({ width: '294px', height: '0px' });

    const widthMode = screen.getByRole('combobox', { name: '宽调整模式' }) as HTMLSelectElement;
    const heightMode = screen.getByRole('combobox', { name: '高调整模式' }) as HTMLSelectElement;

    expect(Array.from(widthMode.options).map((option) => option.textContent)).toEqual(['固定', '撑满']);
    expect(Array.from(heightMode.options).map((option) => option.textContent)).toEqual(['固定', '撑满']);

    fireEvent.change(widthMode, { target: { value: 'fill' } });
    fireEvent.change(heightMode, { target: { value: 'fill' } });

    expect(applyStyle).toHaveBeenCalledWith({ width: '100%' });
    expect(applyStyle).toHaveBeenCalledWith({ height: '100%' });
  });

  it('keeps fill selected when the selection snapshot carries percentage dimensions', () => {
    renderPanel({ width: '100%', height: '100%' });

    const widthMode = screen.getByRole('combobox', { name: '宽调整模式' }) as HTMLSelectElement;
    const heightMode = screen.getByRole('combobox', { name: '高调整模式' }) as HTMLSelectElement;

    expect(widthMode.value).toBe('fill');
    expect(heightMode.value).toBe('fill');
  });

  it('adds an adaptive sizing option only for text selections', () => {
    renderPanel({}, {
      componentType: 'text',
      canvasTool: 'text',
    });

    const widthMode = screen.getByRole('combobox', { name: '宽调整模式' }) as HTMLSelectElement;
    const heightMode = screen.getByRole('combobox', { name: '高调整模式' }) as HTMLSelectElement;

    expect(Array.from(widthMode.options).map((option) => option.textContent)).toEqual(['固定', '适应', '撑满']);
    expect(Array.from(heightMode.options).map((option) => option.textContent)).toEqual(['固定', '适应', '撑满']);
  });

  it('expands the four-corner and four-side controls', () => {
    renderPanel({
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderStyle: 'solid',
    });

    fireEvent.click(screen.getByRole('button', { name: '展开圆角' }));
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

  it('shows text controls for bottom-toolbar text components rendered as divs', () => {
    const { applyStyle } = renderPanel(
      {
        fontFamily: 'Inter, sans-serif',
        fontSize: '24px',
        fontWeight: '600',
        lineHeight: '1.2',
        color: 'rgb(17, 24, 39)',
      },
      { tagName: 'div', selector: 'div', componentType: 'text', canvasTool: 'text' },
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: '字号' }), {
      target: { value: '28' },
    });

    expect(screen.getByText('文字')).toBeTruthy();
    expect(applyStyle).toHaveBeenCalledWith({ 'font-size': '28px' });
  });

  it('keeps image replacement available while crop mode is active', () => {
    renderPanel({
      backgroundImage: 'url("data:image/png;base64,abc")',
      backgroundSize: 'auto',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });

    expect(screen.getByRole('button', { name: '打开图片填充' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '填充颜色值' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开图片填充' }));

    expect(screen.getByRole('button', { name: '点击替换图片' })).toBeTruthy();
    expect(screen.queryByLabelText('图片缩放')).toBeNull();
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

    fireEvent.click(screen.getByRole('button', { name: '打开图片填充' }));
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

  it('shows img selections as image fills and opens the image tab', () => {
    const { applyStyle, getSelectedSrc } = renderPanel({
      objectFit: 'cover',
      objectPosition: 'center',
    }, {
      tagName: 'img',
      selector: 'img.hero',
      selectedSrc: 'data:image/png;base64,current',
    });

    expect(getSelectedSrc).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '打开图片填充' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '填充颜色值' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '打开图片填充' }));
    expect(screen.getByRole('button', { name: '图片填充' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('combobox', { name: '尺寸' }), {
      target: { value: 'od-crop' },
    });

    expect(screen.queryByLabelText('图片缩放')).toBeNull();
    expect(applyStyle).toHaveBeenCalledWith({ 'object-fit': 'none' });
  });
});
