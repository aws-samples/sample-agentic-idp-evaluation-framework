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

**Full path, against a real deployment** — this is the check that has actually
caught things (hybrid cost, media routing); unit tests did not:

```bash
BASE="$SITE" node scripts/e2e-live.mjs sample.pdf sample.png
# upload -> preview (SSE) -> pipeline generate -> execute (SSE)
# verifies parallel fan-out, non-zero costs, hybrid fees, real extracted data
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
- Added a **document-scaled preview output cap** (1,500/capability + 1,200/page,
  ceiling 32k). A 30-page report is not truncated; a runaway is still bounded.
- A per-method timeout bounds a hang. It was first set to 60s, which proved far
  too aggressive on real documents — see "Preview UX" below; it is now 5 minutes.
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
- **Loading a run no longer mixes two documents.** Each field in `handleLoadRun`
  was restored only `if (run.x)`, so anything the loaded run lacked kept the
  previous evaluation's value — a preview-only run loaded after a pipeline run
  showed the earlier document's comparison, canvas and run id as its own, and
  step 4 generated code for methods that run never used. All fields are now
  assigned unconditionally.
- **Step 3 is only "Done" when a pipeline actually ran.** It was inferred from
  `processingResults`, which is also non-empty for a preview-only run.
- **`/pipeline` is no longer a dead end after loading a run.** Auto-generation
  needs `document.documentType`, which the reconstructed document lacked, so
  neither branch fired and the page rendered nothing — no canvas, no error, no
  spinner. The type is re-derived from the file name, plus a visible
  "Build pipeline" backstop.
- **Refreshing `/conversation` no longer re-bills every method.** `previewData` was
  persisted but never fed back into `usePreview`, so the auto-run effect saw no
  preview and re-ran all ~19 methods on every reload.
- **"Start over" no longer resets preferences.** It cleared every `idp-`-prefixed
  key, including dismissals, so the onboarding banner came back.

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
- **Preview results now stream in as each method finishes.** The backend already
  sent each result over SSE the moment it landed, but the UI rendered nothing until
  *all* methods completed — so a genuinely parallel 16s run whose fastest model
  answered in 7s looked like 16 seconds of a blank screen. `PreviewProgress` shows
  every method as a chip that resolves live, with the fastest time so far, and the
  comparison table appears as soon as one method succeeds.
- **Dark mode is actually fixed, not apparently fixed.** Cloudscape *hashes* its
  CSS custom-property names (`--color-border-divider-default-nr68jt`), so every
  hand-written `var(--color-border-divider-default, #e9ebed)` in the codebase never
  resolved and always used the light literal — including inside `ResultBlock`,
  the component written to fix dark-mode readability. Colours now come from
  `theme/tokens.ts`, which re-exports the real tokens from
  `@cloudscape-design/design-tokens`. Worst offenders fixed: extraction panels and
  the preview summary bar (~1.6:1 contrast).
- **One action, one button.** "Build pipeline" appeared up to three times at once
  (page header, comparison header, and a separate CTA container) with three
  different labels; the header now yields to the comparison once results exist.
- **`ColumnLayout columns={array.length}`** was passed values of 0 and 19 where
  Cloudscape supports 1-4. The preview grid is now a reflowing CSS grid, and the
  architecture summary is clamped.
- **`<Table>` rows have `trackBy`** — its absence was the source of the React
  "unique key prop" warning on `/architecture`.
- **Unknown paths render a real 404.** There was no catch-all route, so any
  unmatched path — including `/admin` and `/survey-results` for every non-admin
  user — rendered a completely blank content area.
- **The pipeline canvas legend only lists stages that exist.** It hardcoded all
  six, so a single-method pipeline advertised Classify and Aggregate stages that
  were not on the canvas and never ran.
- **A rejected upload says why.** An unsupported type or oversized file reached the
  generic error handler and returned HTTP 500 `{"error":"Internal server error"}`;
  it is now 415/413 with an actionable message. The filter also accepts a file
  whose MIME type is missing or `application/octet-stream` but whose extension is
  supported — common for `.csv` and for scripted uploads.

### First-run experience: naming, catalog completeness, copy (2026-07-25)

Reviewed as a first-time user walking steps 1 → 4. Three defects, all invisible from
the source and all on the first screen.

- **SEVEN of 29 methods were missing from the landing page.** The header counted
  `METHODS.length` (29) while the body rendered only families listed in a
  hand-maintained `FAMILY_GROUPS` array. The two new families
  (`video-understanding`, `sagemaker-ocr`) were in no group, so their methods
  rendered nowhere — no crash, no warning, just a count that disagreed with the list
  under it. Grouped properly, and an `UNGROUPED_FAMILIES` bucket now renders any
  future family ungrouped-but-visible rather than dropping it.
- **The product had SIX names.** Tab title "IDP Evaluation Framework", top nav "ONE
  IDP Framework", hero "IDP Evaluation Framework", splash "Loading ONE IDP", docs
  sidebar "ONE IDP Docs", feedback modal "the ONE IDP evaluation platform", and
  generated code headers "ONE IDP Platform" — a name used nowhere else, in a
  customer-facing artifact. Now one `PRODUCT_NAME` in
  `shared/src/constants/branding.ts`, with `index.html` (which cannot import it)
  pinned by a test.
- **Nav labels and page titles disagreed.** Nav said "Analyze & Preview" / "Pipeline";
  the pages titled themselves "Document Analysis" / "Pipeline Builder". Clicking a nav
  item opened a page with a different name. `WORKFLOW_STEPS` in
  `shared/src/constants/steps.ts` now defines each step's title, description, gate
  copy and number once; `stepSubtitle()` derives "Step 2 of 4 · invoice.pdf · 6 pages"
  from position rather than a hardcoded string per page.
- Step descriptions rewritten as outcomes rather than mechanics — "Start with one real
  document … everything after this is measured against your document, not a sample"
  instead of "Upload any document — PDF, image, Word…".

### Diagram generation: two reproducible render failures fixed

Verified against the real Mermaid parser, not guessed:

1. **A ```mermaid fence inside `<diagram>` tags** → "No diagram type detected". The
   model wraps the diagram even though the tags already delimit it, so the first line
   is the fence rather than `graph TD`.
2. **Unquoted parentheses in a label** → hard "Parse error on line 2". `A[Textract
   (OCR)]` is invalid because Mermaid reads `(` as shape syntax — and model names and
   costs hit this constantly ("Txt+Nova 2 Lite", "$0.0015/pg", "Step 1: Upload").

Either produced "Diagram render failed" with the raw source dumped below it, which
reads as a broken feature. Fixed at **both** ends: the prompt now states the two rules
with a correct example, and `sanitizeMermaid()` repairs the output anyway because the
model will still slip. A valid diagram passes through byte-identical.

Worth recording: my first sanitizer regex matched a character class of opening
delimiters, so the `(` inside the label was taken as the opener and it emitted
`A["Textract (OCR")]` — still broken, differently. Anchoring on `[`…`]` fixed it, and
that specific regression is now a test, because it would otherwise look correct.

### Security: unauthenticated config disclosure closed

`/api/health` is mounted BEFORE the auth middleware so a load balancer can reach it —
which on the public demo means anyone can. `/api/health/detailed` was echoing the live
configuration back to an anonymous caller:

- the **S3 bucket name holding uploaded documents**
- the region, and the exact Claude and Nova model ids
- in plain language, **"Auth disabled (AUTH_PROVIDER=none)"** — the single most useful
  sentence to hand someone probing a public URL

It now reports whether each thing is *configured*, never what it is set to. Every
diagnostic use survives (an operator needs to know which check fails, not to be told
the bucket name they own). Verified live on both stacks: no bucket name, no region, no
model id, no auth status. `/api/methods` was already clean; `/api/admin/*` already 403.
`public-endpoint-leakage.test.ts` pins each removed value and also asserts `/features`
stays a single boolean rather than growing into a config dump.

### Run history disabled on shared deployments (SECURITY)

**Document disclosure between strangers.** With `AUTH_PROVIDER=none` every visitor
authenticates as the same alias (`local-user`), so `getRecentRuns(user.alias)` returns
ONE shared list. On the public CloudFront demo that meant any visitor could list, open
and *resume* the documents another person uploaded — and one person's evaluation could
be contaminated with someone else's file.

- **Refused server-side**, at the API: `GET /api/runs` and `GET /api/runs/:runId` both
  return 403 before any DynamoDB read. Hiding the nav link is not a security control —
  the endpoints stay callable. Guarding only the list would leave records readable to
  anyone who had seen a runId.
- **Admins are NOT exempt.** On a demo with authentication disabled anyone could claim
  an admin alias, so an exemption would be the same hole with extra steps.
- **Defaults to ON** (`disableRunHistory`), because the unsafe configuration —
  no auth, shared alias — is also the default one. Terraform `disable_run_history` and
  CDK `-c disableRunHistory` both default true; turning history on requires an explicit
  opt-out and should only be done with real per-user auth.
- **The client fails closed:** it assumes disabled until `/api/health/features` says
  otherwise, so a failed fetch cannot advertise history the server will refuse. The
  `/runs` route, the nav entry and the "evaluation in progress" resume banner are all
  hidden.
- Pinned by `run-history-privacy.test.ts`, including the guard-before-read ordering,
  the no-admin-exemption property, and that both IaC defaults match the code default.

### Specialist OCR + purpose-built video: 7 new methods, matrix now 33 x 29

**TwelveLabs Pegasus (`twelvelabs-pegasus`)** — and a correction: an earlier round
recorded Pegasus as "not addable in us-west-2". **That was wrong.** It failed because
the probe used Converse (which Pegasus does not serve) and the bare model id (which has
no on-demand throughput). With `InvokeModel` + the `us.` inference profile it works,
and on the 9s ground-truth mp4 it returned all three strings **with timestamps** —
better than any Converse model on the same file. Catalog confirms 30 regions including
us-west-2. Marengo remains genuinely unavailable (us-east-1 / eu-west-1 / ap-northeast-2
only). Lesson: verify the *transport* before concluding a model is absent.

**Pegasus verified end to end through the deployed stack** — and running it found two
more bugs that a direct SDK probe could not, which is the whole argument for the
"exercise it, don't just read it" rule:

1. **`bucketOwner` is REQUIRED, not optional.** I sent it only when `AWS_ACCOUNT_ID`
   was set; the container does not set it, so every call failed with
   `$.mediaSource.s3Location: required property 'bucketOwner' not found`. Now resolved
   from STS `GetCallerIdentity` (cached), so it cannot silently go missing again.
2. **Availability filtered it out entirely.** The video gate keyed on
   `CONVERSE_MULTIMODAL_FAMILIES`, so a model that reads video through `InvokeModel`
   could never be offered no matter what the matrix said. That set is now
   `VIDEO_CAPABLE_FAMILIES = {nova, video-understanding}` — and **`claude` was removed
   from it**, since it still listed the tiers that demonstrably reject the video block.
   The stale test asserting `claude-sonnet` was available for video is corrected too.

Live result on the ground-truth mp4: **6 methods, 0 errors, Pegasus 3/3 at 5.6s for
$0.0018** — second-fastest overall and 5-30x cheaper than every BDA path, with
timestamps none of the others produce.

**Six specialist OCR models on self-hosted SageMaker endpoints** (`sagemaker-ocr`
family): Infinity-Parser2, Baidu Unlimited-OCR, Surya 2, Chandra 2, dots.ocr, Qwen3-VL.
Every strength/limitation in the catalog is **measured over 336 real scanned pages**
(the hybrid vision + spatial reasoning benchmark), not taken from a model card:

- **Infinity-Parser2 (35B) is the only model that splits every dense grid** — 5/5 on
  the hardest pages where the others collapse them.
- **Aggregate F1 is misleading here.** Surya and Chandra score 0.670 on recall 0.96 /
  precision 0.51 while *failing* dense grids entirely; dots has the best precision but
  loops to 29K+ characters without an EOS and never finished the benchmark.
- **Baidu and Infinity are complementary** — Baidu handles ~70% of pages cheapest,
  Infinity recovers exactly the ones Baidu collapses. That is why the reference
  production shape is `Baidu -> free geometry judge -> Infinity fallback -> arbitrate`
  rather than any single model. Worth borrowing for our aggregator (see open items).
- **Cost is GPU-hours, not tokens**: $0.0085/image on ml.g6e.2xlarge (cheapest),
  $0.0122 on ml.g7e.4xlarge (faster wall-clock, 31% more per image). Concurrency does
  NOT raise throughput on one GPU — 1->8 lifted it ~5% while latency grew 5.8x — so
  scale by endpoint count.
- **Opt-in and OFF by default**, because each endpoint bills hourly *even when idle*
  (~$2.24-$7.09/hr; all six would add roughly $10-30k/month). Unconfigured methods
  report `sagemaker-endpoint-not-configured` with the cost reason, staying visible in
  the catalog with their benchmark numbers — the same honest contract as `bda-custom`.
- `infrastructure/sagemaker-ocr.tf` creates **nothing** unless
  `enable_sagemaker_ocr = true` AND models are listed (two conditions on purpose).
  `sagemaker:InvokeEndpoint` is granted only when an endpoint is configured and is
  **scoped to those endpoint ARNs**, never `*` — withholding the grant is what makes an
  accidental call impossible, the same reasoning that removed the expensive Textract APIs.
- Ratings are scoped to what OCR actually produces: `text_extraction`,
  `layout_analysis`, `bounding_box`, `ocr_enhancement`. They are deliberately NOT rated
  for `kv_extraction` / `document_summarization` / `pii_detection` — those need an LLM
  stage, exactly like Textract+LLM. Claiming otherwise is the "rated the service, not
  the adapter" defect the audit found ten times.
- `ocr_enhancement` **left the unroutable set** as a result: a specialist OCR model
  genuinely does produce a cleaned, layout-aware reading of a scanned page, so it is now
  a deployment gap (`endpoint not configured`) rather than an impossibility.
- Side effect worth keeping: `FAMILY_COLORS`/`FAMILY_LABELS` were duplicated in five
  components and had begun to drift; adding two families broke all five at once, so they
  are now one `theme/family-colors.ts`. `build-skills.ts` also stopped duplicating the
  family list — it now parses `METHOD_FAMILIES`, because the copy went stale immediately
  and rejected valid ratings while claiming they "are not a method family".

### Measured accuracy, and the Korean routing defect it exposed

`scripts/e2e-corpus.mjs` scores extraction against documents whose content is known
(English invoice, English contract, Korean quotation), instead of trusting the
confidence each model reports about itself. Run live against the TF stack:

| Document | Best | Worst |
| --- | --- | --- |
| en-invoice | 100% (most methods) | 100% |
| en-contract | 100% (most methods) | 100% |
| **ko-quotation** | 100% (GPT-5.6, Claude tiers) | **32%** all BDA, **37-42%** all Textract |

- **English tells you almost nothing** — nearly every method scores 100%, which is
  why testing only on English documents hid this for so long. Korean separates the
  methods completely.
- **Two methods lie about it.** `textract-nova-lite` claimed **87%** confidence
  having recovered **37%**; `bda-nova-lite` claimed **93%** having recovered **32%**.
  Both missed every Korean entity. Since the app ranks on self-reported confidence,
  its own ranking actively *preferred* the methods that failed. Textract's *measured*
  OCR confidence told the truth (63% on Korean vs 100% on English) — the honest
  signal was there and unused.
- **Root cause: a correct rule that never fired.** `isMethodLanguageCompatible` has
  always excluded BDA and Textract+LLM for non-English — it predicts these
  measurements exactly. But it only runs when `documentLanguages` is populated, and
  the **only** thing that populated it was the Socratic interview. Every user who
  clicked "Skip questions, use defaults" (the escape hatch added earlier this
  session) got Korean routed to 32%-recall methods with no warning.
- **Fixed** by detecting the writing system from the preview's own extracted text
  (`detectScripts`, Unicode-range based — exact, no model, and it only needs to
  answer "is this Latin?", which is what BDA and Textract are trained for). The
  interview still wins when it ran; otherwise the document itself decides. Tuned so a
  Korean address block on an English invoice reroutes (5.5% non-Latin) but a single
  stray CJK glyph in a copyright line does not (1.6%).
- Preview still runs **every** method deliberately — watching BDA score 32% next to
  Claude's 100% is the comparison this product exists to show. It is step 3, where
  you build a pipeline you would deploy, that must not silently pick a 32% method.
- The rationale now cites the measurement instead of hedging ("do not reliably
  support" reads as a minor quality note; 32% is not minor).

### Capability matrix accuracy

The 33-capability × 8-family support matrix (`packages/shared/skills/**/*.md`)
drives every recommendation, so a wrong entry is a wrong suggestion. Audited
against what our adapters actually request. The recurring root cause: **the matrix
rated the SERVICE, but we only get what the adapter asks for.**

- **`textract-llm` ratings now describe plain OCR, because that is all we buy.**
  Several were "excellent" on the strength of Textract's `TABLES` / `FORMS` /
  `SIGNATURES` / `LAYOUT` features. Those features are deliberately never requested
  (see "Textract is OCR-only" below — they cost up to 43x more per page), so the
  ratings described capability we do not pay for. With `DetectDocumentText` the LLM
  receives text lines in reading order and nothing else:
  - `table_extraction`, `kv_extraction`, `invoice_processing`, `receipt_parsing`,
    `check_processing`: `excellent` → **`good`**. The LLM reconstructs structure
    from line layout, which works but is not detected structure.
  - `layout_analysis`: `excellent` → **`limited`**. Reading order survives in the
    line sequence; columns, headers and footers do not.
  - `signature_detection`: **family removed**. A signature produces no text, so
    plain OCR cannot see one at all.
  This was found by re-reading the adapter after the revert: `two-phase-adapter.ts`
  already documented the honest level ("rated good, not excellent") while the matrix
  still claimed excellent — the code comment and the matrix contradicted each other.
- **Ratings that described nothing were removed or downgraded** (each verified by
  reading the adapter, not the marketing):
  - `bounding_box`: claude/gpt/nova `good|excellent` → `limited`. Converse and the
    Mantle Responses API return text only — there is no detection/grounding output
    channel, so coordinates are generated, not measured. `textract-llm` removed:
    Textract does return `Geometry.BoundingBox`, but our two-phase adapter passes
    **text** to the LLM, so the geometry does not survive the hand-off.
  - `barcode_qr`: nova `good` → `limited`. Nothing in the catalog decodes barcode
    symbology; Textract's feature types are TABLES/FORMS/SIGNATURES/LAYOUT only.
  - `ocr_enhancement`: `textract-llm` removed — no deskew, denoise, contrast or
    binarization exists anywhere (grep finds no implementation). It is now labelled
    a reference-only preprocessing capability like `pdf_conversion`.
  - `handwriting_extraction`, `image_description`, `layout_analysis`: nova
    `excellent` → `good`. A uniform "excellent" across six families was not
    credible, and Nova 2 Lite was ranked equal to Opus 5 and GPT-5.6 on the
    hardest multimodal tasks while being only "good" at plain text extraction.
- **Nova Embeddings was a dead end.** `embedding_generation` and
  `knowledge_base_ingestion` map only to the `embeddings` family, which has **no
  processor in any of the three route registries** and whose model
  (`amazon.nova-2-multimodal-embeddings-v1:0`) is offered **only in us-east-1**
  while this app runs in us-west-2 (verified with `bedrock list-foundation-models`).
  It was still reported `available: true`, so requesting either capability produced
  a pipeline whose only node could never execute. It now reports unavailable with
  the region reason, the generator refuses to emit an un-runnable node, and
  `skippedCapabilities` explains what was dropped and why instead of silently
  omitting it.
- **The skill build fails on an invalid `support:` key**, which is how two
  pre-existing typos were found (`nova-embeddings` and `textract` used where a
  *family* was required, making those capabilities unroutable).
- **The full 33 × 22 matrix is now visible** (`SupportMatrix`), all 22 method
  columns, sticky header and capability column, 460 of 726 pairs supported. The
  catalog previously listed capabilities and methods as two independent lists, so
  the question that actually decides a pipeline — can THIS method do THIS thing,
  and how well — could not be answered from the page.
- **Per-method overrides exist** (`CAPABILITY_SUPPORT_OVERRIDES` +
  `getSupportLevel`). Support is declared per FAMILY, which cannot express a real
  difference between tiers: the frontier GPT-5.6 tiers and Opus 4.8/5 return usable
  bounding boxes where the small fast tiers do not. `getBestMethodsForCapability`
  and `balancedScore` both resolve through the same accessor, so the matrix and the
  actual selection cannot disagree.
- **Capability popovers list every family, including unsupported ones.** They built
  rows from `cap.support` and filtered out `none`, so a family that cannot do the
  capability was simply absent — indistinguishable from one the catalog forgot to
  rate. Stale non-family keys (`textract`, `comprehend`, `nova-embeddings`) removed
  from `FAMILY_NAMES`.
- **Video is genuinely implemented, not routed away.** Converse has a native
  `video` content block and Nova 2 Lite's service card lists video understanding as
  a core capability, so sending every video to BDA left a real capability unused.
  `token-stream-adapter` now sends video inline (under 20 MB) or by S3 location (up
  to 1 GB). Audio stays BDA-only — Converse has no audio block — and that split is
  now reflected in availability, routing and the matrix.
- **Bounding-box guidance uses the 0-1000 normalized grid** validated over 336 real
  scanned pages in the hybrid vision + spatial reasoning pattern. The capability
  previously had no guidance at all and fell through to "Extract bounding box
  data.", so the model was free to answer in pixels, percentages or its own scale —
  unusable even when the boxes were visually right. Same treatment for
  `layout_analysis`, `signature_detection` and `barcode_qr`.

### Recent Runs
- **Status told you nothing.** A run recorded only `complete | error`, so a
  preview-only run and a finished four-step evaluation both read "Complete" — the
  list mixed complete and incomplete work with no way to tell them apart.
  `getRunStage()` now derives the real stage from the record's contents
  (`failed` / `previewed` / `executed` / `analyzed`), which also classifies runs
  saved before this change.
- The Progress column shows the stage plus "reached step N of 4", and the action
  names its destination ("Resume at Analyze", "Open pipeline", "Open architecture")
  instead of a generic "Load results".
- **Resume lands on the step the run reached.** `handleLoadRun` sent every run
  without a comparison back to step 2, so a pipeline that executed but had no
  comparison dropped the user two steps back with its canvas invisible.

### Landing page
- **The reference catalogs are open by default and dismissible with an ✕.**
  Collapsed-by-default hid what the tool can do behind two closed accordions;
  upload remains above them, so the hero is unaffected. The dismissal is a
  preference, deliberately not cleared by "Start over".

### Pricing grounded in the live model catalog
- **Nine of 22 methods were priced wrong.** `METHOD_INFO` hardcodes token prices,
  and hardcoded prices rot. Cross-checking against the Bedrock model catalog
  (an internal Bedrock model-catalog API; see `scripts/sync-model-catalog.mjs`)
  found: Nova 2 Lite **2x over** in all three places it appears (0.3/2.5 →
  0.15/1.25), Sonnet 5 50% over (3/15 → 2/10), every GPT tier ~10% under (5/30 →
  5.5/33, 2.5/15 → 2.75/16.5, 1/6 → 1.1/6.6), Nova Embeddings 0.135 → 0.02.
  All corrected; the check now reports 0 mismatches.
- `packages/shared/data/bedrock-model-catalog.json` — committed snapshot of 155
  models (pricing, modalities, media support, context window, regional
  availability), trimmed to the fields we consume so it stays reviewable.
- `scripts/sync-model-catalog.mjs` — refreshes the snapshot, diffs every method's
  price against it, and lists catalog models that accept video. Deliberately a
  human-reviewed cross-check, not a CI job that rewrites prices: the upstream API
  is unofficial.

### Textract is OCR-only, everywhere
- **Every Textract call is now `DetectDocumentText` at $0.0015/page.** The
  analysis features are never requested: `AnalyzeDocument` costs up to 43x more per
  page ($0.015 TABLES, $0.05 FORMS, $0.065 TABLES+FORMS), and in a Textract+LLM
  pipeline the LLM does the structuring — so the detected structure is paid for and
  discarded.
- **Guardrails was the real offender.** It called `AnalyzeDocument` with
  `FeatureTypes: ['FORMS']` ($0.05/page) while its cost was modelled at
  $0.0016/page, so actual spend was ~33x what was reported. It only needs a flat
  string of text, so it is now plain OCR and the estimate is honest again.
- The generated Python/TypeScript/CDK templates and the code-gen prompt taught
  customers the expensive pattern (`analyze_document(FeatureTypes=['TABLES',
  'FORMS'])`) and then discarded the result — all switched to text detection.
- **IAM no longer grants the expensive APIs** in either stack
  (`infrastructure/ecs.tf`, `agentcore.tf`, `infrastructure-cdk/lib/ecs-backend.ts`,
  `agent-runtime.ts`). Withholding the permission makes an accidental 43x call
  impossible rather than merely unintended.
- A grep-style test (`textract-ocr-only.test.ts`) fails if any adapter or route
  reintroduces an AnalyzeDocument-family call or a `FeatureTypes` argument — the
  failure mode is a future edit, which no single-module unit test would catch.

### Cost correctness
- **Hybrid methods under-reported their cost.** The UI advertises "Textract
  $0.0015/pg + tokens" and "BDA $0.01/pg + tokens", but `calculateCost` returned
  only one or the other. Two separate bugs: the per-page infrastructure fee was
  never added, and neither hybrid adapter captured `event.metadata.usage` from the
  Converse stream, so all six hybrid methods fell back to a flat per-page estimate
  regardless of work done. Measured live before/after on one invoice:
  `$0.00500 → $0.00280` (Txt+Nova), `$0.01700 → $0.01020` (Txt+Sonnet) — the old
  numbers were just `estimatedCostPerPage`, identical on every document.
- **Rounding no longer reports a billed method as free.** The per-page branch
  rounded to 3 decimals, so Nova Embeddings ($0.0005/page) displayed `$0.00`.
- **Guardrails no longer advertised as "$0.00/page"** on the landing page
  (`toFixed(2)` on $0.0016).
- **Textract is not flat-priced, which is why the price is now attached to the call
  and not to the family.** Textract varies by more than 40x with the requested
  features: $0.0015/page plain OCR, $0.004 LAYOUT, $0.015 TABLES, $0.05 FORMS,
  $0.065 TABLES+FORMS. Both entries in `method-limits.ts` read `0.0015`, with the
  AnalyzeDocument one even *labelled* "$/page for AnalyzeDocument" — which is in
  fact the DetectDocumentText price. Guardrails was the live instance of this bug:
  it called `AnalyzeDocument` with `FeatureTypes: ['FORMS']` ($0.05/page) while
  being reported at $0.0016/page, ~33x under. **Resolved by removing the expensive
  call, not by raising the number** — every path is plain OCR now, so $0.0016 is
  correct again and the feature-price table survives as reference only. Per-run fees
  are nonetheless **measured, not assumed** (`AdapterOutput.perPageFee`): a
  per-family constant is the wrong shape for a price that depends on the call.
  Cross-checked against the AWS Solutions Library IDP accelerator's centralized
  `config_library/pricing.yaml` (MIT-0).
- **A cost fix caused a safety regression, recorded here as the lesson.** While
  Guardrails was briefly priced at its true AnalyzeDocument cost, the cost term
  outweighed the +25 PII specialist bonus and Claude Haiku started winning PII
  routing — i.e. the app began asking a generative model to redact its own output.
  A missed redaction is a data leak, not a saving. PII now routes to the
  deterministic engine under **every** strategy with a +100 bonus, so the routing no
  longer depends on the relative price at all — the correct fix, since the price
  moved twice afterwards and the guarantee held both times. (Previously only
  `balanced` consulted the score; `cost` picked Nova Lite and `speed` picked Haiku.)

### Per-page cost is derived, not hand-written
- **`estimatedCostPerPage` was 23 hand-written literals, and nine of them were
  stale.** Correcting the token prices against the live Bedrock catalog changed the
  *inputs* to those estimates without changing the estimates — so the field the cost
  ranking and every pre-run projection read still reflected prices that were, for
  Nova, 2x too high. Nothing failed, because nothing connected the two. It is now
  computed by `estimateCostPerPage(family, tokenPricing)` from a measured typical
  page (`TYPICAL_PAGE_TOKENS` = 2,200 in / 900 out, the midpoint of live preview
  runs) plus the family's managed per-page fee. `bda-custom` is the one documented
  exception: its price is a service tier, not a function of tokens.
- Six invariants are now pinned (`cost-per-page-derived.test.ts`), including the one
  that was silently broken: **ordering by estimate must agree with ordering by
  price**, and a Textract hybrid must cost more than the same model used directly.
- The rounding floor is retained: a method that bills anything never displays
  `$0.0000`. Nova Embeddings lands at $0.000044/page and would otherwise read as
  free — the same bug as the earlier 3-decimal rounding, one decimal place lower.

### Cost and speed no longer pick a method that cannot do the job
- **`optimizeFor: 'cost'` and `'speed'` sorted the entire candidate list on price or
  latency alone, ignoring capability support.** Found by probing all 33 capabilities
  after the per-tier corrections landed: for `bounding_box`, `cost` chose Nova 2 Lite
  and `speed` chose Claude Haiku — both rated `limited` — while GPT-5.6 and Opus
  tiers rated `excellent` were available. "Cheapest" has to mean the cheapest method
  that can do the job. A quality floor now excludes `limited` methods unless nothing
  better exists, so a genuinely weak capability still routes instead of failing.
  All four strategies now select an `excellent` method for `bounding_box`.
- Those `.sort()` calls also mutated the shared candidate array in place; they now
  sort a copy.

### Method suggestions
- **"Optimize for accuracy" could not reach the frontier models.** Capability
  support is declared per *family*, so all seven Claude methods tie; the tie fell
  through to declaration order in `METHOD_INFO`, and `claude-sonnet` — merely the
  first Claude declared — won every Claude tie. Measured over 18 document kinds ×
  4 strategies: only **8 of 22** methods were ever suggested, with no GPT tier and
  no frontier Claude appearing once. A `MODEL_TIER` tie-breaker fixes it; Opus 5
  is now selected for accuracy across 16 kinds.
- **The balanced score went negative.** `SPEED_RANK` grew to 18 while the
  normaliser still divided by a hardcoded 11, so `((11 - rank) / 11) * 100` gave
  Opus 5 **-63.6** instead of 0 — a negative term that subtracts from accuracy
  rather than ranking low. Bounds are now derived from the tables.
- **`optimizeFor` was silently discarded** whenever no preferred method supported
  a capability: that branch returned `candidates[0]`, i.e. the most *accurate*
  method, so a request to optimise for cost or speed returned the most expensive
  and slowest option.
- **The smart pipeline collapsed to a single method.** `/api/pipeline/smart`
  flattened the LLM's per-capability `methodAssignments` into a flat
  `preferredMethods` list, discarding the mapping — so a deliberate multi-method
  plan became one method while the rationale beside it described several.
- **Unavailable methods are no longer suggested.** Availability was enforced only
  at execution time, so "accuracy" recommended `bda-custom` (deliberately
  unconfigured here) and the canvas node failed immediately.
- **Audio/video no longer produce nonsense.** Media fell through to
  `documentBuffer.toString('utf-8')` — the model received a UTF-8 decode of an MP4
  container and was asked to extract fields from it, then the run was reported as
  a *priced success*. Media is now routed to BDA only, at three levels
  (generation, availability, adapter). Verified live: an mp4 preview narrowed 19
  methods → 4 BDA.
- **Two skills declared invalid support keys**, making their capabilities
  unroutable: `knowledge_base_ingestion` used `nova-embeddings` (a method id) and
  `image_separation` used `textract`, where a *family* was required. Requesting
  either alone returned HTTP 500. The skill build now fails on an unknown key —
  it caught the second instance immediately.
- **An unknown capability returns 400, not 500.** `selectMethod` returned
  `undefined`, which crashed layout with
  `Cannot read properties of undefined (reading 'shortName')`.

### Preview UX (the fan-out is the product)
- **The method cards ARE the chooser now.** A `RadioGroup` sat above the metric
  grid listing the same methods with the same numbers, so every method appeared
  twice and the cards — the half carrying the cost/latency/confidence you actually
  compare — were the half you could not click. The radio list is gone; each card is
  a `role="radio"` with `aria-checked`, arrow-key traversal, space/enter, a tinted
  selected surface and an explicit "Selected" indicator (a border-and-tint alone
  reads as *hovered*, and is the wrong cue to rely on alone). "View output"
  `stopPropagation`s, because otherwise inspecting a method's extraction would
  silently commit you to it.
- **The 60s per-method cap was cancelling most of the run.** It was chosen from
  single-page test files. On a real 6-page Korean quotation it cancelled **9 of 12
  methods** — every Opus and Sonnet tier plus three GPT tiers — leaving 3 results
  and nine identical truncated "…exceeded the 60s preview limit and w" fragments.
  A cancelled method is worse than a slow one: the user still waits and still pays
  for the tokens generated. Now 5 minutes, which only bounds a genuine hang
  (slowest observed healthy method: ~46s).
- **Results appear as they land, everywhere.** The backend always streamed each
  result over SSE, but `CapabilityCards` gated on `isPreviewLoading` and rendered
  nothing until every method finished — so a run whose fastest model answered in
  7s showed a blank card for another 40s. Cards now fill in progressively and show
  "N more methods still running".
- **Extraction output is readable.** `ExtractionView` renders an HTML table as a
  real table (sticky header, dark-mode aware), CSV as a grid, JSON pretty-printed,
  and strips the ```` ```yaml ```` fences models emit — with a **Source** toggle
  for verbatim inspection. Previously the result the whole comparison exists to
  show was dumped as raw `<thead><tr><th>` markup in a 200px box, which looked
  like a failed extraction.
- **The output viewer opens full-width below the grid**, not inside a ~240px card,
  which used to stretch one card to several times its neighbours' height.
- **Failures are grouped by cause and stated in full**, once, instead of repeated
  per method truncated to 50 characters.
- **The method chooser only lists choices.** It rendered all 12 attempted methods
  including 9 disabled "0.0s Failed" rows above the 3 usable ones.
- **Measured OCR confidence is surfaced** (`99.8%` on the test invoice), labelled
  "measured", beside the model's "self-reported" number. Textract returns a
  per-line `Confidence` on every two-stage run and we were discarding it — it is
  the only confidence figure in the app that is not self-graded.
- `55.00000000000001%` fixed: Cloudscape renders the raw `value` as the visible
  label, so the relevance score needed rounding before it reached the bar.

### Safety
- The demo/data-handling notice is stated **once**, in full, **at the file
  picker** — the moment the user is about to hand over a document. It previously
  occupied a full-width banner pinned above every page *plus* a second copy inside
  the upload control, so the same prohibition appeared twice on one screen and a
  block of yellow pushed the actual task down.
- A single quiet line (`DemoFooterNote`) keeps the "no SLA / not an AWS product"
  disclosure on every route after step 1.

### Code quality
- One shared availability service (`method-availability.ts`) replaces the same
  filter logic copy-pasted into three routes with subtle differences.
- Deduplicated `parseResults` across two adapters (the copies had drifted to
  different default confidence values).
- `.dockerignore` added — stale host `dist`/`tsbuildinfo` were breaking the
  container build.
- `theme/tokens.ts` is the single place colours come from, replacing hand-written
  CSS variables that silently never resolved.
- The skill build **fails** on an invalid `support:` key instead of silently
  dropping it into an unroutable capability.
- `scripts/e2e-live.mjs` — reusable full-path check against a live deployment.
- **223 tests pass** (111 at the start of this work, 8 of them failing).

---

## Not done

### Verified-real but incomplete
- [ ] **Hardcoded hex colours remain in the pipeline canvas nodes**
      (`components/pipeline/nodes/*.tsx`, `PipelineCanvas`, `MetricsChart`). These
      are the largest remaining dark-mode gap. The per-family colours are
      intentional brand identity and should stay; the `#ffffff` node backgrounds,
      `#fafafa` canvas and `#5f6b7a` label text should move to `theme/tokens.ts`.
      The step-2/3/4 page chrome is done.
- [ ] **`getBestMethodForContentType` is still unused.** The Page Classifier runs
      and reports content types, but its result does not change which method
      processes which page — hybrid routing classifies without routing. Judged
      lower priority than the cost/suggestion defects; it is a real feature gap,
      not a bug, since every page still gets processed by its configured method.
- [ ] **'speed' can pick a slower method than 'balanced' for PII.** `SPEED_RANK`
      puts Guardrails at 4 and Nova Lite at 2, but the +25 PII specialist bonus in
      `balancedScore` does not apply to the pure-speed sort, so the two strategies
      disagree. Low impact, but the latency model contradicts itself.
- [ ] `/processing` is registered as a route but nothing links to it. It renders a
      valid empty state now, so it is dead code rather than a defect — decide
      whether to delete it or wire it up.

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
1. **Pipeline canvas dark mode** — the last real UX gap (see above). Everything
   else on steps 1-4 is token-based now.
2. **Exercise the app, don't just read it.** Almost every defect in this round was
   invisible in the source: the hashed-CSS-variable dark-mode failure, hybrid
   methods reporting a flat estimate, audio decoded as UTF-8, `/pipeline` dead after
   loading a run. Two harnesses now exist and both found real bugs:
   ```bash
   BASE=$SITE node scripts/e2e-live.mjs sample.pdf     # upload→preview→pipeline
   # plus a Playwright sweep of every route × light/dark, asserting non-blank
   # content, zero console errors and zero React key warnings
   ```
   Sanity-check the *numbers*, not just the status codes — the hybrid cost bug
   showed up only as suspiciously round values identical on every document.
3. **Beware three traps that produced wrong conclusions here:**
   - Cloudscape hashes its CSS custom-property names, so a hand-written
     `var(--color-x, #fff)` always silently uses the literal. Import tokens.
   - Headless Chromium does not render PDF iframes — a blank preview box is not a
     bug — and `networkidle` never settles on `/docs`, which killed a sweep
     mid-run. Use `domcontentloaded`.
   - Full-page screenshots relocate sticky elements; measure the viewport.
4. **Do not trust `finch build` exit 0.** It returns 0 when the VM is stopped and
   when the disk is full. Check the log tail for `exporting manifest`, and check
   the image digest actually changed.
5. Deploy order that works: build image → push to both ECRs → `force-new-deployment`
   on both services → wait for `COMPLETED` → verify `/api/health` and
   `/api/methods` on both stacks → sync frontend → invalidate CloudFront.

### Ideas from the AWS Solutions Library IDP accelerator

Studied `aws-solutions-library-samples/accelerated-intelligent-document-processing-on-aws`
(the GenAIIC IDP Accelerator — a production solution SMB customers actually run;
**MIT-0**, so its approaches are adoptable). It is a *production pipeline*; ours is
an *evaluation/comparison tool*, so these are ideas to borrow, not architecture to
copy. Ranked by value to us:

1. [ ] **Measured accuracy instead of self-reported confidence — the single
      biggest gap.** We rank methods by a number each model invents about itself
      and then warn the user not to trust it. The accelerator scores extraction
      against ground truth with a **comparator per field type**: `Exact` for
      IDs/booleans, `Fuzzy` (0.85 threshold) for names/addresses, `NumericExact`
      with tolerance for amounts, and the **Hungarian algorithm** for optimal
      matching of object arrays (line items, transactions). See `docs/evaluation.md`.
      Adopting even the comparator set would let our comparison rank methods by
      measured field accuracy — the thing users actually want to know.
2. [ ] **Confidence calibration metrics** (`ECE`, Brier score, `AUROC`) turn our
      disclaimer into a measurable property: given confidence values plus
      matched/unmatched labels, you can state *how well-calibrated* each model is,
      and rank on that. Directly complements (1).
3. [ ] **1S-TopK — a cheap, research-backed calibration fix.** Ask the model for
      its top-K guesses **with probabilities** per field in one call; the top guess
      becomes the value and its probability the confidence. Enumerating
      alternatives yields far better-calibrated, less overconfident scores than
      "give me a value and a confidence number" (Tian et al., *Just Ask for
      Calibration*, EMNLP 2023). Nearly free for us: one prompt change on the
      direct-LLM adapters, no extra inference.
4. [ ] **A separate, cheaper-model confidence pass.** Structurally better than
      asking the extractor to grade its own work, and cheap because a small model
      can do the grading. Their default is `separate` mode for exactly this reason.
5. [ ] **Ground-truth-free accuracy via OCR grounding.** Check extracted values
      against the OCR text/geometry actually present on the page — catches
      hallucinated fields with no labelled data at all. We now capture OCR
      confidence and detected structure, so the raw material is already in hand.
6. [ ] **Schema-driven per-document-type config** (`config_library/`): JSON Schema
      plus `x-aws-idp-*` extensions expresses the fields to extract *and* how to
      compare them, per document type. Ours hardcodes prompts in the adapters.
7. [ ] **Config-driven pricing table.** Their `config_library/pricing.yaml` holds
      every service price in one editable file (and supports private pricing
      agreements). Ours is compiled into `METHOD_INFO` — which is precisely why the
      Textract and Guardrails prices went stale and wrong.
8. [ ] **Deterministic guardrails we lack**: schema validation with model
      *escalation* (re-extract only the failing fields with a stronger model —
      much cheaper than human review), vocabulary validation with retry, and
      deterministic table parsing.
9. [ ] **Model-aware auto-sizing.** They derive shard/batch budgets from each
      model's real input+output window minus a context buffer, so nobody hand-sets
      per-model token limits. Our `token-budget.ts` is closer to hand-tuned.
10. [ ] **Cost-model gap**: no `cacheRead`/`cacheWrite` accounting and no prompt
      caching, so our cost comparison overstates the economics of repeated
      document types.

**Deliberately NOT adopting:** its 3-pattern concept (it has since been removed
upstream in favour of orthogonal config axes), and HITL/A2I review queues — that is
production-pipeline scope, not evaluation-tool scope.

**Where we are genuinely complementary, and should stay so:** cross-family
side-by-side comparison of many models on *your* document, and pre-commitment cost
projection at scale. The accelerator does not do either; it runs one configured
pipeline well.

### Still to do — from this session, in priority order

Numbered so nothing gets dropped. Each item states what is wrong and how it was
found, because the "why" is what makes it fixable.

1. [ ] **Only 5 of 22 methods are ever *selected*, and that is mostly by design —
      but it is worth deciding whether it should be.** Measured over all 33
      capabilities × 4 strategies on a PDF (100 routed, 32 correctly unroutable):
      `balanced` reaches 4 methods, `accuracy` 3, `cost` 3, `speed` 3, for 5
      distinct overall (Haiku, Opus 5, Nova 2 Lite, GPT-5.6 Luna, Guardrails).
      This is *not* the old tie-break bug — candidates are correctly ordered 20-deep
      and the frontier tiers do win where the matrix says they should. It is
      structural: a single-capability request has exactly one optimum per strategy,
      and support levels are coarse (4 values), so one method dominates a whole tier.
      The tool's value is the *preview fan-out* across all ~19 methods, which is
      unaffected. Open question: whether the generator should deliberately diversify
      (e.g. offer a runner-up per capability in `PipelineAlternatives`) so more of
      the catalog is reachable from step 3 without hand-picking. Note the 17
      unselected methods are still fully reachable via `preferredMethods`.
2. [x] **Step 3 (Pipeline) dark mode.** DONE — `components/pipeline/nodes/*.tsx`,
      `PipelineCanvas` and `MetricsChart` still hardcode `#ffffff` node
      backgrounds, `#fafafa` canvas and `#5f6b7a` labels. This is the largest
      remaining dark-mode gap. The per-family brand colours are intentional and
      should stay; the surfaces and label text should move to `theme/tokens.ts`.
      Never hand-write `var(--color-…)` — Cloudscape hashes those names, so they
      silently fall back to the light literal.
3. [x] **Step 4 (Architecture) consistency.** DONE — Section order and headings should
      mirror step 3; the generated-project tab strip is 11 tabs with no grouping;
      the AI cost table and `CostProjectionCalculator` present overlapping numbers.
4. [x] **Matrix audit complete — all 6 categories.** Adversarial pass (one agent
      proposes a correction, a different agent tries to refute it; 53 agents total
      across two rounds). Round 1 covered `core_extraction`, `visual_analysis`,
      `compliance_security`, `industry_specific`: 27 proposed, 25 refuted as
      already-applied, 2 confirmed. Round 2 covered the three that were missing:
      **20 proposed, 10 refuted, 10 confirmed and applied.** Every confirmed one was
      the same root cause — *the level described what the AWS service can do, not
      what our adapter asks for*:
      - `sync-poll-adapter.ts` has parse cases for only 5 capabilities. Everything
        else falls through to `default:` and is answered with the **whole document's
        markdown**. So BDA was rated `excellent` at summarization while literally
        returning the full text AS the summary, and `excellent` at image_separation
        while returning page text labelled "extracted images".
      - BDA's document splitter is never requested (no `splitter` /
        `overrideConfiguration` anywhere) → `document_splitting` bda `excellent` →
        `limited`.
      - `audio_summarization` bda **removed**: the `public-default` project we invoke
        has `audio.generativeField: DISABLED`, verified against the live project
        config — there is no summary to surface even in principle.
      - `knowledge_base_ingestion` embeddings **removed**: KB ingestion is
        `StartIngestionJob` on the bedrock-agent control plane, and
        `@aws-sdk/client-bedrock-agent` is not even a dependency. `routes/pipeline.ts`
        already documented it as unroutable while the matrix said `excellent`.
      All media/document capabilities remain routable via the LLM stage; only
      `image_separation` became unroutable and now carries a reason.
      **Still open:** levels are *argued* (derived from the adapter), not *measured*.
      `scripts/e2e-corpus.mjs` now measures recall for a 3-document corpus — extend it
      per capability so the matrix can cite numbers rather than reasoning.
5. [x] **Video run end to end — found two real bugs.** A 9s synthetic mp4 with known
      ground truth ("INVOICE 12345" / "TOTAL 500 USD" / "DUE 2026-08-15") through the
      deployed stack:
      - **Every Claude tier rejects the Converse video block** — all 7 failed with
        "This model doesn't support the video content block that you provided."
        Offering Claude for video was inferred from the API *having* a video block;
        having the block is not the same as a model accepting it. Claude removed from
        `VIDEO_CAPABLE_FAMILIES` and from the video matrix rows.
      - **Nova reported success while extracting nothing** (919ms, $0.0004,
        `data: []`, confidence 0). Root cause was OUR PROMPT, proven by A/B on
        identical bytes: the system prompt said "document processing AI … from the
        document" for a video, and the 5 media capabilities had no guidance at all.
        Generic instruction → `data: []`; media-aware wording + guidance → full
        summary at confidence 0.9 with every ground-truth string recovered. Nova was
        always capable — a direct probe recovered all 3 strings first try.
      - The silent success was the worse bug: `processor-base` marked any parseable
        response `complete`. `isEmptyExtraction` now fails a run where every
        capability came back empty at zero confidence (0 and `false` are NOT empty —
        they are real answers to "how many" and "is it signed").
      - BDA+LLM is now the preferred video path, matching your point that **BDA is to
        media what Textract is to pages**: verified live, BDA returns real shot
        detection with timecodes and per-shot confidence for the LLM stage to
        structure. Rated `excellent`, and `bda-standard` alone is no longer preferred.
6. [x] **CORRECTED — Pegasus IS addable and is now added; the other 5 are not.**
      This item previously said no video model was addable. That was wrong for
      Pegasus: the probe used Converse (which it does not serve) and the bare model id
      (no on-demand throughput). Via `InvokeModel` + the `us.` inference profile it
      works and beat every Converse model on the ground-truth mp4 (3/3 with
      timestamps). It is now a first-class method. The rest were probed live in
      us-west-2 and genuinely are not usable:
      - `amazon.nova-premier-v1:0` — `us.` form: "marked by provider as Legacy and you
        have not been [granted access]"; bare form: on-demand throughput unsupported.
      - `amazon.nova-2-pro-preview-*` — "Model not found" / invalid identifier. (Also
        explicitly excluded on your instruction.)
      - `google.gemma-4-31b` / `-26b-a4b` / `-e2b` — all three: "The provided model
        identifier is invalid", in both bare and `us.` forms.
      - `twelvelabs.pegasus-1-2-v1:0` — needs a provisioned inference profile, on
        Converse *and* on `InvokeModel`; not available on-demand in this account.
      - `twelvelabs.marengo-embed-*` — not offered in us-west-2 at all.
      - `us.amazon.nova-pro-v1:0` (Nova 1 Pro) is the ONLY one that accepted the video
        — and it got the content **wrong**: 0 of 3 ground-truth strings, reading
        "Due 2050-08-15" for "2026-08-15" and missing the total entirely.
      Adding any of these would have shipped 6 methods that error or lie. **Lesson
      worth keeping: verify a model against a real file before listing it** — this is
      the same mistake as Claude-for-video and `nova-embeddings`, caught earlier this
      time. Re-check if account entitlements change.
7. [x] **Specialist OCR models added** — see the section above. Adapter, six
      processors, opt-in Terraform, scoped IAM, matrix ratings and tests all landed;
      endpoints are off by default. Original notes kept for reference:
      `~/workspaces/35-hybrid-vision-spatial-reasoning/BENCHMARKS.md`, which already
      has measured F1 per model over 336 real pages plus per-image costs. These are
      **SageMaker endpoints on self-hosted GPUs, not Bedrock**, so this is a new
      family (`sagemaker-ocr`), an `InvokeEndpoint` adapter, GPU-hour rather than
      token cost modelling, and opt-in Terraform/CDK. Key facts from the reference:
      - `infinity-parser2` (35B) is the **only** model that splits every dense
        portrait grid; surya/chandra collapse them despite a higher aggregate F1
        (0.670 on recall 0.96 / precision 0.51 — the aggregate is misleading).
      - `baidu-unlimited-ocr` handles ~70% of pages and collapses the dense minority;
        baidu and infinity are **complementary**, which is why the production shape is
        `Baidu → free geometry judge → infinity/GPT fallback → arbitrate`, not any
        single model. That judge+arbitration pattern is worth borrowing for our
        aggregator regardless of whether we host the endpoints.
      - Cost: g6e.2xlarge ~$0.0085/image (cheapest), g7e.4xlarge ~$0.0122 (fastest).
        Concurrency does NOT raise throughput on a single GPU (1→8 lifts throughput 5%
        while latency grows 5.8×) — scale by endpoint count. Stage-2 Claude matching is
        75-80% of per-image cost, not the OCR endpoint.
      **Open questions:** (a) the benchmarks were produced in a DIFFERENT AWS account
      from the one this app deploys to — are the endpoints live here, or should the methods
      register as "needs endpoint" like `bda-custom`? (b) 4-5 idle GPU endpoints at
      $2.24-$7.09/hr each is real money on a demo stack, so IaC should default to
      disabled.
8. [ ] **Purpose-built video/media models are missing.** Region-checked against the
      snapshot on 2026-07-25, which changes the shortlist — the earlier version of
      this item named Marengo as a "real gap" and was wrong:
      - `twelvelabs.pegasus-1-2-v1:0` (video understanding) — **in us-west-2.** The
        genuine candidate. NOT a Converse model, so it needs its own invocation path.
      - `twelvelabs.marengo-embed-3-0-v1:0` / `-2-7-` (video embeddings) — **NOT in
        us-west-2.** Same dead end as `nova-embeddings`; do not list it.
      - `amazon.nova-premier-v1:0`, `amazon.nova-2-pro-preview-*`, `amazon.nova-pro-v1:0`
        and the three Gemma 4 tiers — all in us-west-2 and all video-capable via
        Converse, so these are the cheap additions (no new invocation path).
      Register a processor in all three route registries. Do not list a model that
      cannot run: that was the `nova-embeddings` mistake.
9. [x] ~~**`claude-opus-5` is absent from the model catalog.**~~ **This item was
      wrong.** It IS in the snapshot, as `anthropic.claude-opus-5` at $5/$25 —
      exactly what `METHOD_INFO` says. `sync-model-catalog.mjs`'s `lookup()` strips
      the `us.` inference-profile prefix, so the reported "0 mismatches" already
      covered it. Verified 2026-07-25.
10. [x] **Catalog snapshot wired into `token-budget.ts`.** `MODEL_MAX_OUTPUT_TOKENS`
      was an EMPTY hand-maintained map behind a flat 64,000 default, with a comment
      asserting "every model currently routed to accepts 64,000" — true, but
      unverifiable without re-reading the docs by hand. Now generated from the
      snapshot (`scripts/build-model-limits.ts` → `src/generated/model-limits.ts`,
      100 models with a published ceiling; 55 catalog entries publish none and fall
      back to the documented default). Two things this surfaced:
      - The Opus tiers and Sonnet 5 accept **128,000**, not 64,000, so full pipeline
        runs were bounded at half their real ceiling. No run was truncated by this —
        maxTokens is a bound, not an allocation — but the headroom was unavailable.
      - `amazon.nova-lite-v1:0` (Nova 1, still in the catalog) caps at **5,120**.
        The empty map was one edit away from requesting 64,000 against it and hard
        failing every call. Now pinned by a test.
      Raising the ceiling does NOT reintroduce the runaway-generation stall: all four
      adapters wrap `calculateMaxTokens` in `applyOutputCap`, and preview passes its
      own 32,000 ceiling, so the caller's cap wins. That ordering is now a test.
      **Still open from this item:** only `maxOutputTokens` is generated.
      `maxInputTokens` in the snapshot is free-form prose ("1M", "1 Million", "200k",
      "8,172 tokens", "Video: 6GB/"), so parsing it would mean guessing and a wrong
      input ceiling truncates real documents. Also still to do: add
      `scripts/sync-model-catalog.mjs --strict` to a release check.
11. [x] ~~**Recent Runs / Admin parity.**~~ **This item was wrong.** `AdminPage` has
      no run table of its own — its "Evaluation Runs" tab renders
      `<RecentRunsPage embedded isAdmin>`, so it already shows the derived stage. The
      table I mistook for it is the Activity Log, which correctly displays event
      types (`preview_complete`, `pipeline_start`), not run status. Verified
      2026-07-25.
12. [ ] **The six SageMaker OCR adapters are UNTESTED — no endpoint exists here.**
      (Pegasus IS now verified end to end through the deployed stack: 3/3 ground truth,
      5.6s, $0.0018 — and running it found two bugs a direct SDK probe could not.
      Expect the same for these.) The benchmarks were produced in a different account
      (a different one from this deployment's), so nothing in this adapter has
      executed. Specifically
      unverified: the per-model response shapes in `OCR_RESPONSE_FORMAT`, the
      coordinate-space auto-detection in `normalizeBbox`, and whether omitting `prompt`
      really makes each container use its native layout prompt. Run one endpoint before
      trusting any of it.
13. [ ] **Borrow the judge -> fallback -> arbitrate pattern for the aggregator.** The
      reference pipeline's best idea is not a model, it is the control flow: a FREE
      geometry heuristic (no image, no model call) judges whether an extraction is
      broken, only the flagged minority pays for a second stronger model, and
      arbitration keeps whichever result has more distinct matches — which makes the
      judge's over-flagging risk-free. Measured: 101/336 pages flagged, 24 improved, 0
      regressions, 13.6 min wall-clock. Our aggregator resolves per capability but has
      no quality judge and no escalation path.
14. [ ] **Stage-2 cost dominates and we do not model it.** In the reference, the LLM
      structuring stage was 75-80% of true per-image cost ($0.032 of $0.0405), not the
      OCR endpoint. Our `sagemaker-ocr` methods are priced for the OCR stage ONLY, so
      comparing one against a full extract-and-structure method understates it. Either
      compose them as two-stage methods (like `textract-llm`) or label the figure as
      stage-1-only in the UI.
15. [x] **Layout/copy items from the previous pass — now DONE.** All four items that
      were "reviewed but not changed" are fixed, plus what a real step-1-2-3-4 walkthrough
      and an audit turned up. Every claim below was measured, not reasoned about.
      - **The served docs were wrong in ~30 places.** Note the trap: `packages/docs/**`
        is a DEAD second copy (nothing builds or serves it — the root `build` script does
        not include it), while `packages/frontend/public/docs-content/**` is what
        `DocsPage` fetches at runtime. The previous pass audited the dead tree. Fixed in
        the served tree: **App Runner → ECS Fargate + ALB** (7 files, including
        `aws apprunner start-deployment` as a copy-pasteable command that would just
        fail); **15/16 methods → 29**; **"5-step workflow" → 4**; **Nova 2 Pro removed**
        (its preview id resolved in no region, so it was deleted from the catalog — the
        docs still priced it); **Nova priced at 2x** ($0.30/$2.50 → $0.15/$1.25);
        **9 broken cross-links** (`](/workflow)` 404s — the SPA serves `/docs/workflow`);
        a dead **CloudFront distribution id**; and a reference to `CLAUDE.md`, which is
        gitignored and holds account state. `docs-accuracy.test.ts` now pins all of it
        against the catalog. `packages/docs/README.md` says plainly that it is not served.
      - **`/processing` deleted.** It was a route nothing linked to, and with it went
        `components/processing/` — MethodCard, ComparisonTable, MetricsChart,
        StreamingResult — 5 files of UI unreachable by any user, still being typechecked
        and maintained.
      - **README rewritten from the catalog.** It claimed 16 methods / 6 families, listed
        removed models, and promised "generated IaC in Terraform or CDK" when the
        generator only emits CDK.
      - **Mermaid: 12 of 26 realistic diagrams could not render.** Previously unverifiable
        ("the parser needs a DOM this environment lacks") — but Playwright ships Chromium,
        so `scripts/mermaid-probe.mjs` now asks the real parser and reports, per case,
        whether the RAW source parses and whether the SANITIZED source parses. That
        distinction caught a **regression in the old sanitizer**: it mangled already-valid
        `A[[Batch]]` into `A["[Batch"]]`, breaking diagrams that had merely been ugly.
        Rewritten as a delimiter-aware scanner (longest-delimiter-first, balanced nesting)
        and now **26/26 parse with 0 regressions**. The old unit test re-implemented the
        sanitizer inline, so it passed against a copy while the shipped code was broken;
        it now loads and executes the real source.
      - The diagram failure state is an `Alert` with a copy-source button instead of a
        hardcoded light-grey `<pre>` that was unreadable in dark mode.
16. [x] **The generated project could not build — five separate defects.** This is the
      artifact a customer is told is "deployable as-is", so each of these is worse than a
      UI bug. Found by audit, each verified by reading the emitted template:
      - `const process = api.root.addResource('process')` **shadowed Node's global
        `process`** in a block that reads `process.env.BDA_PROFILE_ARN` above it — a
        temporal-dead-zone `ReferenceError`, so `cdk synth` died before emitting a single
        resource.
      - `cdk/lambda/processor.ts` imported `../process.js`, which resolves to
        `cdk/process.js` — but the file was only written to the ZIP root, so bundling
        failed on an unresolved import.
      - `bin/idp.ts` imported `PRODUCT_NAME` from **`@idp/shared`**, this repo's internal
        workspace package, which can never exist in a customer's project (and it was
        unused).
      - The dispatcher guessed a method's family from an id **prefix** and recognised only
        3 of 10 families, so **9 of 29 methods** — embeddings, guardrails, Pegasus and all
        six SageMaker OCR models — silently fell through to a Bedrock Converse call that
        cannot invoke them. Now emitted from the catalog, and an unsupported family throws
        a message naming the reason instead of failing opaquely at runtime.
      - The IAM policy built foundation-model ARNs by concatenating every method's
        `modelId`, including routing keys like `bedrock-guardrails-apply` and
        `sagemaker:unlimited-ocr` — the latter contains a colon, producing a malformed ARN
        CloudFormation rejects outright.
17. [x] **"Compare with the AI's own projection" compared a table with itself.** The
      backend parsed the model's `<costs>` block and then **overwrote `costData.methods`**
      with `estimateMonthlyCost(...)` — the same formula the deterministic calculator above
      it already used. The UI invited the user to compare two tables that were computed
      identically and could never disagree, which manufactures corroboration rather than
      providing a second opinion. The model's numbers are now passed through (filtered to
      methods actually benchmarked, so it cannot invent rows).
