import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';

export interface ActivityTableProps {
  readonly projectName: string;
  readonly environment: string;
}

/**
 * DynamoDB activity/usage-tracking table.
 *
 * Schema matches the hand-created table on the original deployment so a
 * CDK-first install can immediately point `ACTIVITY_TABLE` at this resource
 * without code changes.
 */
export class ActivityTableConstruct extends Construct {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ActivityTableProps) {
    super(scope, id);

    const tableKey = new kms.Key(this, 'TableKey', {
      alias: `alias/${props.projectName}-ddb`,
      description: `Encryption key for ${props.projectName} activity table`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.table = new dynamodb.Table(this, 'Table', {
      tableName: `${props.projectName}-activity-${props.environment}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp#type', type: dynamodb.AttributeType.STRING },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: tableKey,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
