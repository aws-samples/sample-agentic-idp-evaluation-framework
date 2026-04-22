import { Router } from 'express';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Capability, ProcessorResult, ComparisonResult, ProcessingMethod, PipelineDefinition } from '@idp/shared';
import { METHOD_INFO, CAPABILITY_INFO } from '@idp/shared';
import { bedrockClient, config } from '../config/aws.js';

interface CodeGenRequest {
  capabilities: Capability[];
  processingResults: ProcessorResult[];
  comparison?: ComparisonResult | null;
  pipelineMethods?: Record<string, string>;
  pipeline?: PipelineDefinition | null;
  selectedMethod?: ProcessingMethod;
}

interface GeneratedArtifacts {
  python: string | null;
  pythonRequirements: string | null;
  typescript: string | null;
  typescriptPackageJson: string | null;
  cdk: string | null;
  cdkLambdaHandler: string | null;
  cdkAppEntry: string | null;
  cdkPackageJson: string | null;
  cdkJson: string | null;
  readme: string | null;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/**
 * Short reference excerpts mirroring our backend adapters in
 * `packages/backend/src/adapters/*`. These are INCLUDED IN THE PROMPT so the
 * LLM produces code that matches proven-working patterns (BDA poll loop,
 * Textract sync/async, Converse w/ PDF bytes, YAML parse) rather than
 * hallucinated boilerplate.
 */
const REFERENCE_SNIPPETS = `
REFERENCE — proven working patterns copied from our TypeScript backend
(use these verbatim shapes; translate to Python or TS as needed):

--- BDA invoke + poll (runs standalone or as Phase-1 of BDA+LLM) ---
const invoke = new InvokeDataAutomationAsyncCommand({
  clientToken: randomUUID(),
  inputConfiguration: { s3Uri: inputS3Uri },
  outputConfiguration: { s3Uri: \`s3://\${bucket}/bda-output/\${method}/\` },
  dataAutomationProfileArn: process.env.BDA_PROFILE_ARN!,
  dataAutomationConfiguration: {
    dataAutomationProjectArn:
      process.env.BDA_PROJECT_ARN ||
      \`arn:aws:bedrock:\${region}:aws:data-automation-project/public-default\`,
    stage: 'LIVE',
  },
});
const { invocationArn } = await bda.send(invoke);

// Poll every 5s up to ~5 minutes. Terminal statuses: Success | ServiceError | ClientError.
let status = 'InProgress', outputUri = '';
for (let i = 0; i < 60 && !['Success','ServiceError','ClientError'].includes(status); i++) {
  await sleep(5000);
  const r = await bda.send(new GetDataAutomationStatusCommand({ invocationArn }));
  status = r.status ?? 'InProgress';
  if (status === 'Success') outputUri = r.outputConfiguration?.s3Uri ?? '';
  if (status === 'ServiceError' || status === 'ClientError')
    throw new Error(\`BDA \${status}: \${(r as any).errorMessage}\`);
}

// Fetch job_metadata.json from outputUri, then follow
// output_metadata[].segment_metadata[].standard_output_path to the real result JSON.
// Result JSON shape:
//   { pages: [{ representation: { markdown } }],
//     elements: [{ type: 'TABLE'|'KEY_VALUE'|'TEXT'|..., representation: { markdown, html, text } }] }

--- Textract sync (<=5MB single-page) vs async (multi-page PDF) ---
if (multiPage && s3Uri) {
  const { JobId } = await textract.send(new StartDocumentAnalysisCommand({
    DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
    FeatureTypes: ['TABLES', 'FORMS'],
  }));
  // Poll GetDocumentAnalysis every 3s up to ~3 min, paginate via NextToken.
} else {
  const r = await textract.send(new AnalyzeDocumentCommand({
    Document: { Bytes: docBytes },
    FeatureTypes: ['TABLES', 'FORMS'],
  }));
  blocks = r.Blocks ?? [];
}
const ocrText = blocks.filter(b => b.BlockType === 'LINE').map(b => b.Text).join('\\n');

--- Direct LLM via Converse (Claude / Nova) ---
// PDF path: pass document bytes directly.
// Image path: resize if > 4.5 MB (sharp / Pillow), use format 'jpeg'|'png'|'gif'|'webp'.
const cmd = new ConverseCommand({
  modelId,                       // e.g. us.anthropic.claude-sonnet-4-6
  system: [{ text: SYSTEM_PROMPT }],
  messages: [{ role: 'user', content: [
    { document: { name: 'document', format: 'pdf', source: { bytes: docBytes } } },
    { text: \`Extract: \${capabilities.join(', ')}\` },
  ]}],
  inferenceConfig: { maxTokens: 8192, temperature: 0 },
});
const out = await bedrock.send(cmd);
// Output is YAML with one top-level key per capability: { data, confidence, format }.
// Parse defensively: try raw YAML → strip \`\`\`yaml fences → raw JSON → fenced JSON → first {..}.

--- Two-phase (BDA|Textract → LLM) system prompt ---
"You are a document structuring AI. Given raw extraction output from {BDA|Textract},
structure it for the requested capabilities. Return a JSON object with each
capability as a key; each value has { data, confidence (0-1), format }.
Return ONLY valid JSON — no markdown fences."
`;

const CAPABILITY_GUIDANCE: Record<string, string> = {
  document_summarization: 'Plain-text paragraphs. Do NOT output tables.',
  text_extraction: 'Extract all visible text preserving reading order.',
  table_extraction: 'Return HTML <table> with <thead>/<tbody>/<tr>/<td>. Only REAL tables.',
  kv_extraction: 'Return a flat JSON object { key: value } for each field on the document.',
  image_description: 'Describe images/charts/diagrams as plain text.',
  entity_extraction: 'JSON list of entities: [{ type, value, page? }]. Types: person, date, amount, address, ...',
  document_classification: 'Single classification label (invoice, contract, form, receipt, ...).',
  document_splitting: 'Array of { startPage, endPage, docType } when multiple logical docs exist.',
  language_detection: 'Array of ISO-639-1 codes sorted by prevalence.',
  pii_detection: 'Array of { type, value, page?, bbox? }. Types: ssn, email, phone, name, address, dob, credit_card.',
  pii_redaction: 'Return the text with PII replaced by [REDACTED:<type>].',
  layout_analysis: 'Array of layout blocks with type (header, footer, column, section, ...).',
  handwriting_recognition: 'Extract handwritten text separately from printed text.',
  signature_detection: 'Array of { page, bbox, present } for signature fields.',
  barcode_qr_detection: 'Array of { type, value, page, bbox }.',
  bounding_box_extraction: 'Array of { text, page, bbox: [x,y,w,h] } for each extracted element.',
};

function buildCodeGenPrompt(req: CodeGenRequest): string {
  // ─── Build method→capabilities map ────────────────────────────────────────
  // Priority order:
  //   1. Pipeline method-nodes (user's Step 3 choice — source of truth).
  //   2. Explicit pipelineMethods map (older API shape).
  //   3. Comparison matrix highest-confidence.
  //   4. Processing results directly.
  const methodCaps = new Map<string, string[]>();
  if (req.pipeline) {
    for (const node of req.pipeline.nodes) {
      if (node.type !== 'method') continue;
      const method = (node.config as any).method as string | undefined;
      const caps = ((node.config as any).capabilities as string[] | undefined) ?? [];
      if (!method) continue;
      const filtered = caps.filter((c) => (req.capabilities as string[]).includes(c));
      if (filtered.length === 0) continue;
      const existing = methodCaps.get(method) ?? [];
      methodCaps.set(method, Array.from(new Set([...existing, ...filtered])));
    }
  }
  if (methodCaps.size === 0 && req.pipelineMethods) {
    for (const [cap, method] of Object.entries(req.pipelineMethods)) {
      if (!methodCaps.has(method)) methodCaps.set(method, []);
      methodCaps.get(method)!.push(cap);
    }
  }
  if (methodCaps.size === 0 && req.comparison?.capabilityMatrix) {
    for (const cap of req.capabilities) {
      const matrix = req.comparison.capabilityMatrix[cap];
      if (!matrix) continue;
      let bestMethod = '';
      let bestConf = -1;
      for (const [method, data] of Object.entries(matrix)) {
        const conf = (data as { confidence?: number })?.confidence ?? 0;
        if (conf > bestConf) { bestConf = conf; bestMethod = method; }
      }
      if (bestMethod) {
        if (!methodCaps.has(bestMethod)) methodCaps.set(bestMethod, []);
        methodCaps.get(bestMethod)!.push(cap);
      }
    }
  }
  if (methodCaps.size === 0) {
    for (const r of req.processingResults) {
      if (r.status !== 'complete') continue;
      const caps = Object.keys(r.results).filter(c => req.capabilities.includes(c as Capability));
      if (caps.length > 0) methodCaps.set(r.method, caps);
    }
  }

  // Detect sequential-composer so we can tell the LLM to emit a serial chain.
  const composerStages: string[] = req.pipeline?.nodes.find((n) => n.type === 'sequential-composer')
    ? (req.pipeline!.nodes.find((n) => n.type === 'sequential-composer')!.config as any).stages ?? []
    : [];
  const sequentialMethodIds: string[] = composerStages
    .map((stageId) => req.pipeline?.nodes.find((n) => n.id === stageId))
    .filter(Boolean)
    .map((n) => (n!.config as any).method as string)
    .filter(Boolean);

  // ─── Describe each selected method in terms the LLM needs to emit code ────
  const methodDetails = Array.from(methodCaps.entries()).map(([method, caps]) => {
    const info = METHOD_INFO[method as ProcessingMethod];
    const family = info?.family ?? 'unknown';
    const adapterType =
      family === 'bda' ? 'bda-sync-poll' :
      family === 'bda-llm' ? 'bda-then-llm' :
      family === 'textract-llm' ? 'textract-then-llm' :
      'direct-llm';

    const capLines = caps.map(c => {
      const ci = CAPABILITY_INFO[c as keyof typeof CAPABILITY_INFO];
      const guidance = CAPABILITY_GUIDANCE[c] ?? `Extract ${c.replace(/_/g, ' ')}.`;
      return `    • ${c} (${ci?.name ?? c}) — ${guidance}`;
    }).join('\n');

    const result = req.processingResults.find(r => r.method === method && r.status === 'complete');
    const metrics = result
      ? `Measured: ${result.metrics.latencyMs}ms, $${result.metrics.cost.toFixed(4)}${
          result.metrics.tokenUsage
            ? `, ${result.metrics.tokenUsage.inputTokens} in / ${result.metrics.tokenUsage.outputTokens} out tokens`
            : ''
        }`
      : 'Measured: (not run in preview — infer from family defaults)';

    return `Method ID: ${method} (${info?.shortName ?? method})
  Family: ${family}
  Adapter pattern: ${adapterType}
  Model ID: ${info?.modelId ?? 'N/A'}
  Pricing: $${info?.tokenPricing.inputPer1MTokens ?? 0}/M in, $${info?.tokenPricing.outputPer1MTokens ?? 0}/M out, ~$${info?.estimatedCostPerPage ?? 0}/page
  ${metrics}
  Capabilities assigned to this method:
${capLines}`;
  }).join('\n\n');

  const capList = req.capabilities.join(', ');
  const methodIds = Array.from(methodCaps.keys()).join(', ');

  const sequentialBlock = sequentialMethodIds.length >= 2
    ? `\n\nSEQUENTIAL COMPOSITION REQUIRED:
The user assembled a pipeline where stages run SERIALLY. The extract stage(s)
produce text, and the final stage (${sequentialMethodIds[sequentialMethodIds.length - 1]}) consumes that text.
Emit code that runs these methods in order: ${sequentialMethodIds.join(' → ')}.
The downstream stage must receive \`precomputedText\` from upstream and SKIP
its own OCR/Textract step. Typical pattern: LLM extract → Guardrails ApplyGuardrail.
The CDK Step Functions definition MUST reflect this chain (Task → Task → Choice).
Do NOT run these methods in parallel and aggregate.`
    : '';

  const selectedMethodBlock = req.selectedMethod
    ? `\n\nUSER-SELECTED METHOD: The user explicitly picked ${req.selectedMethod} on the comparison screen. Use this as the primary extraction method where appropriate — do not swap it for a cheaper one.`
    : '';

  return `You are generating a COMPLETE, PRODUCTION-READY, RUNNABLE IDP project.
The user has already run a live benchmark; you know which methods to use and for which capabilities.
Do NOT hallucinate models, SDKs, or APIs. Match the reference shapes below exactly.

REAL BENCHMARK RESULTS — USE THESE EXACT METHODS AND MODEL IDs:
${methodDetails}

All requested capabilities: ${capList}
Method IDs in use: ${methodIds}${selectedMethodBlock}${sequentialBlock}

${REFERENCE_SNIPPETS}

DELIVERABLES — you must produce ALL of the following files. Each is wrapped in
explicit tags so a downstream parser can split them. No prose outside tags.

1. <python> — \`process.py\` (Python 3.11+, boto3).
   REQUIREMENTS:
   - Imports: boto3, botocore.config.Config, yaml, json, time, os, uuid, pathlib, logging, typing.
   - Use \`boto3.client("bedrock-runtime", config=Config(retries={"max_attempts": 5, "mode": "adaptive"}))\`.
   - One function per adapter family actually needed (BDA, BDA+LLM, Textract+LLM, direct-LLM).
   - A top-level \`process_document(doc_bytes, file_name, s3_uri=None) -> dict\` that dispatches per capability
     according to METHOD_ASSIGNMENTS (a module-level dict).
   - Include the ACTUAL system prompt (copy from reference) for YAML output with capability→{data,confidence,format}.
   - Parse YAML defensively (try raw → strip fences → fall through to JSON).
   - Track per-call token usage and emit a per-method cost using the exact pricing from above.
   - For BDA: use \`bedrock-data-automation-runtime\` client, poll every 5s up to 60 attempts, read
     \`job_metadata.json\` then follow \`output_metadata[].segment_metadata[].standard_output_path\` to the result JSON.
   - For Textract: sync \`analyze_document\` for single-page/images, async \`start_document_analysis\` + poll
     \`get_document_analysis\` with NextToken pagination for multi-page PDFs.
   - For images, resize with Pillow if >4.5MB; pass PDF bytes directly via Converse \`document\` block.
   - A \`__main__\` block that reads \`sys.argv[1]\` (path to document) and prints JSON results.
   - Robust error handling (\`ClientError\`), structured \`logging\` (NOT \`print\` for non-result output).
   - Typed with \`typing\` hints. No placeholder comments. No TODOs.
   - Target 250–450 lines — this is a real module, not a snippet.

2. <python_requirements> — \`requirements.txt\` pinning exact minors: boto3>=1.36, botocore>=1.36, PyYAML>=6.0, Pillow>=10.0.

3. <typescript> — \`process.ts\` (Node 20, TypeScript, ESM).
   REQUIREMENTS (mirror of python):
   - Imports from \`@aws-sdk/client-bedrock-runtime\`, \`@aws-sdk/client-bedrock-data-automation-runtime\`,
     \`@aws-sdk/client-textract\`, \`@aws-sdk/client-s3\`, \`yaml\`, \`sharp\`, \`node:crypto\`, \`node:fs/promises\`.
   - Export \`processDocument(buf: Buffer, fileName: string, s3Uri?: string): Promise<PipelineResult>\`.
   - Full BDA poll loop AND Textract sync+async implementations (no "TODO", no commented-out code).
   - Converse-based direct-LLM function with the reference system prompt and YAML parsing.
   - Per-method token + cost tracking with the exact pricing constants from above.
   - Configure clients with \`maxAttempts: 5\` and \`requestHandler: new NodeHttpHandler({ requestTimeout: 300_000 })\`.
   - Typed interfaces \`CapabilityResult\`, \`MethodResult\`, \`PipelineResult\`.
   - A CLI entry: \`if (process.argv[1]?.endsWith('process.ts')) { ... }\`.
   - Target 250–450 lines.

4. <typescript_package_json> — \`package.json\` with dependencies pinned (aws-sdk v3 ^3.650, yaml ^2, sharp ^0.33, typescript ^5.6, tsx ^4), scripts \`build\`, \`start\`, \`cli\`.

5. <cdk> — \`lib/idp-stack.ts\` — a REAL deployable CDK v2 (TypeScript) stack.
   REQUIREMENTS:
   - Imports: \`aws-cdk-lib\`, \`aws-cdk-lib/aws-s3\`, \`aws-lambda\`, \`aws-lambda-nodejs\`, \`aws-iam\`,
     \`aws-stepfunctions\`, \`aws-stepfunctions-tasks\`, \`aws-dynamodb\`, \`aws-apigateway\`, \`aws-logs\`, \`constructs\`.
   - S3 \`inputBucket\` (versioned, SSE-S3, blockPublicAccess ALL, eventbridge: true, lifecycle NonCurrent→90d).
   - S3 \`outputBucket\` (same hardening).
   - DynamoDB \`resultsTable\`: PK \`documentId\` (S), SK \`methodId\` (S), PAY_PER_REQUEST, point-in-time recovery,
     removalPolicy RETAIN.
   - Lambda \`processorFn\` (aws-lambda-nodejs NodejsFunction) pointing at \`../lambda/processor.ts\`,
     Node 20, memory 2048 MB, timeout 10 min, ephemeralStorageSize 2 GB, retryAttempts 0, tracing ACTIVE,
     logRetention ONE_MONTH. Bundle with externals \`@aws-sdk/*\` (SDK is in the runtime), forceDockerBundling false.
   - Lambda environment variables: \`INPUT_BUCKET\`, \`OUTPUT_BUCKET\`, \`RESULTS_TABLE\`, \`BDA_PROFILE_ARN\`,
     \`BDA_PROJECT_ARN\`, \`METHOD_ASSIGNMENTS\` (JSON string of capability→method), \`CAPABILITIES\`, \`AWS_REGION\`.
   - IAM: inputBucket.grantRead(processorFn), outputBucket.grantReadWrite(processorFn),
     resultsTable.grantReadWriteData(processorFn).
   - Bedrock: LEAST-PRIVILEGE statement listing actual foundation-model ARNs for each model ID used
     (build the list from the method set above). Include inference-profile ARN for \`us.*\` IDs.
   - BDA IAM: \`bedrock:InvokeDataAutomationAsync\`, \`bedrock:GetDataAutomationStatus\` on the project ARN
     (use \`arn:aws:bedrock:\${region}:aws:data-automation-project/public-default\` when unset). And
     \`bedrock:InvokeDataAutomationAsync\` with the profile ARN as the resource condition (only for bda* methods).
   - Textract IAM: \`textract:AnalyzeDocument\`, \`textract:StartDocumentAnalysis\`, \`textract:GetDocumentAnalysis\`
     on \`*\` (service doesn't support resource-level) — only when a textract* method is in use.
   - Step Functions express state machine orchestrating: S3 ingest event → processorFn → DynamoDB write →
     choice for success/failure → SNS on failure. Include the actual definition with \`sfn.Chain\`.
   - API Gateway \`RestApi\` with a POST /process endpoint → Lambda integration, requestValidator, CORS ALL_METHODS.
   - CfnOutputs: inputBucketName, outputBucketName, resultsTableName, apiEndpoint, stateMachineArn.
   - NO reference to files that don't exist. \`entry: path.join(__dirname, '../lambda/processor.ts')\` must point
     at the handler you ALSO emit below.

6. <cdk_lambda_handler> — \`lambda/processor.ts\` — the actual Lambda code that the CDK stack points at.
   REQUIREMENTS:
   - APIGatewayProxyHandlerV2 signature AND S3 event handler (union type).
   - Reads bytes either from API body (base64) or from the S3 event (\`GetObjectCommand\`).
   - Imports and calls the SAME adapter functions the <typescript> file exposes (treat it as a local lib).
   - Writes results to DynamoDB (\`PutItemCommand\`) and writes raw output to the output bucket.
   - Returns \`{ statusCode: 200, body: JSON.stringify({ documentId, results }) }\`.
   - Target 120–200 lines.

7. <cdk_app_entry> — \`bin/idp.ts\` — CDK app entry:
   \`const app = new cdk.App(); new IdpStack(app, 'IdpStack', { env: { account: ..., region: ... } });\`.

8. <cdk_package_json> — \`package.json\` with cdk, aws-cdk-lib ^2.170, constructs ^10.4, aws-cdk ^2.170,
   typescript, ts-node, esbuild ^0.24. Scripts: build, watch, test, synth, deploy, diff, destroy.

9. <cdk_json> — \`cdk.json\` with app \`npx ts-node --prefer-ts-exts bin/idp.ts\` and standard \`context\` feature
   flags that match CDK v2 ^2.170.

10. <readme> — \`README.md\` — Markdown, 60–120 lines. Sections: Overview (link the measured benchmark),
    Prerequisites (AWS creds, region, Node 20, Python 3.11, bootstrap), Architecture (ASCII diagram OR
    mermaid fence), Local usage (python & ts CLI), Deploy (\`cdk bootstrap\`, \`cdk deploy\`, env vars to set),
    Costs (per-page + per-token from above), Cleanup (\`cdk destroy\`). NO emojis.

HARD RULES:
- NO placeholder comments ("# TODO", "// implement me", "# omitted for brevity"). Write the actual code.
- NO commented-out blocks of real logic. If BDA is used, its code runs — not commented.
- Match model IDs EXACTLY as given (including inference-profile prefixes like \`us.\`).
- Match adapter patterns from the reference snippets.
- Respond with ONLY the tagged blocks, in the order listed. Nothing before <python>, nothing after </readme>.
`;
}

/**
 * Pull a tagged block. Accepts \`<tag>\` or \`<tag name="...">\`. Trims surrounding whitespace.
 * Also tolerates an optional fenced code block inside the tags (\`\`\`lang ... \`\`\`) which some
 * models emit; strip the fence so the caller gets raw source.
 */
function extractTag(raw: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = raw.match(re);
  if (!m) return null;
  let body = m[1].trim();
  const fence = body.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fence) body = fence[1].trim();
  return body || null;
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as CodeGenRequest;

