/**
 * Test-run preconditions, applied BEFORE any module is imported.
 *
 * Several routing tests assert what the generator does when a service IS configured —
 * "audio routes to BDA", "PII routes to Guardrails". But `config` in config/aws.ts reads
 * the environment exactly once, at module evaluation, and nothing in the test run loads a
 * `.env` file. Static imports are hoisted, so a `beforeAll` that sets the variable runs
 * far too late: the module graph has already captured empty values, availability filters
 * the method out as unconfigured, and the assertion fails against CORRECT code.
 *
 * That produced six failing tests describing bugs that did not exist, while masking one
 * that did (Pegasus being selected for audio because BDA had been filtered away).
 *
 * A vitest `setupFiles` entry runs before the test module's imports are evaluated, which
 * is the only place this ordering can be fixed. Values are deliberately obvious
 * placeholders — no AWS call is made in these tests; only the "is it configured?" branch
 * is under test.
 */
process.env.BDA_PROFILE_ARN ||= 'arn:aws:bedrock:us-west-2:000000000000:data-automation-profile/test';
process.env.BEDROCK_GUARDRAIL_ID ||= 'test-guardrail';
process.env.BEDROCK_GUARDRAIL_VERSION ||= 'DRAFT';
process.env.AWS_REGION ||= 'us-west-2';

/*
 * `S3_BUCKET` is deliberately NOT set here.
 *
 * Setting it made nine `*.live.test.ts` cases attempt real S3 and Bedrock calls with
 * placeholder credentials. Those files gate themselves on the presence of the very
 * variables above — the pattern is `const live = process.env.BEDROCK_GUARDRAIL_ID` and
 * skip when absent — so a blanket default here silently converted "skipped, no
 * credentials" into "failed against AWS". Live tests opt in through a real environment;
 * this file only unblocks the pure-logic ones.
 *
 * `LIVE_TESTS_DISABLED` makes that explicit for the guardrail-backed suites, which
 * cannot tell a placeholder id from a real one by inspection.
 */
process.env.LIVE_TESTS_DISABLED ||= 'true';
