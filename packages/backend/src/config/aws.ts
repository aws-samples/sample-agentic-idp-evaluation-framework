import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockDataAutomationRuntimeClient } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { TextractClient } from '@aws-sdk/client-textract';
import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { SageMakerRuntimeClient } from '@aws-sdk/client-sagemaker-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'us-west-2';

/**
 * Every account gets a built-in BDA "standard" data-automation profile whose
 * ARN is derivable from account + region. Both Terraform and CDK now pass that
 * derived ARN in BDA_PROFILE_ARN, but local/dev runs often have only
 * AWS_ACCOUNT_ID set — derive it there too so BDA methods are not silently
 * disabled (the adapters throw "BDA Profile ARN not configured" and the routes
 * filter every BDA method out when this is empty).
 *
 * Verified live: invoking the public-default project with this derived profile
 * ARN completes successfully (status Success in ~7s).
 */
function resolveBdaProfileArn(): string {
  const explicit = process.env.BDA_PROFILE_ARN;
  if (explicit) return explicit;
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (!accountId) return '';
  return `arn:aws:bedrock:${region}:${accountId}:data-automation-profile/us.data-automation-v1`;
}

export const s3Client = new S3Client({ region });
export const bedrockClient = new BedrockRuntimeClient({ region });
export const bdaClient = new BedrockDataAutomationRuntimeClient({ region });
export const textractClient = new TextractClient({ region });
export const agentCoreClient = new BedrockAgentCoreClient({ region });
export const sageMakerRuntimeClient = new SageMakerRuntimeClient({ region });
const ddbClient = new DynamoDBClient({ region });
/**
 * `removeUndefinedValues` is required, not optional tuning.
 *
 * Run records embed whole processor results, which legitimately contain optional
 * fields left undefined (no error, no token usage, no bounding boxes). Without
 * this the marshaller rejects the entire write with
 * "Pass options.removeUndefinedValues=true to remove undefined values from
 * map/array/set", so no run was ever saved and Recent Runs stayed empty.
 * Stripping the top-level keys before the call was not enough — the undefined
 * values are nested inside those results.
 */
export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const config = {
  region,
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3OutputPrefix: process.env.S3_OUTPUT_PREFIX ?? 'outputs/',
  bdaProfileArn: resolveBdaProfileArn(),
  bdaProjectArn: process.env.BDA_PROJECT_ARN ?? '',
  bedrockGuardrailId: process.env.BEDROCK_GUARDRAIL_ID ?? '',
  bedrockGuardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT',
  claudeModelId: process.env.CLAUDE_MODEL_ID ?? 'us.anthropic.claude-opus-5',
  novaModelId: process.env.NOVA_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0',
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  agentUrl: process.env.AGENT_URL ?? '',
  agentRuntimeArn: process.env.AGENTCORE_RUNTIME_ARN ?? '',
  activityTable: process.env.ACTIVITY_TABLE ?? 'one-idp-activity',
  adminUsers: (process.env.ADMIN_USERS ?? '').split(',').map((u) => u.trim()).filter(Boolean),
  authProvider: (process.env.AUTH_PROVIDER ?? 'none') as 'cognito' | 'none' | 'midway',
  nodeEnv: process.env.NODE_ENV ?? 'development',

  /*
   * Run-history privacy switch. MUST be on for any shared/public deployment.
   *
   * With AUTH_PROVIDER=none every visitor authenticates as the same alias
   * ('local-user' unless DEV_USER_ALIAS is set), so `getRecentRuns(user.alias)`
   * returns ONE shared list — meaning any visitor can open, resume and read the
   * documents someone else uploaded. On the public CloudFront demo that is document
   * disclosure between strangers, and cross-contamination of one person's evaluation
   * with another's file.
   *
   * When true: /api/runs returns an empty list, /api/runs/:id refuses to serve a
   * record, and the client hides both the Recent Runs nav item and the
   * "evaluation in progress" resume banner. Enforced SERVER-side on purpose — a
   * hidden nav link is not a security control, since the endpoint is still callable.
   *
   * Defaults ON when authentication is disabled, because that is exactly the
   * condition that makes history unsafe; an authenticated deployment can leave it
   * off and get per-user history as intended.
   */
  disableRunHistory:
    (process.env.DISABLE_RUN_HISTORY ?? '').toLowerCase() === 'true'
    || ((process.env.DISABLE_RUN_HISTORY ?? '') === ''
      && (process.env.AUTH_PROVIDER ?? 'none') === 'none'),

  /*
   * Specialist OCR endpoints, opt-in and OFF by default.
   *
   * Each is a self-hosted SageMaker real-time endpoint on a GPU instance that bills
   * by the hour whether or not it is serving traffic — ml.g6e.2xlarge is $2.24/hr and
   * ml.g7e.4xlarge $7.09/hr, so five idle endpoints would add well over $1,000/month
   * to a demo stack. Unset means the method reports unavailable with that reason,
   * exactly like bda-custom, so it stays visible in the catalog as a documented
   * option without pretending this deployment can run it.
   *
   * Set to the endpoint NAME (not ARN), e.g. SAGEMAKER_OCR_INFINITY=multi-ocr-infinity-parser2.
   */
  sagemakerOcrEndpoints: {
    'sagemaker-infinity-parser2': process.env.SAGEMAKER_OCR_INFINITY ?? '',
    'sagemaker-baidu-ocr': process.env.SAGEMAKER_OCR_BAIDU ?? '',
    'sagemaker-surya-ocr': process.env.SAGEMAKER_OCR_SURYA ?? '',
    'sagemaker-chandra-ocr': process.env.SAGEMAKER_OCR_CHANDRA ?? '',
    'sagemaker-dots-ocr': process.env.SAGEMAKER_OCR_DOTS ?? '',
    'sagemaker-qwen3-vl': process.env.SAGEMAKER_OCR_QWEN3VL ?? '',
  } as Record<string, string>,
  /**
   * Per-image cost of the SageMaker OCR stage, overridable because it is a function
   * of YOUR instance type and throughput, not of the model. Default is the measured
   * ml.g6e.2xlarge figure ($2.24/hr / ~263 img/hr).
   */
  sagemakerOcrCostPerPage: parseFloat(process.env.SAGEMAKER_OCR_COST_PER_PAGE ?? '0.0085'),
};
