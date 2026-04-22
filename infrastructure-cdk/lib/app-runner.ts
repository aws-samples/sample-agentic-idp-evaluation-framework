import { Construct } from 'constructs';
import { CfnResource } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface AppRunnerProps {
  readonly projectName: string;
  readonly environment: string;
  readonly region: string;
  readonly repository: ecr.IRepository;
  readonly imageTag: string;
  readonly uploadsBucket: s3.IBucket;
  readonly activityTable: dynamodb.ITable;
  readonly agentRuntimeArn: string;
  readonly bdaProfileArn: string;
  readonly bdaProjectArn: string;
  readonly claudeModelId: string;
  readonly novaModelId: string;
  readonly authProvider: 'none' | 'midway' | 'cognito';
  readonly adminUsers: string;
  readonly cognitoUserPoolId: string;
  readonly cognitoClientId: string;
  readonly siteUrl: string;
  readonly bedrockGuardrailId?: string;
  readonly bedrockGuardrailVersion?: string;
  readonly bedrockGuardrailArn?: string;
}

/**
 * App Runner service — the *web tier*.
 *
 * Handles HTTP traffic, auth, and proxies agent invocations to AgentCore
 * via IAM-authenticated SigV4 calls.
 */
export class AppRunnerConstruct extends Construct {
  readonly serviceUrl: string;
  readonly instanceRole: iam.Role;

  constructor(scope: Construct, id: string, props: AppRunnerProps) {
    super(scope, id);

    const ecrAccessRole = new iam.Role(this, 'EcrAccessRole', {
      roleName: `${props.projectName}-apprunner-ecr-${props.environment}`,
      assumedBy: new iam.ServicePrincipal('build.apprunner.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSAppRunnerServicePolicyForECRAccess')],
    });

    this.instanceRole = new iam.Role(this, 'InstanceRole', {
      roleName: `${props.projectName}-apprunner-instance-${props.environment}`,
      assumedBy: new iam.ServicePrincipal('tasks.apprunner.amazonaws.com'),
    });

    props.uploadsBucket.grantReadWrite(this.instanceRole);
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: ['*'],
      }),
    );
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeDataAutomationAsync',
          'bedrock:GetDataAutomationStatus',
          'bedrock:ListDataAutomationProjects',
          'bedrock:GetDataAutomationProject',
        ],
        resources: ['*'],
      }),
    );
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:AnalyzeDocument',
          'textract:DetectDocumentText',
          'textract:AnalyzeExpense',
          'textract:AnalyzeID',
          'textract:StartDocumentAnalysis',
          'textract:GetDocumentAnalysis',
          'textract:StartDocumentTextDetection',
          'textract:GetDocumentTextDetection',
        ],
        resources: ['*'],
      }),
    );
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime', 'bedrock-agentcore:InvokeAgentRuntimeStreaming'],
        resources: [props.agentRuntimeArn, `${props.agentRuntimeArn}/*`],
      }),
    );

    // Mirror the out-of-band DynamoDBActivity inline policy from the
    // original deployment exactly so live/CDK-managed drift is zero.
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'],
        resources: [props.activityTable.tableArn],
      }),
    );

    const runtimeEnv: Record<string, string> = {
      AWS_REGION: props.region,
      S3_BUCKET: props.uploadsBucket.bucketName,
      S3_OUTPUT_PREFIX: 'idp-outputs/',
      BDA_PROFILE_ARN: props.bdaProfileArn,
      BDA_PROJECT_ARN: props.bdaProjectArn,
      NODE_ENV: 'production',
      PORT: '3001',
      CLAUDE_MODEL_ID: props.claudeModelId,
      NOVA_MODEL_ID: props.novaModelId,
      SITE_URL: props.siteUrl,
      // MIDWAY_DISABLED kept for back-compat with the original deployment.
      MIDWAY_DISABLED: props.authProvider === 'midway' ? 'false' : 'true',
      AGENTCORE_RUNTIME_ARN: props.agentRuntimeArn,
      ACTIVITY_TABLE: props.activityTable.tableName,
    };
    if (props.authProvider !== 'midway') runtimeEnv.AUTH_PROVIDER = props.authProvider;
    if (props.adminUsers) runtimeEnv.ADMIN_USERS = props.adminUsers;
    if (props.cognitoUserPoolId) runtimeEnv.COGNITO_USER_POOL_ID = props.cognitoUserPoolId;
    if (props.cognitoClientId) runtimeEnv.COGNITO_CLIENT_ID = props.cognitoClientId;
    if (props.bedrockGuardrailId) {
      runtimeEnv.BEDROCK_GUARDRAIL_ID = props.bedrockGuardrailId;
      runtimeEnv.BEDROCK_GUARDRAIL_VERSION = props.bedrockGuardrailVersion ?? 'DRAFT';
    }

    // ApplyGuardrail — scope to the guardrail ARN when we know it, wildcard
    // otherwise so an out-of-band guardrail id still works.
    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: props.bedrockGuardrailArn ? [props.bedrockGuardrailArn] : ['*'],
      }),
    );

    const service = new CfnResource(this, 'Service', {
      type: 'AWS::AppRunner::Service',
      properties: {
        ServiceName: `${props.projectName}-backend-${props.environment}`,
        SourceConfiguration: {
          AuthenticationConfiguration: { AccessRoleArn: ecrAccessRole.roleArn },
          AutoDeploymentsEnabled: false,
          ImageRepository: {
            ImageIdentifier: `${props.repository.repositoryUri}:${props.imageTag}`,
            ImageRepositoryType: 'ECR',
            ImageConfiguration: {
              Port: '3001',
              RuntimeEnvironmentVariables: Object.entries(runtimeEnv).map(([name, value]) => ({ Name: name, Value: value })),
            },
          },
        },
        InstanceConfiguration: {
          Cpu: '1024',
          Memory: '2048',
          InstanceRoleArn: this.instanceRole.roleArn,
        },
        HealthCheckConfiguration: {
          Protocol: 'HTTP',
          Path: '/api/health',
          Interval: 10,
          Timeout: 5,
          HealthyThreshold: 1,
          UnhealthyThreshold: 5,
        },
      },
    });

    this.serviceUrl = service.getAtt('ServiceUrl').toString();
  }
}
