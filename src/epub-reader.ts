import JSZip from 'jszip';
import { textPages } from './reader-state';
function xml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error('EPUB содержит неподдерживаемые XML-объявления.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw Error('Структура EPUB повреждена.');
  return doc;
}
function path(base: string, href: string) {
  if (/^[a-z]+:|^\/|\\/i.test(href)) throw Error('Некорректный путь EPUB.');
  const parts = (base + decodeURIComponent(href.split('#')[0])).split('/'),
    result: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      if (!result.length) throw Error('Некорректный путь EPUB.');
      result.pop();
    } else if (p && p !== '.') result.push(p);
  }
  return result.join('/');
}
export async function loadEpub(data: ArrayBuffer) {
  const zip = await JSZip.loadAsync(data),
    entries = Object.values(zip.files),
    expanded = entries.reduce(
      (n, f) =>
        n +
        ((f as unknown as { _data?: { uncompressedSize: number } })._data?.uncompressedSize || 0),
      0,
    );
  if (entries.length > 2000 || expanded > 40 * 1024 * 1024)
    throw Error('EPUB слишком большой для читалки.');
  if (zip.file('META-INF/encryption.xml')) throw Error('Зашифрованный EPUB не поддерживается.');
  const read = async (name: string) => {
    const f = zip.file(name);
    if (!f) throw Error('В EPUB отсутствует необходимый раздел.');
    return f.async('string');
  };
  if ((await read('mimetype')).trim() !== 'application/epub+zip')
    throw Error('Файл не является EPUB.');
  const container = xml(await read('META-INF/container.xml')),
    root = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!root) throw Error('Не найдено содержание EPUB.');
  const rootPath = path('', root),
    opf = xml(await read(rootPath)),
    base = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '',
    manifest = new Map<string, string>();
  for (const item of opf.getElementsByTagNameNS('*', 'item'))
    if (item.getAttribute('media-type') === 'application/xhtml+xml')
      manifest.set(item.getAttribute('id') || '', item.getAttribute('href') || '');
  let text = '';
  const spine = [...opf.getElementsByTagNameNS('*', 'itemref')];
  if (!spine.length || spine.length > 1000) throw Error('Некорректное оглавление EPUB.');
  for (const item of spine) {
    if (item.getAttribute('linear') === 'no') continue;
    const href = manifest.get(item.getAttribute('idref') || '');
    if (!href) throw Error('Раздел EPUB не поддерживается.');
    const doc = xml(await read(path(base, href)));
    for (const node of [...doc.getElementsByTagName('*')]) {
      if (['script', 'style', 'iframe', 'object'].includes(node.localName)) node.remove();
      else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'br'].includes(node.localName))
        node.append(doc.createTextNode('\n'));
    }
    const body = doc.getElementsByTagNameNS('*', 'body')[0];
    text += (body?.textContent || '').trim() + '\n\n';
    if (text.length > 2000000) throw Error('Текст EPUB слишком большой.');
  }
  if (!text.trim()) throw Error('В EPUB нет доступного текста.');
  return textPages(text);
}