18. [x] **The code-gen prompt contradicted itself on Textract, in the expensive
      direction.** One requirement said "sync `analyze_document` for single-page/images"
      while three other rules in the same prompt forbade the AnalyzeDocument family. The
      model resolved the contradiction by emitting the expensive call, so a generated
      project could cost **up to 43x more per page** ($0.065 FORMS vs $0.0015
      DetectDocumentText) than this tool reports. The existing guard missed it because it
      stripped comments and only inspected code *we* run — a prompt is neither. Now pinned
      by a test that reads the prompt text itself.
19. [x] **Six tests were failing on `main` before this pass, describing bugs that did not
      exist — and masking one that did.** `config` in `config/aws.ts` reads the environment
      once at module load, and nothing in the test run loads a `.env`; static imports are
      hoisted, so a `beforeAll` setting `BEDROCK_GUARDRAIL_ID` ran far too late.
      Guardrails was filtered out as unconfigured and PII fell through to Claude Haiku, so
      the assertions failed against **correct** routing logic. Fixed with a vitest
      `setupFiles` entry, which is the only place that ordering can be fixed.
      The bug it hid: with BDA filtered away, **audio routed to Pegasus** — rated `good`
      at `audio_transcription` because it transcribes the audio track *of a video*, but
      its API takes a video media source, so a bare `.mp3` fails inside the adapter. Audio
      now reports unroutable rather than charging for a run that cannot succeed.
      Also: `npm run build` compiles the tests into `packages/backend/dist/__tests__/`, and
      vitest collected **both copies** — 23 phantom ENOENT failures whose only cause was
      having run a build first. The new root `vitest.config.ts` excludes `dist`.
      And setting placeholder service ids made nine `*.live.test.ts` cases stop skipping
      and start failing against real AWS; they now gate on an explicit
      `LIVE_TESTS_DISABLED` flag.
