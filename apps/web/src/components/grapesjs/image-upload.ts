/**
 * Image upload helpers shared by the GrapesJS editor's fill panel,
 * double-click-to-upload flow, and clipboard-paste flow.
 *
 * Reads a File (from an <input type=file> or a clipboard image item) into a
 * base64 data URL and measures its intrinsic dimensions. Reuses the
 * FileReader pattern from pet/image.ts but drops the sprite-friendly size
 * caps — canvas images need a more generous limit.
 */

/** Max accepted image size: 5 MB. Larger uploads are rejected. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ReadImageResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Read an image File into a base64 data URL via FileReader.
 * Rejects files larger than MAX_IMAGE_BYTES or non-image MIME types.
 */
export function readImageFileToDataUrl(file: File): Promise<ReadImageResult> {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) {
      reject(new Error('仅支持图片文件'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('图片不能超过 5MB'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error('读取图片失败'));
        return;
      }
      const img = new Image();
      img.onerror = () => resolve({ dataUrl, width: 0, height: 0 });
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
