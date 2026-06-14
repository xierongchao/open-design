// Wrapper around `next build` that selects the build mode from OD_WEB_OUTPUT_MODE.
//
// Why this exists
// ---------------
// Next.js 16 has a non-deterministic bug where statically prerendering the
// built-in `/_global-error` and `/_not-found` routes throws
// `Cannot read properties of null (reading 'useContext'/'useState')` and
// aborts the build (vercel/next.js#85668). The bug reproduces on a minimal
// empty app with React 18 and React 19, on next 16.0.1 through 16.3 canary,
// so it is not something this project can fix in application code.
//
// For the packaged runtime (OD_WEB_OUTPUT_MODE=standalone|server) this product
// is a client-driven SPA: every real route is a catch-all that mounts the UI
// client-side via `next/dynamic({ ssr: false })`. There is no value in static
// prerendering, so we build with `--experimental-build-mode=compile`, which
// emits the standalone server + static chunks but skips the prerender pass
// that triggers the bug. All routes become dynamic (server-rendered on
// demand), which is exactly what the SPA shell needs.
//
// The default CLI static export (no OD_WEB_OUTPUT_MODE) still runs the full
// `next build` so the daemon can serve `out/`. That path is unaffected here.

import { spawnSync } from 'node:child_process';

const mode = process.env.OD_WEB_OUTPUT_MODE;
const isServerRuntime = mode === 'standalone' || mode === 'server';

const args = ['build'];
if (isServerRuntime) {
  args.push('--experimental-build-mode=compile');
}

const result = spawnSync('next', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
