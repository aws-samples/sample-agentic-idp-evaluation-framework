import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageConstruct } from './storage';
import { EcrConstruct } from './ecr';
import { AgentRuntimeConstruct } from './agent-runtime';
import { AppRunnerConstruct } from './app-runner';
import { EdgeConstruct } from './edge';
import { ActivityTableConstruct } from './activity-table';
import { GuardrailConstruct } from './guardrail';

export interface OneIdpStackProps extends cdk.StackProps {
  readonly projectName: string;
  readonly environment: string;
  readonly domainName?: string;
  readonly route53ZoneId?: string;
  readonly bdaProfileArn?: string;
  readonly bdaProjectArn?: string;
  readonly ecrImageTag: string;
  readonly claudeModelId: string;
  readonly novaModelId: string;
  readonly authProvider: 'none' | 'cognito' | 'midway';
  readonly adminUsers: string;
  readonly cognitoUserPoolId?: string;
  readonly cognitoClientId?: string;
  readonly corsAllowedOrigins: string[];
  readonly manageGuardrail?: boolean;
  readonly bedrockGuardrailId?: string;
  readonly bedrockGuardrailVersion?: string;
}

/**
 * Root stack. Splits concerns into three tiers:
 *   - web tier  (AppRunnerConstruct)      — Express HTTP API, App Runner managed
 *   - agent tier (AgentRuntimeConstruct)  — Bedrock AgentCore runtime (separate from web)
 *   - edge tier (EdgeConstruct)           — CloudFront + optional Route53 + ACM
 *
 * The web and agent tiers share a single ECR image (same backend package)
 * but run as separate compute so the agent scales / upgrades independently.
 */
export class OneIdpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OneIdpStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    const storage = new StorageConstruct(this, 'Storage', {
      projectName: props.projectName,
      environment: props.environment,
      corsAllowedOrigins: props.corsAllowedOrigins,
      domainName: props.domainName,
    });

    const ecr = new EcrConstruct(this, 'Ecr', {
      projectName: props.projectName,
    });

    const activity = new ActivityTableConstruct(this, 'Activity', {
      projectName: props.projectName,
      environment: props.environment,
    });

    const agent = new AgentRuntimeConstruct(this, 'AgentRuntime', {
      projectName: props.projectName,
      environment: props.environment,
      region: this.region,
      repository: ecr.repository,
      imageTag: props.ecrImageTag,
      uploadsBucket: storage.uploadsBucket,
      bdaProfileArn: props.bdaProfileArn ?? '',
      bdaProjectArn: props.bdaProjectArn ?? '',
      claudeModelId: props.claudeModelId,
      novaModelId: props.novaModelId,
    });

    // Bedrock Guardrail for the `bedrock-guardrails` method (managed PII path).
    // Defaults to creating one; set manageGuardrail=false + pass bedrockGuardrailId
    // to reuse an existing guardrail.
    const manageGuardrail = props.manageGuardrail ?? true;
    const guardrail = manageGuardrail
      ? new GuardrailConstruct(this, 'Guardrail', {
          projectName: props.projectName,
          environment: props.environment,
        })
      : undefined;
    const guardrailId = guardrail?.guardrailId ?? props.bedrockGuardrailId;
    const guardrailVersion = guardrail?.guardrailVersion ?? props.bedrockGuardrailVersion ?? 'DRAFT';
    const guardrailArn = guardrail?.guardrailArn
      ?? (props.bedrockGuardrailId
        ? `arn:aws:bedrock:${this.region}:${this.account}:guardrail/${props.bedrockGuardrailId}`
        : undefined);

    const api = new AppRunnerConstruct(this, 'Api', {
      projectName: props.projectName,
      environment: props.environment,
      region: this.region,
      repository: ecr.repository,
      imageTag: props.ecrImageTag,
      uploadsBucket: storage.uploadsBucket,
      activityTable: activity.table,
      agentRuntimeArn: agent.runtimeArn,
      bdaProfileArn: props.bdaProfileArn ?? '',
      bdaProjectArn: props.bdaProjectArn ?? '',
      claudeModelId: props.claudeModelId,
      novaModelId: props.novaModelId,
      authProvider: props.authProvider,
      adminUsers: props.adminUsers,
      cognitoUserPoolId: props.cognitoUserPoolId ?? '',
      cognitoClientId: props.cognitoClientId ?? '',
      siteUrl: props.domainName ? `https://${props.domainName}` : '',
      bedrockGuardrailId: guardrailId,
      bedrockGuardrailVersion: guardrailVersion,
      bedrockGuardrailArn: guardrailArn,
    });

    const edge = new EdgeConstruct(this, 'Edge', {
      projectName: props.projectName,
      environment: props.environment,
      staticAssetsBucket: storage.staticAssetsBucket,
      appRunnerServiceUrl: api.serviceUrl,
      domainName: props.domainName,
      route53ZoneId: props.route53ZoneId,
    });

    new cdk.CfnOutput(this, 'UploadsBucketName', { value: storage.uploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'StaticAssetsBucket', { value: storage.staticAssetsBucket.bucketName });
    new cdk.CfnOutput(this, 'EcrRepositoryUri', { value: ecr.repository.repositoryUri });
    new cdk.CfnOutput(this, 'AgentRuntimeArn', { value: agent.runtimeArn });
    new cdk.CfnOutput(this, 'AppRunnerServiceUrl', { value: `https://${api.serviceUrl}` });
    new cdk.CfnOutput(this, 'CloudFrontDomain', { value: edge.distributionDomain });
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: props.domainName ? `https://${props.domainName}` : `https://${edge.distributionDomain}`,
    });
  }
}
