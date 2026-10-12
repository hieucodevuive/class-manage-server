import { getCloudinaryConfig } from '../../config/cloudinary';
import { findUserAvatarState, findUserById, updateUserAvatar } from './auth.repository';
import { serializeUser } from './auth.response';
import { AvatarImageError, normalizeAvatarImage } from './avatar.image';
import { AvatarStorageError, deleteAvatarImage, getOwnedAvatarPublicId, uploadAvatarImage } from './avatar.storage';

async function cleanup(publicId: string) {
  if (!await deleteAvatarImage(publicId)) console.warn('Không thể dọn ảnh avatar; cần kiểm tra tài nguyên trên dịch vụ lưu ảnh');
}

export async function updateCurrentUserAvatar(userId: number, file: { buffer: Buffer; mimetype: string }) {
  let previous;
  try {
    previous = await findUserAvatarState(userId);
  } catch {
    return { status: 'persistence_failed' } as const;
  }
  if (!previous) return { status: 'not_found' } as const;
  if (previous.status !== 'ACTIVE') return { status: 'pending' } as const;
  if (!getCloudinaryConfig()) return { status: 'not_configured' } as const;

  let image: Buffer;
  try {
    image = await normalizeAvatarImage(file);
  } catch (error) {
    return { status: 'invalid_image', message: error instanceof AvatarImageError ? error.message : 'File ảnh không hợp lệ' } as const;
  }
  let uploaded;
  try {
    uploaded = await uploadAvatarImage(image, userId);
  } catch (error) {
    return { status: error instanceof AvatarStorageError && error.kind === 'not_configured' ? 'not_configured' : 'upload_failed' } as const;
  }

  let user;
  try {
    user = await updateUserAvatar(userId, previous.avatar, uploaded.url);
  } catch {
    // Lỗi kết nối có thể xảy ra sau commit. Không xóa ảnh khi chưa xác định
    // trạng thái ghi, tránh làm hỏng URL đã được lưu vào User.
    try {
      const current = await findUserById(userId);
      if (current?.avatar === uploaded.url) user = current;
    } catch {
      // Giữ ảnh mới khi không đọc được trạng thái commit.
    }
    if (!user) {
      console.warn('Chưa xác nhận được việc lưu avatar; giữ ảnh mới để tránh xóa ảnh đang được sử dụng');
      return { status: 'persistence_failed' } as const;
    }
  }

  if (!user) {
    // CAS không khớp chắc chắn chưa ghi URL mới, nên có thể dọn candidate.
    await cleanup(uploaded.publicId);
    try {
      const current = await findUserAvatarState(userId);
      if (!current) return { status: 'not_found' } as const;
      if (current.status !== 'ACTIVE') return { status: 'pending' } as const;
      return { status: 'conflict' } as const;
    } catch {
      return { status: 'persistence_failed' } as const;
    }
  }

  const previousId = getOwnedAvatarPublicId(previous.avatar, userId);
  if (previousId && previousId !== uploaded.publicId) await cleanup(previousId);
  return { status: 'updated', user: serializeUser(user) } as const;
}
