export type AccountDetails = {
  email: string;
  confirmed: boolean;
  avatar: string;
  university: string;
  faculty: string;
  specialty: string;
  year: string;
};
export type AccountInput = Omit<AccountDetails, 'email' | 'confirmed'>;
export function accountInput(value: Partial<AccountInput>): AccountInput {
  const result = {} as AccountInput;
  for (const key of ['university', 'faculty', 'specialty', 'year'] as const) {
    const s = String(value[key] || '').trim();
    if (s.length > 150) throw Error('Учебные сведения: не более 150 символов.');
    result[key] = s;
  }
  const avatar = String(value.avatar || '');
  if (
    avatar &&
    (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) || avatar.length > 120000)
  )
    throw Error('Выберите небольшое фото PNG, JPG или WebP.');
  result.avatar = avatar;
  return result;
}
export function profileName(name: string) {
  const s = name.trim();
  if (!s || s.length > 150) throw Error('Имя должно содержать от 1 до 150 символов.');
  return s;
}
export async function avatarFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw Error('Фото: PNG, JPG или WebP, до 5 МБ.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Не удалось обработать фото.');
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      192,
      192,
    );
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    bitmap.close();
  }
}
