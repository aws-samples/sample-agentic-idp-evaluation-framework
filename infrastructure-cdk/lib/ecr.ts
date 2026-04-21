import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface EcrProps {
  readonly projectName: string;
}

/**
 * Shared ECR repository for the backend image.
 * Consumed by both the App Runner (web tier) and AgentCore (agent tier).
 */
export class EcrConstruct extends Construct {
  readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrProps) {
    super(scope, id);

    this.repository = new ecr.Repository(this, 'Backend', {
      repositoryName: `${props.projectName}-backend`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
    });
  }
}
