import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const singleFile = loadEnv(mode, '.', 'STUDYHUB_').STUDYHUB_SINGLE_FILE === '1';
  return {
    resolve: {
      alias: {
        'studyhub-pdf-worker':
          fileURLToPath(
            new URL('./node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
          ) +
          '?worker' +
          (singleFile ? '&inline' : ''),
        'studyhub-optimizer-worker':
          fileURLToPath(new URL('./src/pdf-optimize.worker.ts', import.meta.url)) +
          '?worker' +
          (singleFile ? '&inline' : ''),
      },
    },
    optimizeDeps: { exclude: ['studyhub-pdf-worker', 'studyhub-optimizer-worker'] },
    plugins: [
      react(),
      {
        name: 'studyhub-offline-shell',
        generateBundle(_options, bundle) {
          const files = [
            '/',
            ...Object.entries(bundle)
              .filter(([name, asset]) => {
                if (name.endsWith('.css') || name.startsWith('assets/pdf.worker.')) return true;
                if (asset.type !== 'chunk') return false;
                return !Object.keys(asset.modules).some((id) =>
                  /\/src\/(ocr|pdf-optimize)[./]|\/node_modules\/tesseract/.test(id),
                );
              })
              .map(([name]) => '/' + name),
          ];
          const entry = Object.values(bundle).find(
            (asset) => asset.type === 'chunk' && asset.isEntry,
          )?.fileName;
          const source = readFileSync(
            new URL('./scripts/service-worker.js', import.meta.url),
            'utf8',
          )
            .replace('__CACHE__', JSON.stringify('studyhub-shell-' + entry))
            .replace('__FILES__', JSON.stringify(files));
          this.emitFile({ type: 'asset', fileName: 'sw.js', source });
        },
      },
    ],
    build: {
      target: 'es2022',
      manifest: true,
      rolldownOptions: {
        output: {
          codeSplitting: singleFile
            ? false
            : {
                groups: [
                  { name: 'react-vendor', test: /node_modules\/(react|react-dom|scheduler)\// },
                  { name: 'supabase-vendor', test: /node_modules\/@supabase\// },
                ],
              },
        },
      },
    },
  };
});
