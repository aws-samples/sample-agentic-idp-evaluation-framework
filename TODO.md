# ONE IDP — status and remaining work

Snapshot of what has been fixed, what is verified, and what is still open.
Everything under "Done" is committed on `main` and deployed to both the
Terraform and CDK stacks.

## How to verify

```bash
# SITE=$(cd infrastructure && terraform output -raw site_url)
curl -sS "$SITE/api/health"      # liveness
curl -sS "$SITE/api/methods"     # catalog + per-deployment availability
curl -sS "$SITE/api/runs"        # run history
curl -sS "$SITE/api/health/detailed"   # model id, BDA, guardrail config
```

Local: `npm run dev -w packages/backend` + `npm run dev -w packages/frontend`
(needs a root `.env`; frontend serves on **5180**, backend on 3001).

---

## Done

### Models
- **Claude Opus 5 added** (`us.anthropic.claude-opus-5`) as a first-class method.
- **Orchestration moved to Opus 5.** `config.claudeModelId` previously defaulted
  to Sonnet 4.6 (not Opus 4.6 as assumed). Agents, pipeline chat, smart pipeline
  and architecture/code generation all use it.
- **Nova 1 Pro removed.** Nova is represented only by Nova 2 Lite; `nova-pro` and
  `textract-nova-pro` are gone. The old `nova-2-pro-preview-*` id was not
  resolvable in any region, so every run using it failed.
- **`temperature` guard centralized** (`buildInferenceConfig`). Opus 5 / 4.8 /
  4.7 and Sonnet 5 reject the param; without this the Opus 5 switch would have
  400'd every agent and orchestration call.

### Latency (the original "preview takes far too long" report)
- Root cause was **not** serial execution — the fan-out was already parallel. One
  method was generating to the output ceiling (16.6k tokens, 161.8s) and holding
  the whole SSE run.
- Added a **60s per-method timeout** and a **document-scaled preview output cap**
  (1,500/capability + 1,200/page, ceiling 32k). A 30-page report is not
  truncated; a runaway is still bounded.
- **Measured live: 19 methods in 16.2s** (Nova 2 Lite 6.9s, Opus 5 7.9s).

### Pipeline correctness
- **Page Classifier now actually runs.** It was drawn on the canvas and
  described as "Route by content type" but the executor only handled `method` and
  `sequential-composer` nodes. Live: `page classifier: 1 mixed in 1696ms`.
- **Aggregator now honours its strategy.** The canvas showed
  best-confidence/best-cost/best-speed while the executor merged with
  `Object.assign` — whichever method finished last silently won. Results are now
  resolved per capability, empty answers cannot beat real extractions, and the
  winning method is recorded (`sourceMethod`) and shown in a "Final result" tab.
- **Missing processors registered.** `pipeline.ts` lacked Opus 4.8/4.7, Sonnet 5
  and all four GPT tiers, so a pipeline that selected them died with "No
  processor for method" even though `/preview` offered them. A parity test now
  pins the three registries together.

### Data / history
- **Run history works.** Two bugs: the table's sort key is named
  `timestamp#type` but the code wrote `sk`; and nested `undefined` values inside
  processor results made the marshaller reject the whole write. Both fixed
  (`removeUndefinedValues`, `#sk` expression alias). `/api/runs` returns real runs.
- **Activity table is created.** Terraform defaulted `manage_activity_table` to
  false while still pointing `ACTIVITY_TABLE` at a table it never made.
- **BDA works out of the box.** Both stacks derive the account's built-in
  data-automation profile ARN instead of leaving it empty.
- `/api/feedback/status` no longer 500s.

### State
- Moved from `sessionStorage` to `localStorage`, so closing the tab no longer
  destroys an in-progress evaluation. Corrupt entries self-heal; quota failures
  do not break the app.
- **`runId` is captured and persisted**, so a completed run is recoverable from
  DynamoDB even if browser storage is cleared or the backend restarts.
- **ResumeBanner** makes restored state visible: which document, how far it got,
  its run id, with explicit *Continue* / *Start over*.

### UX
- **Landing page restructured: upload is the hero.** It used to sit below two
  long reference catalogs (33 capabilities, 22 methods) — three screens down.
  Catalogs are now collapsed `ExpandableSection`s.
- **Dark mode actually works.** `index.html` hardcoded the page background and
  only honoured the OS `prefers-color-scheme`, so the in-app toggle recoloured
  components but left the page white.
- **Two-column layouts no longer stack on laptops.** They split at `l`, but the
  260px side nav pushes the content area under `l` at 1440px. Now `m`.
