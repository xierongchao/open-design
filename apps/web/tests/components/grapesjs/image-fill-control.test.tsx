// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ImageFillControl,
  ImageFillSummary,
  bgSizeFromOption,
  fillSizeToObjectFit,
  imageUrlFromCssUrl,
  objectFitToFillSize,
  optionFromBgSize,
} from '../../../src/components/grapesjs/image-fill-control';
import { readImageFileToDataUrl } from '../../../src/components/grapesjs/image-upload';

vi.mock('../../../src/components/grapesjs/image-upload', () => ({
  readImageFileToDataUrl: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('image-fill-control', () => {
  it('round-trips crop and keyword background-size options', () => {
    expect(bgSizeFromOption('od-crop')).toBe('auto');
    expect(bgSizeFromOption('cover')).toBe('cover');
    expect(optionFromBgSize('auto')).toBe('od-crop');
    expect(optionFromBgSize('320px 180px')).toBe('od-crop');
    expect(optionFromBgSize('contain')).toBe('contain');
  });

  it('normalizes image urls and img object-fit fill modes', () => {
    expect(imageUrlFromCssUrl('url("data:image/png;base64,abc")')).toBe('data:image/png;base64,abc');
    expect(imageUrlFromCssUrl('none')).toBe('');
    expect(objectFitToFillSize('none')).toBe('od-crop');
    expect(objectFitToFillSize('contain')).toBe('contain');
    expect(fillSizeToObjectFit('auto')).toBe('none');
    expect(fillSizeToObjectFit('100% 100%')).toBe('fill');
  });

  it('renders a compact image fill summary that opens the fill popover', () => {
    const onOpen = vi.fn();

    render(<ImageFillSummary url="data:image/png;base64,current" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: '打开图片填充' }));

    expect(screen.getByText('图片')).toBeTruthy();
    expect(onOpen).toHaveBeenCalled();
  });

  it('uploads images through the extracted fill control interface', async () => {
    vi.mocked(readImageFileToDataUrl).mockResolvedValue({
      dataUrl: 'data:image/png;base64,next',
      width: 10,
      height: 10,
    });
    const onUrlChange = vi.fn();
    const file = new File(['img'], 'next.png', { type: 'image/png' });

    render(
      <ImageFillControl
        url=""
        size="cover"
        repeat="no-repeat"
        onUrlChange={onUrlChange}
        onSizeChange={vi.fn()}
        onRepeatChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择图片文件'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onUrlChange).toHaveBeenCalledWith('data:image/png;base64,next');
    });
  });

  it('keeps upload available in crop mode without showing panel crop controls', () => {
    const onCropModeChange = vi.fn();

    render(
      <ImageFillControl
        url="data:image/png;base64,current"
        size="od-crop"
        repeat="no-repeat"
        onUrlChange={vi.fn()}
        onSizeChange={vi.fn()}
        onRepeatChange={vi.fn()}
        onCropModeChange={onCropModeChange}
      />,
    );

    expect(screen.getByRole('button', { name: '点击替换图片' })).toBeTruthy();
    expect(screen.queryByLabelText('图片缩放')).toBeNull();
    expect(onCropModeChange).toHaveBeenCalledWith(true);
  });
});
