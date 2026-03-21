# Open Questions

## IDP Unified Platform - 2026-03-17 (Revised after RALPLAN iteration 2)

### Resolved (from iteration 1)
- [x] Which specific Nova model for bounding boxes? -- **Resolved: Nova 2 Pro (`us.amazon.nova-2-pro-preview-20251202-v1:0`)**
- [x] Should the accuracy metric be self-reported confidence or compared against ground truth? -- **Resolved: Renamed to `confidence` throughout. Self-reported for demo. Ground truth is a non-goal.**
- [x] Is there an existing BDA Custom Blueprint project? -- **Resolved: Moved to Phase 1 prerequisite check. MVP works with 4 methods if no blueprint exists.**
- [x] AgentCore Runtime deployment specifics? -- **Resolved: Dockerfile + agentcore.config.json added to Phase 5.**

### Open
- [ ] Which AWS account and region will be used for the demo? -- Determines BDA project ARN, S3 bucket names, and model availability
- [ ] What S3 bucket should be used for uploads and BDA output? -- Need bucket name and confirm permissions
- [ ] Are there sample documents to bundle for the demo? -- Need 2-3 representative PDFs that exercise all 5 capabilities (tables, forms, images, handwriting, mixed)
- [ ] Is `@cloudscape-design/chat-components` v1.0.103 API stable enough for production chat UI? -- Package is relatively new; may need fallback to custom chat layout with standard Cloudscape components
- [ ] Does Nova 2 Pro support `document` content type in ConverseStreamCommand? -- If not, PDF pages must be converted to images before sending to Nova. Needs verification in Phase 3.
- [ ] Strands SDK v0.6.0 actual streaming event types and shapes -- Will be resolved by SDK spike in Phase 2 Step 2.0 (first 2 hours of Day 4)
- [ ] Does Cloudscape `BarChart`/`MixedLineBarChart` support the comparison visualizations needed? -- Verify that native Cloudscape charts can produce grouped bar charts for method comparison. Fallback: simple Cloudscape `Table` with visual indicators.

## Session 6 E2E Flow - 2026-03-19

- [ ] Pipeline execution results shape: does `node_complete` event include enough data to reconstruct `ProcessorResult[]`? -- The `node_complete` event has `result` (CapabilityResult record) and `metrics`, but may be missing `method` name, `status` field, and `modelId`. Need to verify the event payload matches what ArchitecturePage/ComparisonTable expects, or add a transformation step.
- [ ] Should ArchitecturePage render Mermaid diagrams natively? -- Backend `/api/architecture` returns `<diagram>` blocks with Mermaid syntax. Rendering requires adding `mermaid` npm package (~200KB). Alternative: show as a copyable code block and let user paste into mermaid.live. Decision affects bundle size.
- [ ] Should pipeline execution results persist across page refreshes? -- Currently all state lives in React memory. If user refreshes on `/architecture`, everything is lost. localStorage serialization is an option but adds complexity. Decide if this matters for demo vs. production use.
- [ ] ProcessingPage vs PipelinePage: should ProcessingPage be deprecated? -- Both pages run methods and produce results. ProcessingPage runs ALL selected methods in parallel (comparison mode). PipelinePage runs the pipeline's assigned methods. Having both may confuse users. Consider merging or clearly differentiating the UX purpose.
