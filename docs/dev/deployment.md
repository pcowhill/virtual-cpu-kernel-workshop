# Deployment

The workbench is a static site with no backend. GitHub Actions builds, tests and deploys it to GitHub Pages:
<https://pcowhill.github.io/virtual-cpu-kernel-workshop/>.

## Pipeline (`.github/workflows/ci.yml`)

On every pull request and every push to `main`:

1. **validate**: `npm ci`, lint, format check, typecheck, unit, integration and component tests, production
   build (the `dist` folder is kept as an artifact).
2. **e2e**: installs Chromium and runs Playwright against the production build served by `vite preview`;
   reports and traces are kept as artifacts.

On pushes to `main` only, after both succeed:

3. **pages-build**: builds with `BASE_PATH=/<repository name>/` and uploads the Pages artifact.
4. **pages-deploy**: deploys it with `actions/deploy-pages` (environment `github-pages`).
5. **pages-smoke**: runs the Playwright smoke and offline tests against the deployed URL (`E2E_BASE_URL`).

## Base path

Vite's `base` comes from `BASE_PATH` and defaults to `/virtual-cpu-kernel-workshop/`; every asset reference,
the Web Worker URL, the manifest and the service worker scope are relative to it. To host elsewhere, build with
the right base, e.g. `BASE_PATH=/ npm run build`, and serve `dist/` as static files. No server-side routing is
needed: the app is a single page.

## Offline and updates

`scripts/service-worker.ts` is a Vite plugin that emits `sw.js` at build time. It precaches every file of the
build (except source maps) under a cache named after a hash of their contents. A new deployment therefore installs
a new service worker with a new cache; it waits until the user accepts the "Update available · reload" prompt,
then activates and deletes the old cache. Navigations inside the scope are answered with the cached app shell, so
the app starts offline.

## One-time repository settings

- **Settings → Pages → Source: GitHub Actions** (already configured).
- The `github-pages` environment is created by the first deployment.

## Local preview of the production build

```sh
npm run build
npx vite preview            # http://localhost:4173/virtual-cpu-kernel-workshop/
```
