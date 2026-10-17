export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const extensions: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const FILE_ACCEPT = '.epub,.pdf,.txt,.jpg,.jpeg,.png,.webp,.docx,.pptx,.xlsx';
export function validateFile(file: { name: string; size: number; type: string }) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '',
    mime = extensions[ext];
  if (!mime)
    throw Error('Поддерживаются EPUB, PDF, DOCX, PPTX, XLSX, TXT и изображения JPG, PNG, WebP.');
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw Error('Размер файла должен быть от 1 байта до 10 МБ.');
  if (file.name.length > 240) throw Error('Название файла слишком длинное.');
  if (file.type && file.type !== mime && file.type !== 'application/octet-stream')
    throw Error('Тип файла не соответствует расширению.');
  return mime;
}
export function sizeLabel(bytes: number) {
  return bytes < 1024
    ? bytes + ' Б'
    : bytes >= 1048576
      ? (bytes / 1048576).toFixed(1) + ' МБ'
      : Math.max(1, Math.round(bytes / 1024)) + ' КБ';
}
