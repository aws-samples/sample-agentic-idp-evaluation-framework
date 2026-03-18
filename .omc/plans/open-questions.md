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
