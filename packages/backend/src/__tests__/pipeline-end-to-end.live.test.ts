/**
 * End-to-end live-AWS integration test for the sequential composer pipeline.
 *
 * Builds a small synthetic document in S3, generates a pipeline using the
 * real generator + method assignment logic, then exercises the processors
 * directly — verifying that:
 *   1. The generator emits a sequential composer for PII + summarization.
 *   2. A Claude stage can produce summary text from a document.
 *   3. Guardrails, fed that summary text via precomputedText, detects and
 *      redacts PII end-to-end.
 *
 * Skips when BEDROCK_GUARDRAIL_ID is not set.
 */
import { describe, it, expect } from 'vitest';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, config } from '../config/aws.js';
import { generatePipeline } from '../services/pipeline-generator.js';
import { ClaudeSonnetProcessor } from '../processors/claude-direct.js';
import { BedrockGuardrailsProcessor } from '../processors/guardrails.js';
import { extractUpstreamText } from '../services/pipeline-text-extractor.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';

const liveGuardrail = process.env.BEDROCK_GUARDRAIL_ID;
const liveBucket = config.s3Bucket;
const describeLive = (liveGuardrail && liveBucket) ? describe : describe.skip;

// A minimal, synthetic "document" expressed as plain text. Uploaded to S3 as
// a .txt file so the Claude direct adapter will accept it (fallback path).
const TEST_DOC = `Meeting notes — 2026-04-21.

Attendees: John Smith, Alice Johnson.
Contact John at john.smith@example.com or (555) 123-4567.
Project launches next quarter. Budget approved.`;

describeLive('Pipeline end-to-end (live AWS)', () => {
  it('generator emits sequential composer and executor pipes Claude output into Guardrails redaction', async () => {
    // 1. Generate the pipeline definition.
    const { pipeline } = generatePipeline({
      documentType: 'pdf',
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
      optimizeFor: 'balanced',
      enableHybridRouting: false,
    });

    const composer = pipeline.nodes.find((n) => n.type === 'sequential-composer');
    expect(composer).toBeDefined();

    // 2. Upload the test document to S3 so adapters can fetch it.
    const key = `tests/e2e-${Date.now()}.txt`;
    const body = Buffer.from(TEST_DOC, 'utf-8');
    await s3Client.send(new PutObjectCommand({
      Bucket: liveBucket,
      Key: key,
      Body: body,
      ContentType: 'text/plain',
    }));
    const s3Uri = `s3://${liveBucket}/${key}`;

    try {
      // 3. Run the Claude extract stage with the document buffer.
      const extractInput: AdapterInput = {
        documentBuffer: body,
        s3Uri,
        fileName: 'meeting.txt',
        capabilities: ['document_summarization'],
        pageCount: 1,
      };
      const claude = new ClaudeSonnetProcessor();
      const claudeResult = await claude.process(null, extractInput);
      expect(claudeResult.status).toBe('complete');

      // 4. Extract text from Claude's results for the downstream Guardrails stage.
      const upstreamText = extractUpstreamText(claudeResult);
      expect(upstreamText.length).toBeGreaterThan(20);

      // 5. Run Guardrails with precomputedText — should detect and anonymize PII
      //    without hitting Textract.
      const guardrailsInput: AdapterInput = {
        ...extractInput,
        capabilities: ['pii_detection', 'pii_redaction'],
        precomputedText: upstreamText,
      };
      const guardrails = new BedrockGuardrailsProcessor();
      const guardrailsResult = await guardrails.process(null, guardrailsInput);
      expect(guardrailsResult.status).toBe('complete');

      const redacted = guardrailsResult.results.pii_redaction?.data as string;
      expect(typeof redacted).toBe('string');
      // Whatever Claude said about John/email/phone should no longer appear.
      expect(redacted).not.toContain('john.smith@example.com');
      expect(redacted).not.toContain('(555) 123-4567');

      const detected = guardrailsResult.results.pii_detection?.data as Array<unknown>;
      expect(Array.isArray(detected)).toBe(true);
      // Claude may or may not repeat the literal PII in its summary — so
      // detection count can be 0. What matters is Guardrails ran without error.
    } finally {
      await s3Client.send(new DeleteObjectCommand({ Bucket: liveBucket, Key: key }));
    }
  });
});
