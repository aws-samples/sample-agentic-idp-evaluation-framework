import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface EcsBackendProps {
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
  readonly authProvider: 'none' | 'cognito' | 'midway';
  readonly adminUsers: string;
  readonly cognitoUserPoolId: string;
  readonly cognitoClientId: string;
  readonly siteUrl: string;
  readonly bedrockGuardrailId?: string;
  readonly bedrockGuardrailVersion?: string;
  readonly bedrockGuardrailArn?: string;
}

/**
 * ECS Fargate backend — the *web tier*.
 *
 * Replaces App Runner with:
 *   - VPC (2 AZs, public + private subnets, NAT gateway)
 *   - ALB in public subnets
 *   - ECS Cluster + Fargate Service in private subnets
 *
 * Handles HTTP traffic, auth, and proxies agent invocations to AgentCore
 * via IAM-authenticated SigV4 calls.
 */
export class EcsBackendConstruct extends Construct {
  readonly serviceUrl: string;
  readonly taskRole: iam.Role;

  constructor(scope: Construct, id: string, props: EcsBackendProps) {
    super(scope, id);

    // ─── VPC ────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${props.projectName}-${props.environment}`,
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // ─── ALB ────────────────────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `${props.projectName}-${props.environment}`,
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      idleTimeout: Duration.seconds(120), // SSE streaming needs longer timeout
    });

    // ─── ECS Cluster ────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${props.projectName}-${props.environment}`,
      vpc,
      containerInsights: true,
    });

    // ─── Task Role (same permissions as the old App Runner instance role) ─
    this.taskRole = new iam.Role(this, 'TaskRole', {
      roleName: `${props.projectName}-ecs-task-${props.environment}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    props.uploadsBucket.grantReadWrite(this.taskRole);

    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: ['*'],
      }),
    );
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    this.taskRole.addToPolicy(
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
    this.taskRole.addToPolicy(
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
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime', 'bedrock-agentcore:InvokeAgentRuntimeStreaming'],
        resources: [props.agentRuntimeArn, `${props.agentRuntimeArn}/*`],
      }),
    );
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:GetItem'],
        resources: [props.activityTable.tableArn],
      }),
    );
    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: props.bedrockGuardrailArn ? [props.bedrockGuardrailArn] : ['*'],
      }),
    );

    // ─── Task Execution Role (pull ECR + send logs) ─────────────────────
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: `${props.projectName}-ecs-exec-${props.environment}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // ─── Task Definition ────────────────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: `${props.projectName}-backend-${props.environment}`,
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskRole: this.taskRole,
      executionRole,
    });

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
      AUTH_PROVIDER: props.authProvider,
      MIDWAY_DISABLED: props.authProvider === 'midway' ? 'false' : 'true',
      AGENTCORE_RUNTIME_ARN: props.agentRuntimeArn,
      ACTIVITY_TABLE: props.activityTable.tableName,
    };
    if (props.adminUsers) runtimeEnv.ADMIN_USERS = props.adminUsers;
    if (props.cognitoUserPoolId) runtimeEnv.COGNITO_USER_POOL_ID = props.cognitoUserPoolId;
    if (props.cognitoClientId) runtimeEnv.COGNITO_CLIENT_ID = props.cognitoClientId;
    if (props.bedrockGuardrailId) {
      runtimeEnv.BEDROCK_GUARDRAIL_ID = props.bedrockGuardrailId;
      runtimeEnv.BEDROCK_GUARDRAIL_VERSION = props.bedrockGuardrailVersion ?? 'DRAFT';
    }

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/${props.projectName}-backend-${props.environment}`,
      retention: logs.RetentionDays.TWO_WEEKS,
    });

    taskDef.addContainer('Backend', {
      containerName: `${props.projectName}-backend`,
      image: ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag),
      portMappings: [{ containerPort: 3001, protocol: ecs.Protocol.TCP }],
      environment: runtimeEnv,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'backend', logGroup }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3001/api/health || exit 1'],
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    });

    // ─── Fargate Service ────────────────────────────────────────────────
    const service = new ecs.FargateService(this, 'Service', {
      serviceName: `${props.projectName}-backend-${props.environment}`,
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      healthCheckGracePeriod: Duration.seconds(60),
    });

    // Allow inbound from ALB
    service.connections.allowFrom(alb, ec2.Port.tcp(3001), 'ALB to ECS');

    // ─── ALB Target Group + Listener ────────────────────────────────────
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      targetGroupName: `${props.projectName}-${props.environment}`,
      vpc,
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [service],
      healthCheck: {
        path: '/api/health',
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: Duration.seconds(30),
    });

    alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    // ─── Outputs ────────────────────────────────────────────────────────
    this.serviceUrl = alb.loadBalancerDnsName;
  }
}
