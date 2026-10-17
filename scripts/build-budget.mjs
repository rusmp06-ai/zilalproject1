import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const entry = Object.entries(manifest).find(([, v]) => v.isEntry);
if (!entry) throw Error('Missing build entry');
const visited = new Set(),
  files = new Set();
function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  files.add(chunk.file);
  for (const css of chunk.css || []) files.add(css);
  for (const imported of chunk.imports || []) visit(imported);
}
visit(entry[0]);
let js = 0,
  css = 0;
for (const file of files) {
  const bytes = gzipSync(await readFile('dist/' + file)).length;
  if (file.endsWith('.js')) js += bytes;
  else if (file.endsWith('.css')) css += bytes;
}
console.log(
  JSON.stringify(
    { initialJavaScriptGzip: js, initialCssGzip: css, limits: { js: 200000, css: 35000 } },
    null,
    2,
  ),
);
if (js > 200000 || css > 35000)
  throw Error('Initial download exceeds budget. Use lazy loading rather than raising the limit.');
if ([...files].some((f) => /pdf-reader|tesseract|ocr|pdf-optimize/.test(f)))
  throw Error('Optional document engines must not be initial dependencies');