20. [x] **An internal hostname carrying a personal alias was committed to this public
      repo** in four files (`scripts/sync-model-catalog.mjs`, the catalog snapshot's
      `_source`, `infrastructure/terraform.tfvars.example`, `TODO.md`), plus a stale
      CloudFront distribution id and an internal reference deployment URL in the docs. The
      catalog URL is now `MODEL_CATALOG_URL`, unset by default — which also makes the
      script work for anyone who clones this, instead of pointing at a host they cannot
      reach. `docs-accuracy.test.ts` fails on any account id, distribution id,
      `*.cloudfront.net` host or internal domain in the served docs.
21. [x] **The landing-page method catalog was redesigned** after review of the rendered
      pixels, not the code. The 3-column grid of variable-height cards had four defects on
      one screen: a 6-method family left two columns blank; the same "needs a SageMaker
      endpoint" sentence repeated verbatim on all six OCR rows (18 lines saying one
      thing); narrow columns broke words mid-token ("T hese", "deplo yment"); and the
      family heading came from a **partial** name map, so the two newest families rendered
      with **no title at all** — a group of six methods under a bare count badge. Now one
      row per method, the shared unavailable reason stated once per family, and
      `FAMILY_FULL_NAMES` is a total `Record<MethodFamily, …>` so a missing name is a
      compile error. `scripts/shoot-catalog.mjs` screenshots it and asserts no
      "undefined", no repetition, and every family named.

