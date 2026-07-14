import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface EcrProps {
  readonly projectName: string;
}

/**
 * Shared ECR repository for the backend image.
 * Consumed by both the ECS (web tier) and AgentCore (agent tier).
 *
 * We import an existing repository (created out-of-band) so the image can be
 * pushed before the stack deploys ECS/AgentCore, avoiding the chicken-and-egg
 * problem where Fargate tasks fail to start because the image is missing.
 */
export class EcrConstruct extends Construct {
  readonly repository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: EcrProps) {
    super(scope, id);

    this.repository = ecr.Repository.fromRepositoryName(
      this,
      'Backend',
      `${props.projectName}-backend`,
    );
  }
}