- **False "Done" badges fixed.** Progress was inferred from the URL, so
  deep-linking to `/architecture` marked earlier steps complete with no document.
- **Dead-end empty states replaced** with `StepGate` (states what is missing and
  renders the action that unblocks it).
- **"Skip questions, use defaults"** added — the advisor asks 3-5 questions and
  until it finished there was no forward action at all.
- **BDA / Guardrails no longer read as peer models.** Methods are grouped by role
  and unavailable ones are labelled with the reason.
- `pdf_conversion` / `format_standardization` are marked **Preprocessing**, no
  longer auto-selected, and no longer injected into model prompts.
- Step labels ("Step 2 of 4 · invoice.pdf · 1 page") on every step page.
- `ResultBlock` replaces raw `<pre>` blocks that were unreadable in dark mode.

### Safety
- Site-wide non-dismissible demo disclaimer (no SLA, no PII/PHI/financial data,
  not an AWS product).
- The PII prohibition is stated **once**, in that banner, in full. The upload
  control previously repeated a longer version of it directly below, so the same
  warning appeared twice on one screen; it now carries a one-line reminder.

### Code quality
- One shared availability service (`method-availability.ts`) replaces the same
  filter logic copy-pasted into three routes with subtle differences.
- Deduplicated `parseResults` across two adapters (the copies had drifted to
  different default confidence values).
- `.dockerignore` added — stale host `dist`/`tsbuildinfo` were breaking the
  container build.
- **176 tests pass** (111 at the start of this work, 8 of them failing).

---

## Not done

### Verified-real but incomplete
- [ ] **UX polish is partial.** Landing, headers, empty states and dark mode are
      done. Steps 2-4 still need spacing/density/hierarchy work.
- [ ] **Hardcoded hex colours remain** in ~12 files, mostly pipeline canvas nodes.
      Some are intentional brand colours; each needs a judgement call.
- [ ] A React "unique key prop" warning appears on `/architecture`. Cosmetic,
      pre-existing, source not yet located.

### Deliberately not changed
- [ ] `bda-custom` is left unconfigured (you asked not to wire it). It correctly
      reports "Needs a custom blueprint project".
- [ ] **AgentCore + Strands confirmed correct — no change made.**
      CloudFront → ECS (Express) → AgentCore runtime → Strands `Agent`.
      Verified live: `[Conversation] Invoking AgentCore runtime: …` The
      "direct in-process agent" log seen earlier was the *local* dev server,
      which has no `AGENTCORE_RUNTIME_ARN`.
- [ ] Opus 5 features from the notebook (adaptive `effort`, task budgets,
      context compaction, mid-conversation tool changes) are **not** wired.
      Thinking is on by default so Opus 5 already benefits; exposing
      `output_config.effort` as a per-method option is a separate change.

### Next session — start here
1. **Continue UX polish on steps 2-4** (the largest remaining item). Landing is
   done; Analyze / Pipeline / Architecture still need spacing, density and
   hierarchy work. Read the screenshots approach below rather than guessing.
2. **Verify by driving the running app, not by reading code.** Several bugs in
   this round (dark mode, stacked columns, decorative classifier, the DynamoDB
   key mismatch) were invisible in the source and only showed up live. Pattern
   that worked:
   ```bash
   npm run dev -w packages/backend & npm run dev -w packages/frontend &
   # then Playwright against http://localhost:5180, screenshot, and read
   # CloudWatch / the dev log for the matching server-side error
   ```
   Beware two traps: headless Chromium does not render PDF iframes (a blank
   preview box is not a bug), and full-page screenshots move sticky elements
   (measure the viewport instead).
3. **Do not trust `finch build` exit 0.** It returns 0 when the VM is stopped and
   when the disk is full. Check the log tail for `exporting manifest`, and check
   the image digest actually changed.
4. Deploy order that works: build image → push to both ECRs → `force-new-deployment`
   on both services → wait for `COMPLETED` → verify `/api/health` and
   `/api/methods` on both stacks.

### Open questions / risks
- [ ] `format_standardization` is documented as reference-only because nothing
      implements it. Either implement it or remove the capability.
- [ ] The advisor interview takes 3-5 turns before recommending. "Skip" is now
      the escape hatch, but the interview itself could be shortened.
- [ ] 126 dependabot vulnerabilities (2 critical) on the public repo. Pre-existing
      and untouched by this work.
- [ ] Both stacks running idle cost roughly **$160/month** (2× NAT, 2× ALB,
      4× Fargate). Destroy when not demoing.