22. [x] **README walkthrough animation, recorded from the live app.**
      `scripts/record-walkthrough.mjs` drives the real deployment in Chromium (Playwright
      ships it, so no new dependency) with burned-in "Step N of 4" captions, then encodes
      with ffmpeg. Deliberately the SAME harness family as the audit walkthrough: if a step
      is broken the recording shows it broken, so the animation cannot drift from the
      product. It already earned that — the first take captured `$0.0067/p` + `age`
      wrapping mid-word in the pipeline cost tile, which is now fixed (the unit moved into
      the label; `awsui-value-large` at 4 columns cannot fit the value plus "/page").
      Format: **mp4 3.5 MB vs GIF 9.0 MB** for the same 80 seconds, so the README leads
      with the mp4 and keeps the GIF as the fallback for viewers that will not play video.
      GIF is tuned hard for size (8 fps, 760px, 96-colour palette, coarse Bayer dither):
      a naive 1000px/10fps two-pass encode was 20 MB.
      Two things the recording taught me that guessing did not: "Skip questions, use
      defaults" **starts the preview itself** (there is no Run Preview button on that path
      — two earlier attempts to click one logged a warning I wrongly read as a selector
      bug, until I listed the live DOM's buttons), and the step-3 canvas does not exist for
      several seconds because the pipeline is model-generated, so a fixed wait clicked into
      a spinner.
