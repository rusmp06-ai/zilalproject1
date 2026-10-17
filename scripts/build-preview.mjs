import { spawn } from 'node:child_process';
// Use a child environment rather than POSIX assignment syntax, including on Windows.
const child = spawn(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  env: {
    ...process.env,
    STUDYHUB_SINGLE_FILE: '1',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
  },
  stdio: 'inherit',
});
const code = await new Promise((resolve) => {
  child.on('error', () => resolve(1));
  child.on('close', (code) => resolve(code ?? 1));
});
if (code !== 0) process.exit(code);
await import('./make-preview.mjs');
