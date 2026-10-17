import { validateFile } from './files';
import type { IntakePublication, IntakeReservation } from './material-intake-types';
export type IntakeTransport = {
  prepare: (
    i: IntakePublication,
    file: File,
    mime: string,
    hash: string,
  ) => Promise<IntakeReservation>;
  upload: (r: IntakeReservation, file: File, mime: string) => Promise<void>;
  finish: (request: string) => Promise<string>;
};
export async function uploadIntake(transport: IntakeTransport, i: IntakePublication, file: File) {
  const mime = validateFile(file),
    hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  let r: IntakeReservation;
  try {
    r = await transport.prepare(i, file, mime, hash);
  } catch (e) {
    const err = e as Error & { code?: string };
    let message = err.message;
    if (err.code === 'PGRST202') message = 'Примените SQL v0.30 перед публикацией.';
    else if (/previous upload/.test(message))
      message =
        'Есть незавершённая загрузка. Продолжите её через помощника или удалите в управлении материалами.';
    else if (/budget/.test(message)) message = 'В хранилище недостаточно места.';
    else if (/Access denied|unavailable|Publisher required/.test(message))
      message = 'Права изменились. Обновите кабинет и проверьте доступ к публикации.';
    // A rejected retry does not prove an earlier reservation was never committed.
    throw Object.assign(Error(message), { canEdit: false });
  }
  if (r.published && r.result_id) return r.result_id;
  try {
    await transport.upload(r, file, mime);
  } catch {
    // Upload may have succeeded even though its HTTP response was lost.
    try {
      return await transport.finish(i.request);
    } catch {
      throw Error(
        'Публикация не завершена. Повторите её с теми же полями и файлом или отмените через помощника.',
      );
    }
  }
  try {
    return await transport.finish(i.request);
  } catch {
    throw Error(
      'Файл загружен, но публикация не подтверждена. Проверьте состояние или повторите публикацию — второй экземпляр не создастся.',
    );
  }
}