23. [x] **Processing-methods panel rebuilt as one flat table; both reference sections
      folded by default.** The previous layout was boxes inside boxes, four levels deep: an
      `ExpandableSection variant="container"` (a box) → a div per role group (a box) → a
      `ColumnLayout` of per-family blocks (a box) → bordered rows inside each. Every level
      contributed a heading, a blurb and its own padding, so finding one method meant
      reading three layers of prose per group, and the same information appeared at
      different nesting depths depending on whether a group happened to hold one family or
      two (which is why a 1:1 group printed its own name three times in a row).
      Role and Family are now COLUMNS, not containers — still visible, and now sortable.
      What that buys, beyond looking flat:
      - **Sort by price across billing models.** Token-priced, page-priced and two-stage
        methods were previously incomparable because each family formatted its own units;
        the sort key is `estimatedCostPerPage`, the one figure common to all three.
      - **Filter by name/family/role/id** — the id matters because someone reading an API
        response or an error message searches for `sagemaker-baidu-ocr`, not "Baidu OCR".
      - **"Available here only"** toggle: 8 of 29 are unavailable on a default deployment,
        and someone choosing what to run wants the runnable set in one click. They stay
        listed by default because the catalog is a reference — hiding them is what made
        "29 methods" disagree with the list in the first place.
      - The counter reads `visibleMethodRows.length` of `METHOD_ROWS.length`, so a
        hand-written count can no longer contradict what is rendered.
      Rows are built from `METHODS` directly rather than by walking the role groups, so the
      29-vs-22 class of bug is now structurally impossible rather than merely tested for:
      an ungrouped family renders with an "Other" role label instead of vanishing.
      Family notes (Guardrails is PII-only, Pegasus cannot read a document, self-hosted OCR
      bills by GPU hour) moved to a hover on the Family cell — the information was worth
      keeping, the per-group paragraphs were not.
      **Folded by default**, along with the support matrix: both are reference tables (29
      rows, and a 33x29 grid), and expanded they pushed the one thing a first-time visitor
      needs to do — upload a document — well below the fold, making the landing page read
      as a spec sheet. Capabilities stays open because it answers "what can this thing even
      do?". Verified live on both stacks: folded on load, 29 rows on expand, 21 with the
      availability toggle, filter and sort both working.
