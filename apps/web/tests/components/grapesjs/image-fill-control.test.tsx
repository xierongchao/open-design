// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ImageFillControl,
  bgSizeFromOption,
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

  it('keeps crop controls and upload available in crop mode', () => {
    render(
      <ImageFillControl
        url="data:image/png;base64,current"
        size="od-crop"
        repeat="no-repeat"
        position="12px 8px"
        cropSize="200px 120px"
        onUrlChange={vi.fn()}
        onSizeChange={vi.fn()}
        onRepeatChange={vi.fn()}
        onCrop={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '点击替换图片' })).toBeTruthy();
    expect(screen.getByLabelText('图片缩放')).toBeTruthy();
  });
});
