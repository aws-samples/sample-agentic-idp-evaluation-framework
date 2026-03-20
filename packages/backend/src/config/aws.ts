import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockDataAutomationRuntimeClient } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { TextractClient } from '@aws-sdk/client-textract';

const region = process.env.AWS_REGION ?? 'us-west-2';

export const s3Client = new S3Client({ region });
export const bedrockClient = new BedrockRuntimeClient({ region });
export const bdaClient = new BedrockDataAutomationRuntimeClient({ region });
export const textractClient = new TextractClient({ region });

export const config = {
  region,
  s3Bucket: process.env.S3_BUCKET ?? 'idp-unified-platform-uploads',
  s3OutputPrefix: process.env.S3_OUTPUT_PREFIX ?? 'outputs/',
  bdaProfileArn: process.env.BDA_PROFILE_ARN ?? '',
  bdaProjectArn: process.env.BDA_PROJECT_ARN ?? '',
  claudeModelId: process.env.CLAUDE_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6',
  novaModelId: process.env.NOVA_MODEL_ID ?? 'us.amazon.nova-2-pro-preview-20251202-v1:0',
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  agentUrl: process.env.AGENT_URL ?? 'http://localhost:3002',
  agentRuntimeId: process.env.AGENT_RUNTIME_ID ?? '',
};