24. [x] **Support matrix is now responsive — full-width instead of a fixed 1168px.**
      Measured before: the table was intrinsically sized, so it rendered at ~1168px
      regardless of the window — **70px of dead space** beside it at a 1600px viewport, and
      a **horizontal scrollbar at 1280px** even though the same 29 columns fit comfortably
      in a narrower grid. `table-layout: fixed` + `width: 100%` hands the distribution to
      the browser: the label column takes its declared width, the 29 data columns share the
      remainder.
      Two details that are load-bearing:
      - The label column must be pinned with **`width`, not `min-width`** — under a fixed
        table layout the first row's declared widths decide the grid and `min-width` is
        silently ignored. The row headers also had to drop their own `min-width`/`nowrap`
        pair, which was what forced the table wider than its container.
      - A `min-width: 848px` floor (210px label + 29 columns at a 22px legible minimum)
        keeps it from compressing into unreadable 1px columns; below that it scrolls, which
        is the honest fallback for a 30-column grid rather than pretending it fits.
      Measured after: **100% fill from 1440px up**, columns scaling 30→41px with the
      window, zero clipped rotated labels, scrolling only below ~1300px. Verified live on
      both stacks at 1440/1600/1920.
      Also cleaned up the stale "22 methods / 22 columns" counts that survived in this
      component's comments and header long after there were 29 — a comment asserting 22 is
      how the next reader concludes the column list is complete when it is not. A test now
      fails on any hardcoded method count in the file.
      **Note on the CSS:** these rules live in a template literal in `main.tsx` (Cloudscape
      hashes its custom-property names, so they cannot be authored as tokens). Backticks in
      a comment inside that literal terminate the string — my first attempt did exactly
      that and broke the build with eight bogus TS1005 errors. Keep comments there
      backtick-free.
