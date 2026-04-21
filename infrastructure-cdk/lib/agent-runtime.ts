import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface AgentRuntimeProps {
  readonly projectName: string;
  readonly environment: string;
  readonly region: string;
  readonly repository: ecr.IRepository;
  readonly imageTag: string;
  readonly uploadsBucket: s3.IBucket;
  readonly bdaProfileArn: string;
  readonly bdaProjectArn: string;
  readonly claudeModelId: string;
  readonly novaModelId: string;
}

/**
 * Bedrock AgentCore runtime — the *agent tier*.
 *
 * Uses the `aws-cdk-lib/aws-bedrockagentcore` L1 constructs (CfnRuntime,
 * CfnRuntimeEndpoint) as documented in awslabs/agentcore-samples.
 *
 * The web tier (App Runner) calls this runtime via SigV4-authenticated
 * `bedrock-agentcore:InvokeAgentRuntime`.
 */
export class AgentRuntimeConstruct extends Construct {
  readonly runtime: bedrockagentcore.CfnRuntime;
  readonly runtimeArn: string;
  readonly runtimeId: string;
  readonly executionRole: iam.Role;

  constructor(scope: Construct, id: string, props: AgentRuntimeProps) {
    super(scope, id);

    const accountId = cdk.Stack.of(this).account;

    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: `${props.projectName}-agentcore-execution-${props.environment}`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': accountId },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock-agentcore:${props.region}:${accountId}:*`,
          },
        },
      }),
      description: 'IAM role for Bedrock AgentCore Runtime',
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('BedrockAgentCoreFullAccess')],
    });

    props.repository.grantPull(this.executionRole);

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogs',
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogStreams',
          'logs:DescribeLogGroups',
        ],
        resources: [`arn:aws:logs:${props.region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*`],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'XRayTracing',
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
        resources: ['*'],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchMetrics',
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockModelInvocation',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BDAAccess',
        actions: [
          'bedrock:InvokeDataAutomationAsync',
          'bedrock:GetDataAutomationStatus',
          'bedrock:ListDataAutomationProjects',
          'bedrock:GetDataAutomationProject',
        ],
        resources: ['*'],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'TextractAccess',
        actions: [
          'textract:AnalyzeDocument',
          'textract:DetectDocumentText',
          'textract:AnalyzeExpense',
          'textract:AnalyzeID',
        ],
        resources: ['*'],
      }),
    );
    props.uploadsBucket.grantReadWrite(this.executionRole);
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GetAgentAccessToken',
        actions: [
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
          'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${props.region}:${accountId}:workload-identity-directory/default`,
          `arn:aws:bedrock-agentcore:${props.region}:${accountId}:workload-identity-directory/default/workload-identity/*`,
        ],
      }),
    );

    this.runtime = new bedrockagentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: `${props.projectName}_${props.environment}`.replace(/-/g, '_'),
      description: 'IDP Evaluation Framework — document processing agent',
      roleArn: this.executionRole.roleArn,
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${props.repository.repositoryUri}:${props.imageTag}`,
        },
      },
      networkConfiguration: { networkMode: 'PUBLIC' },
      protocolConfiguration: 'HTTP',
      environmentVariables: {
        SERVER_MODE: 'agent',
        AWS_REGION: props.region,
        AWS_DEFAULT_REGION: props.region,
        S3_BUCKET: props.uploadsBucket.bucketName,
        S3_OUTPUT_PREFIX: 'idp-outputs/',
        BDA_PROFILE_ARN: props.bdaProfileArn,
        BDA_PROJECT_ARN: props.bdaProjectArn,
        NODE_ENV: 'production',
        AGENT_PORT: '8080',
        CLAUDE_MODEL_ID: props.claudeModelId,
        NOVA_MODEL_ID: props.novaModelId,
      },
    });

    this.runtimeArn = this.runtime.attrAgentRuntimeArn;
    this.runtimeId = this.runtime.attrAgentRuntimeId;
  }
}
