# packages/docs — NOT the docs the app serves

> **This package is not built, not deployed, and not referenced by the root `build`
> script.** It is a standalone Next.js/fumadocs site that was never wired up.

**The documentation users actually read lives in
[`packages/frontend/public/docs-content/`](../frontend/public/docs-content/).**
`DocsPage.tsx` fetches those `.md` files at runtime and renders them at `/docs/<slug>`.

## Why this matters

The content here is a **stale copy**. When it was last audited it still described an App
Runner backend (the backend has been ECS Fargate behind an ALB for some time), claimed 15
processing methods (there are 29), called the workflow "5-step" (it has 4 steps), and
documented a Nova 2 Pro model that was removed because its id was not resolvable in any
region. None of that reached users — because nothing serves this directory — but anyone
reading the repo would reasonably assume it was current.

## If you are editing documentation

Edit `packages/frontend/public/docs-content/*.md`. Nothing else is served.

If you want a standalone docs site, this package is a reasonable starting point, but treat
its content as an old snapshot and re-derive the facts from the code first. Duplicating
prose across two trees is what produced the drift above; prefer generating this site from
`docs-content/` over maintaining a second copy by hand.
