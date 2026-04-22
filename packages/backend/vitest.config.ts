import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from repo root so live AWS tests see BEDROCK_GUARDRAIL_ID,
// AWS_REGION, and S3_BUCKET. Must happen before test-env passing.
dotenv.config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    // Only run .ts tests from src — avoid picking up stale compiled copies in dist.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    // Extend timeout for live-AWS integration tests that hit Textract + Bedrock.
    testTimeout: 120_000,
  },
});