25. [x] **The generated project now genuinely builds and synthesises.** Previously it could
      not, and no test could see that because the generator was only ever unit-tested on
      the strings it produced. `scripts/verify-generated-code.mjs` writes the real 12-file
      bundle to a temp dir, runs `npm install`, `tsc --noEmit`, `python3 -m py_compile` and
      **`cdk synth`**, and it found four more defects beyond the five from the audit:
      - **`cdk/package.json` listed none of the AWS SDK clients** its own bundled Lambda
        imports — seven `Cannot find module '@aws-sdk/...'` errors. Both manifests also
        hardcoded every SDK regardless of the pipeline; deps are now derived from the
        methods in use (`runtimeDependencies`), so a Claude-only project no longer installs
        the Textract and BDA clients it never calls.
      - **No `tsconfig.json` shipped at all**, yet `npm run build` is just `tsc` and
        `cdk.json` runs `ts-node --prefer-ts-exts`. Both need one. Added
        `generateCdkTsConfig`.
      - **`process.ts` carried an ESM-only CLI shim** (top-level `await`,
        `import.meta.url`) into the `cdk/` copy, which compiles as CommonJS — three errors.
        `generateTypeScriptCode` now takes `{ cli: false }` for that copy, wired through a
        new `ZIP_COPY_OVERRIDES`.
      - **`cdk synth` failed even after `tsc` passed:** `bin/idp.ts` imported
        `'../lib/idp-stack.js'`, and ts-node's CommonJS resolution does not map a `.js`
        specifier onto a sibling `.ts`. This is the important lesson — `tsc` accepted it
        under Node16 resolution and only *running* synth surfaced it, exactly like the
        `const process` shadowing that typechecked and then threw. **Compile-only gates are
        not enough for generated code.** Imports are extensionless now and the tsconfig
        declares CommonJS, matching how cdk.json actually invokes the app.
      Result: **`cdk synth` renders a 34-resource CloudFormation template**, checked to
      contain a Lambda, a bucket and a table rather than just "synth exited 0".