  if (!body.capabilities?.length) {
    res.status(400).json({ error: 'capabilities required' });
    return;
  }

  try {
    const prompt = buildCodeGenPrompt(body);

    const command = new ConverseCommand({
      modelId: config.claudeModelId,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 32768, temperature: 0.1 },
    });

    const response = await bedrockClient.send(command);
    const rawText = response.output?.message?.content?.[0]?.text ?? '';

    const artifacts: GeneratedArtifacts = {
      python: extractTag(rawText, 'python'),
      pythonRequirements: extractTag(rawText, 'python_requirements'),
      typescript: extractTag(rawText, 'typescript'),
      typescriptPackageJson: extractTag(rawText, 'typescript_package_json'),
      cdk: extractTag(rawText, 'cdk'),
      cdkLambdaHandler: extractTag(rawText, 'cdk_lambda_handler'),
      cdkAppEntry: extractTag(rawText, 'cdk_app_entry'),
      cdkPackageJson: extractTag(rawText, 'cdk_package_json'),
      cdkJson: extractTag(rawText, 'cdk_json'),
      readme: extractTag(rawText, 'readme'),
      tokenUsage: response.usage
        ? {
            inputTokens: response.usage.inputTokens ?? 0,
            outputTokens: response.usage.outputTokens ?? 0,
            totalTokens: response.usage.totalTokens
              ?? ((response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0)),
          }
        : undefined,
    };

    res.json(artifacts);
  } catch (err) {
    console.error('[Architecture Code Gen Error]', err);
    res.status(500).json({ error: 'Code generation failed' });
  }
});

export default router;
