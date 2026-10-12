import sharp from 'sharp';

export class AvatarImageError extends Error {}
export const MAX_AVATAR_PIXELS = 20_000_000;
const expectedFormats: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

export async function normalizeAvatarImage(file: { buffer: Buffer; mimetype: string }) {
  try {
    const image = sharp(file.buffer, { limitInputPixels: MAX_AVATAR_PIXELS, failOn: 'error', animated: false });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_AVATAR_PIXELS) {
      throw new AvatarImageError('File ảnh không hợp lệ');
    }
    if (!expectedFormats[file.mimetype] || metadata.format !== expectedFormats[file.mimetype]) {
      throw new AvatarImageError('Nội dung file không khớp định dạng ảnh');
    }
    // Sharp mặc định bỏ metadata; rotate áp dụng EXIF trước khi xuất ảnh WebP tĩnh.
    return await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  } catch (error) {
    if (error instanceof AvatarImageError) throw error;
    throw new AvatarImageError('File ảnh không hợp lệ');
  }
}