26. [x] **Mermaid verified against the model's REAL output, not just my own test cases.**
      `scripts/mermaid-probe.mjs` proves the sanitizer handles 26 shapes I chose; it does
      not prove the model's actual diagrams survive. `scripts/verify-live-diagram.mjs` calls
      `/api/architecture` on a live deployment, captures each `<diagram>` from the SSE
      stream, and renders it through the shipped `sanitizeMermaid` in Chromium.
      **4/4 real diagrams render, 0 needed repair** — the prompt rules are working upstream,
      and the sanitizer is now a safety net rather than the thing holding it together.
      Both probes compile the sanitizer with the real TypeScript transpiler; regex-stripping
      the annotations mangles `const NEEDS_QUOTING = /[()[\]{}:&]/` (the `:&` inside the
      character class looks like a type annotation) and throws an error that has nothing to
      do with the code under test.
27. [x] **Legacy binary Office formats: `.doc` implemented, `.ppt` rejected honestly.**
      Two container formats — OOXML (`.docx/.pptx/.xlsx`) is a ZIP, `50 4B 03 04`; CFB
      (`.doc/.ppt/.xls`) is legacy OLE, `D0 CF 11 E0`. All three generating adapters gated
      conversion on an **inlined ZIP-only magic-byte test**, so every CFB file failed the
      gate and fell through to `buffer.toString('utf-8')`.
      Measured on a real `.xls`: the model received the raw OLE header as text and the run
      was reported a **success with real token cost**. `.doc` was worse — advertised in the
      picker, and officeparser cannot read CFB at all.
      - `.doc` now parses via `word-extractor`. Verified **live end to end**: uploaded to
        the deployed stack, previewed with Claude Haiku, every identifier and amount
        extracted (264 input tokens — real text, not binary).
      - `.xls` now reaches `convertExcel` instead of being decoded as noise.
      - The three inlined gates are replaced by one `isBinaryOfficeBuffer`; a test fails if
        any adapter reintroduces its own.
      - `.ppt` is **removed from the accepted formats** (extension, MIME and resolver, since
        the upload filter tests MIME first) and rejected with an actionable 415: *"Open it in
        PowerPoint and save as .pptx."* No pure-JS parser reads that record stream and I
        could not produce a `.ppt` fixture to verify against — shipping untested code that
        claims the capability would repeat the original bug.
28. [x] **The support-matrix popover was clipped, losing the start of every description.**
      The matrix must live in `overflow: auto` (both axes can overflow), and an
      absolutely-positioned child of a scrolling ancestor is clipped at that ancestor's
      edge. The popover opens LEFT from a column pinned to the container's left edge, so it
      opened straight into the clip — the reader saw "…nns, sections," with the beginning
      cut off. No z-index fixes that; only escaping the overflow context does, via
      Cloudscape's `renderWithPortal`. Verified: `inOverflowAncestor: false`, x=440 fully
      on-screen, full sentence visible.
29. [x] **README demo re-recorded at 1920x1200 and embedded as real video.** The old asset
      looked poor for a measurable reason: it was captured at **1280x800 and then
      downscaled** to 1000 for the mp4 and 760 for the GIF, so every glyph was resampled
      twice. Probed four capture configurations before changing anything — Playwright's
      recorder honours a larger viewport exactly (1920x1200 in -> 1920x1200 out), while
      `--force-device-scale-factor=2` does **not** (still 1280x800), so a higher DPR buys
      nothing. Capturing at delivery resolution and never downscaling is the whole fix.
      **Delivery is now an mp4 embedded from a GitHub user-attachments URL**, which is the
      best option available and has three constraints worth writing down:
      - A committed `<video src="docs/images/walkthrough.mp4">` **does not render** on
        github.com. Only assets uploaded through GitHub's own UI get a player, so the file
        cannot be referenced from the repo at all.
      - The URL must sit **alone on its own line**. Wrapped in `<p>`, `<a>` or `[](...)`,
        GitHub renders *nothing* — silently, with no fallback. The caption therefore goes
        underneath rather than inline.
      - Publishing is manual by design: run the script, drag the mp4 into any issue or PR
        comment, paste the returned URL. `scripts/record-walkthrough.mjs` prints those steps
        on completion.
      Verified the uploaded URL end to end: authenticated fetch returns **200 video/mp4,
      1920x1200, 82s**, and its SHA-256 is **byte-identical** to what the script produced.
      (Anonymous fetch 404s until the URL is referenced from rendered markdown — worth
      knowing before concluding an upload failed.)
      **The recordings are now gitignored.** They were committed in `1e56a88` and are
      referenced by nothing now, so keeping them tracked would put ~27 MB into every clone
      forever. History is left alone — this is a pushed public repo and rewriting it to save
      space is not worth the disruption.
      Also produced: an animated **WebP** fallback via `img2webp` (ffmpeg here has no
      libwebp — checked the build flags). It is the right modern GIF replacement (24-bit
      colour, interframe compression, no palette banding on the Cloudscape greys), but at
      82 seconds it lands at 13 MB, so the mp4 is what the README shows. Three tests pin
      the embed shape, since both failure modes above are invisible in a local preview.
30. [ ] Accuracy measurement, calibration and 1S-TopK — the four highest-value
      ideas from the accelerator study, listed in detail in the section above.

### Open questions / risks
- [ ] `format_standardization` is documented as reference-only because nothing
      implements it. Either implement it or remove the capability.
- [ ] The advisor interview takes 3-5 turns before recommending. "Skip" is now
      the escape hatch, but the interview itself could be shortened.
- [ ] 126 dependabot vulnerabilities (2 critical) on the public repo. Pre-existing
      and untouched by this work.
- [ ] Both stacks running idle cost roughly **$160/month** (2× NAT, 2× ALB,
      4× Fargate). Destroy when not demoing.
