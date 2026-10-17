import { validateFile } from './files';
import type { AnalysisInput } from './material-intake-types';
function abort(signal: AbortSignal) {
  signal.throwIfAborted();
}
function base64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function prepareAnalysis(
  file: File,
  signal: AbortSignal,
): Promise<Omit<AnalysisInput, 'scopeCourse' | 'scopeGroup'>> {
  const mime = validateFile(file);
  abort(signal);
  const buffer = await file.arrayBuffer();
  abort(signal);
  const source_hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  abort(signal);
  const ext = file.name.split('.').at(-1)!.toLowerCase();
  if (ext === 'pdf') {
    const { PDFDocument } = await import('pdf-lib');
    let original;
    try {
      original = await PDFDocument.load(buffer, { updateMetadata: false });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith('Input document to `PDFDocument.load` is encrypted.')
      )
        throw error;
      // pdf-lib cannot decrypt PDFs. PDF.js can open permission-protected files
      // with an empty user password; render a readable excerpt instead of ignoring encryption.
      const { loadPdf } = await import('./pdf-reader');
      const task = loadPdf(new Uint8Array(buffer));
      const cancel = () => {
        void task.destroy();
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const pdf = await task.promise;
        const subset = await PDFDocument.create({ updateMetadata: false });
        for (let index = 1; index <= Math.min(3, pdf.numPages); index++) {
          abort(signal);
          const source = await pdf.getPage(index);
          const base = source.getViewport({ scale: 1 });
          const viewport = source.getViewport({
            scale: Math.min(1.5, Math.sqrt(4000000 / (base.width * base.height))),
          });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await source.render({ canvas, viewport }).promise;
          abort(signal);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) =>
                value ? resolve(value) : reject(Error('Не удалось подготовить страницу PDF.')),
              'image/jpeg',
              0.88,
            ),
          );
          const image = await subset.embedJpg(await blob.arrayBuffer());
          subset
            .addPage([base.width, base.height])
            .drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
          canvas.width = canvas.height = 0;
        }
        const bytes = await subset.save();
        abort(signal);
        if (bytes.length > 10 * 1024 * 1024)
          throw Error('Фрагмент PDF слишком большой для анализа.');
        return {
          source_hash,
          name: file.name,
          mime,
          data: base64(bytes),
          excerpted: pdf.numPages > 3,
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'PasswordException')
          throw Error(
            'Для открытия PDF нужен пароль. Загрузите копию без пароля или заполните поля вручную.',
          );
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
        await task.destroy();
      }
    }
    abort(signal);
    const count = original.getPageCount();
    if (!count) throw Error('В PDF нет страниц.');
    const subset = await PDFDocument.create({ updateMetadata: false });
    const pages = await subset.copyPages(
      original,
      Array.from({ length: Math.min(3, count) }, (_, i) => i),
    );
    for (const page of pages) subset.addPage(page);
    const bytes = await subset.save();
    abort(signal);
    if (bytes.length > 10 * 1024 * 1024) throw Error('Фрагмент PDF слишком большой для анализа.');
    return { source_hash, name: file.name, mime, data: base64(bytes), excerpted: count > 3 };
  }
  if (mime.startsWith('image/'))
    return {
      source_hash,
      name: file.name,
      mime,
      data: base64(new Uint8Array(buffer)),
      excerpted: false,
    };
  let text = '';
  if (ext === 'txt') text = new TextDecoder().decode(buffer);
  else {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files);
    const expanded = entries.reduce(
      (s, f) =>
        s +
        ((f as unknown as { _data?: { uncompressedSize: number } })._data?.uncompressedSize || 0),
      0,
    );
    if (entries.length > 2000 || expanded > 40 * 1024 * 1024)
      throw Error('Документ слишком сложный для безопасного анализа.');
    let paths: string[] = [];
    if (ext === 'docx') paths = ['word/document.xml'];
    else if (ext === 'pptx')
      paths = entries
        .map((f) => f.name)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    else if (ext === 'epub')
      paths = entries
        .map((f) => f.name)
        .filter((n) => /\.(xhtml|html|htm)$/i.test(n))
        .sort();
    else if (ext === 'xlsx')
      paths = entries
        .map((f) => f.name)
        .filter((n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        .sort();
    if (!paths.length) throw Error('Не удалось найти текст документа.');
    for (const path of paths) {
      abort(signal);
      const entry = zip.file(path);
      if (!entry) throw Error('Структура документа повреждена.');
      const raw = await entry.async('string');
      if (/<!DOCTYPE|<!ENTITY/i.test(raw))
        throw Error('Документ содержит неподдерживаемые XML-объявления.');
      const xml = new DOMParser().parseFromString(raw, 'application/xml');
      if (xml.querySelector('parsererror')) throw Error('Структура документа повреждена.');
      xml.querySelectorAll('script,style').forEach((e) => e.remove());
      const parts =
        ext === 'pptx'
          ? [...xml.getElementsByTagNameNS('*', 't')].map((e) => e.textContent)
          : ext === 'docx'
            ? [...xml.getElementsByTagNameNS('*', 'p')].map((e) => e.textContent)
            : [xml.documentElement.textContent];
      text += '\n' + parts.join('\n');
      if (text.length > 12000) break;
    }
  }
  text = text.replaceAll('\0', '').trim();
  if (!text) throw Error('Текст не найден. Загрузите PDF или изображение скана.');
  abort(signal);
  return {
    source_hash,
    name: file.name,
    mime: 'text/plain',
    text: text.slice(0, 12000),
    excerpted: text.length > 12000,
  };
}
