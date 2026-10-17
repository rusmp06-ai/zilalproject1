import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'studyhub-offline-shell',
      generateBundle(_options, bundle) {
        const files = [
          '/',
          ...Object.keys(bundle)
            .filter((f) => /\.(js|css)$/.test(f))
            .map((f) => '/' + f),
        ];
        const cache =
          'studyhub-shell-' + Object.keys(bundle).find((f) => /^assets\/index-.*\.js$/.test(f));
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `const CACHE=${JSON.stringify(cache)},FILES=${JSON.stringify(files)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('studyhub-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!(u.pathname==='/'||u.pathname.startsWith('/assets/')))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.open(CACHE).then(c=>c.match(u.pathname==='/'?'/':e.request,{ignoreVary:true})).then(r=>r||Response.error())));});`,
        });
      },
    },
  ],
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        codeSplitting:
          loadEnv(mode, '.', 'STUDYHUB_').STUDYHUB_SINGLE_FILE === '1' ? false : undefined,
      },
    },
  },
}));
