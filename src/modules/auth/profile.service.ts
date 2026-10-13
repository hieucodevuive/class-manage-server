import { getCloudinaryConfig } from '../../config/cloudinary';
import { findUserProfileState, findUserById, updateUserProfile } from './auth.repository';
import { serializeUser } from './auth.response';
import type { UpdateProfileInput } from './auth.schema';
import { AvatarImageError, normalizeAvatarImage } from './avatar.image';
import { AvatarStorageError, deleteAvatarImage, getOwnedAvatarPublicId, uploadAvatarImage } from './avatar.storage';

async function cleanup(publicId: string) {
  if (!await deleteAvatarImage(publicId)) console.warn('Không thể dọn ảnh avatar; cần kiểm tra tài nguyên trên dịch vụ lưu ảnh');
}

export async function updateCurrentUserProfile(userId: number, data: UpdateProfileInput, file?: { buffer: Buffer; mimetype: string }) {
  let previous;
  try {
    previous = await findUserProfileState(userId);
  } catch {
    return { status: 'persistence_failed' } as const;
  }
  if (!previous) return { status: 'not_found' } as const;
  if (previous.status !== 'ACTIVE') return { status: 'pending' } as const;
  let uploaded: Awaited<ReturnType<typeof uploadAvatarImage>> | undefined;
  if (file) {
    if (!getCloudinaryConfig()) return { status: 'not_configured' } as const;
    let image: Buffer;
    try {
      image = await normalizeAvatarImage(file);
    } catch (error) {
      return { status: 'invalid_image', message: error instanceof AvatarImageError ? error.message : 'File ảnh không hợp lệ' } as const;
    }
    try {
      uploaded = await uploadAvatarImage(image, userId);
    } catch (error) {
      return { status: error instanceof AvatarStorageError && error.kind === 'not_configured' ? 'not_configured' : 'upload_failed' } as const;
    }
  }

  let user;
  try {
    // Một câu UPDATE lưu cả hai field; không sửa name trước khi upload thành công.
    user = await updateUserProfile(userId, {
      ...(data.name === undefined ? {} : { name: data.name }),
      ...(uploaded ? { avatar: uploaded.url } : {}),
    }, previous.avatar);
  } catch {
    // Lỗi kết nối có thể xảy ra sau commit. Không xóa ảnh khi chưa xác định
    // trạng thái ghi, tránh làm hỏng URL đã được lưu vào User.
    try {
      const current = await findUserById(userId);
      // URL mới là marker của một UPDATE atomic chứa cả name và avatar.
      // Name có thể đã được request khác đổi tiếp sau commit đó.
      if (current && (uploaded ? current.avatar === uploaded.url : current.name === data.name)) user = current;
    } catch {
      // Giữ ảnh mới khi không đọc được trạng thái commit.
    }
    if (!user) {
      console.warn('Chưa xác nhận được việc lưu thông tin tài khoản; giữ ảnh mới nếu có để tránh xóa ảnh đang được sử dụng');
      return { status: 'persistence_failed' } as const;
    }
  }

  if (!user) {
    // CAS không khớp chắc chắn chưa ghi URL mới, nên có thể dọn candidate.
    if (uploaded) await cleanup(uploaded.publicId);
    try {
      const current = await findUserProfileState(userId);
      if (!current) return { status: 'not_found' } as const;
      if (current.status !== 'ACTIVE') return { status: 'pending' } as const;
      return { status: 'conflict' } as const;
    } catch {
      return { status: 'persistence_failed' } as const;
    }
  }

  if (uploaded) {
    const previousId = getOwnedAvatarPublicId(previous.avatar, userId);
    if (previousId && previousId !== uploaded.publicId) await cleanup(previousId);
  }
  return { status: 'updated', user: serializeUser(user) } as const;
}
