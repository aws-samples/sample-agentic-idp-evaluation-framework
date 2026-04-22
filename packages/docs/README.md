# @idp/docs

Customer-facing documentation site for ONE IDP. Built with [Fumadocs](https://fumadocs.dev/) + Next.js (static export) and served at `/docs` on the same domain as the main app.

## Dev (two options)

**Option 1 — standalone Next dev server.** Hot reload, richest DX.

```bash
npm install                       # from repo root, installs this workspace too
npm run dev -w packages/docs      # http://localhost:3001/docs
```

**Option 2 — bundled into the backend at `http://localhost:3001/docs`.** The backend's `express.static` picks up `packages/docs/out` when it exists. Good for end-to-end local testing across the SPA + API + docs.

```bash
npm run build -w packages/docs    # one-time (or after content edits)
npm run dev                       # repo-root: starts backend and SPA, docs available at :3001/docs
```

## Build

```bash
npm run build -w packages/docs    # emits packages/docs/out/ with basePath=/docs
# Optional: embed the canonical domain in OG/canonical/llms.txt URLs.
NEXT_PUBLIC_SITE_URL="https://your-domain.example" npm run build -w packages/docs
```

When `NEXT_PUBLIC_SITE_URL` is unset the site works on any host — canonical URLs are emitted as relative paths.

## Deploy

```bash
aws s3 sync packages/docs/out s3://<your-static-bucket>/docs/ --delete
aws cloudfront create-invalidation --distribution-id <your-distribution-id> --paths '/docs/*'
```

## Adding a page

1. Create `content/docs/<slug>.mdx` with frontmatter `title` + `description`.
2. Add the slug to `content/docs/meta.json` to control sidebar order.
3. Run `npm run dev -w packages/docs` and verify the page renders.
