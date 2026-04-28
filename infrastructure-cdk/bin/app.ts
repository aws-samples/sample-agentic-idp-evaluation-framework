#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OneIdpStack } from '../lib/one-idp-stack';

const app = new cdk.App();

const projectName = app.node.tryGetContext('projectName') ?? process.env.PROJECT_NAME ?? 'one-idp';
const environment = app.node.tryGetContext('environment') ?? process.env.ENVIRONMENT ?? 'dev';
const region = app.node.tryGetContext('region') ?? process.env.CDK_DEFAULT_REGION ?? 'us-west-2';
const account = process.env.CDK_DEFAULT_ACCOUNT;

new OneIdpStack(app, `${projectName}-${environment}`, {
  env: { account, region },
  projectName,
  environment,
  domainName: app.node.tryGetContext('domainName') ?? '',
  route53ZoneId: app.node.tryGetContext('route53ZoneId') ?? '',
  bdaProfileArn: app.node.tryGetContext('bdaProfileArn') ?? '',
  bdaProjectArn: app.node.tryGetContext('bdaProjectArn') ?? '',
  ecrImageTag: app.node.tryGetContext('ecrImageTag') ?? 'latest',
  claudeModelId: app.node.tryGetContext('claudeModelId') ?? 'us.anthropic.claude-sonnet-4-6',
  novaModelId: app.node.tryGetContext('novaModelId') ?? 'us.amazon.nova-2-lite-v1:0',
  authProvider: (app.node.tryGetContext('authProvider') ?? 'none') as 'none' | 'cognito',
  adminUsers: app.node.tryGetContext('adminUsers') ?? '',
  cognitoUserPoolId: app.node.tryGetContext('cognitoUserPoolId') ?? '',
  cognitoClientId: app.node.tryGetContext('cognitoClientId') ?? '',
  corsAllowedOrigins: app.node.tryGetContext('corsAllowedOrigins') ?? ['http://localhost:5173'],
  // Guardrails: by default create and manage a PII guardrail alongside the stack.
  // Override with -c manageGuardrail=false -c bedrockGuardrailId=<id> to reuse an existing one.
  manageGuardrail: app.node.tryGetContext('manageGuardrail') !== 'false',
  bedrockGuardrailId: app.node.tryGetContext('bedrockGuardrailId') ?? '',
  bedrockGuardrailVersion: app.node.tryGetContext('bedrockGuardrailVersion') ?? 'DRAFT',
});

app.synth();
