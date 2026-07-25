#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OneIdpStack } from '../lib/one-idp-stack';

const app = new cdk.App();

const projectName = app.node.tryGetContext('projectName') ?? process.env.PROJECT_NAME ?? 'one-idp-cdk';
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
  claudeModelId: app.node.tryGetContext('claudeModelId') ?? 'us.anthropic.claude-opus-5',
  novaModelId: app.node.tryGetContext('novaModelId') ?? 'us.amazon.nova-2-lite-v1:0',
  authProvider: (app.node.tryGetContext('authProvider') ?? 'none') as 'none' | 'cognito' | 'midway',
  adminUsers: app.node.tryGetContext('adminUsers') ?? '',
  cognitoUserPoolId: app.node.tryGetContext('cognitoUserPoolId') ?? '',
  cognitoClientId: app.node.tryGetContext('cognitoClientId') ?? '',
  corsAllowedOrigins: app.node.tryGetContext('corsAllowedOrigins') ?? ['http://localhost:5173'],
  // Guardrails: by default create and manage a PII guardrail alongside the stack.
  // Override with -c manageGuardrail=false -c bedrockGuardrailId=<id> to reuse an existing one.
  manageGuardrail: app.node.tryGetContext('manageGuardrail') !== 'false',
  bedrockGuardrailId: app.node.tryGetContext('bedrockGuardrailId') ?? '',
  bedrockGuardrailVersion: app.node.tryGetContext('bedrockGuardrailVersion') ?? 'DRAFT',
  /*
   * Run history stays OFF unless explicitly enabled.
   *
   * `-c disableRunHistory=false` turns it on, and should only be used on a
   * deployment with real per-user authentication. With authProvider 'none' every
   * visitor shares one alias, so a shared run list is document disclosure between
   * strangers plus cross-contamination of one person's evaluation with another's
   * file. Enforced server-side; the UI hiding is cosmetic.
   */
  disableRunHistory: app.node.tryGetContext('disableRunHistory') !== 'false',
  /*
   * Specialist OCR endpoints, opt-in. Pass only the ones you have deployed, e.g.
   *   -c sagemakerOcrInfinity=multi-ocr-infinity-parser2
   * Each is a GPU endpoint billed hourly even when idle (~$2.24-$7.09/hr), so an
   * unset entry leaves the method reporting "not configured" instead of failing.
   */
  sagemakerOcrEndpoints: {
    SAGEMAKER_OCR_INFINITY: app.node.tryGetContext('sagemakerOcrInfinity') ?? '',
    SAGEMAKER_OCR_BAIDU: app.node.tryGetContext('sagemakerOcrBaidu') ?? '',
    SAGEMAKER_OCR_SURYA: app.node.tryGetContext('sagemakerOcrSurya') ?? '',
    SAGEMAKER_OCR_CHANDRA: app.node.tryGetContext('sagemakerOcrChandra') ?? '',
    SAGEMAKER_OCR_DOTS: app.node.tryGetContext('sagemakerOcrDots') ?? '',
    SAGEMAKER_OCR_QWEN3VL: app.node.tryGetContext('sagemakerOcrQwen3Vl') ?? '',
  },
  sagemakerOcrCostPerPage: app.node.tryGetContext('sagemakerOcrCostPerPage') ?? '',
});

app.synth();
