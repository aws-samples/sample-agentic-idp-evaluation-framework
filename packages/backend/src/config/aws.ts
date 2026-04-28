import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockDataAutomationRuntimeClient } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { TextractClient } from '@aws-sdk/client-textract';
import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'us-west-2';

export const s3Client = new S3Client({ region });
export const bedrockClient = new BedrockRuntimeClient({ region });
export const bdaClient = new BedrockDataAutomationRuntimeClient({ region });
export const textractClient = new TextractClient({ region });
export const agentCoreClient = new BedrockAgentCoreClient({ region });
const ddbClient = new DynamoDBClient({ region });
export const docClient = DynamoDBDocumentClient.from(ddbClient);

export const config = {
  region,
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3OutputPrefix: process.env.S3_OUTPUT_PREFIX ?? 'outputs/',
  bdaProfileArn: process.env.BDA_PROFILE_ARN ?? '',
  bdaProjectArn: process.env.BDA_PROJECT_ARN ?? '',
  bedrockGuardrailId: process.env.BEDROCK_GUARDRAIL_ID ?? '',
  bedrockGuardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT',
  claudeModelId: process.env.CLAUDE_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6',
  novaModelId: process.env.NOVA_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0',
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  agentUrl: process.env.AGENT_URL ?? '',
  agentRuntimeArn: process.env.AGENTCORE_RUNTIME_ARN ?? '',
  activityTable: process.env.ACTIVITY_TABLE ?? 'one-idp-activity',
  adminUsers: (process.env.ADMIN_USERS ?? '').split(',').map((u) => u.trim()).filter(Boolean),
  authProvider: (process.env.AUTH_PROVIDER ?? 'none') as 'cognito' | 'none' | 'midway',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
