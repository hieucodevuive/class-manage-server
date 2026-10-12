import { randomUUID } from 'node:crypto';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { getCloudinaryConfig } from '../../config/cloudinary';

export class AvatarStorageError extends Error {
  constructor(public readonly kind: 'not_configured' | 'upload_failed') {
    super('Không thể sử dụng dịch vụ avatar');
  }
}

export function getOwnedAvatarPublicId(value: string | null, userId: number) {
  const settings = getCloudinaryConfig();
  if (!value || !settings) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.port
      || url.username || url.password || url.search || url.hash) return null;
    const prefix = `/${settings.cloud_name}/image/upload/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const tail = url.pathname.slice(prefix.length);
    const match = /^v\d+\/(class-management\/avatars\/(\d+)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.webp$/.exec(tail);
    return match && match[2] === String(userId) ? match[1]! : null;
  } catch {
    return null;
  }
}

export async function deleteAvatarImage(publicId: string) {
  const settings = getCloudinaryConfig();
  if (!settings) return false;
  try {
    const options = {
      ...settings, resource_type: 'image' as const, type: 'upload' as const, invalidate: true, timeout: 15_000,
    };
    const result = await cloudinary.uploader.destroy(publicId, options);
    return result.result === 'ok' || result.result === 'not found';
  } catch {
    return false;
  }
}

export async function uploadAvatarImage(buffer: Buffer, userId: number) {
  const settings = getCloudinaryConfig();
  if (!settings) throw new AvatarStorageError('not_configured');
  const publicId = `class-management/avatars/${userId}/${randomUUID()}`;
  let result: UploadApiResponse;
  try {
    result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        ...settings, public_id: publicId, resource_type: 'image', type: 'upload', format: 'webp',
        overwrite: false, timeout: 15_000,
      }, (error, response) => {
        if (error || !response) reject(new AvatarStorageError('upload_failed'));
        else resolve(response);
      });
      stream.on('error', () => reject(new AvatarStorageError('upload_failed')));
      stream.end(buffer);
    });
  } catch {
    throw new AvatarStorageError('upload_failed');
  }
  // overwrite:false có thể trả asset đã tồn tại; không cập nhật hoặc xóa asset này.
  if (result.existing === true) throw new AvatarStorageError('upload_failed');
  if (result.public_id !== publicId || typeof result.secure_url !== 'string'
    || getOwnedAvatarPublicId(result.secure_url, userId) !== publicId) {
    if (result.public_id === publicId && !await deleteAvatarImage(publicId)) {
      console.warn('Không thể dọn ảnh avatar sau response dịch vụ không hợp lệ');
    }
    throw new AvatarStorageError('upload_failed');
  }
  return { url: result.secure_url, publicId };
}
