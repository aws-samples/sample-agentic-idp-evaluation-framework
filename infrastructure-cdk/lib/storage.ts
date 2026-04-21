import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface StorageProps {
  readonly projectName: string;
  readonly environment: string;
  readonly corsAllowedOrigins: string[];
  readonly domainName?: string;
}

/**
 * S3 buckets for uploads (encrypted, versioned, CORS-enabled) and static assets.
 */
export class StorageConstruct extends Construct {
  readonly uploadsBucket: s3.Bucket;
  readonly staticAssetsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    const origins = [...props.corsAllowedOrigins];
    if (props.domainName) origins.push(`https://${props.domainName}`);

    this.uploadsBucket = new s3.Bucket(this, 'Uploads', {
      bucketName: `${props.projectName}-uploads-${props.environment}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: origins,
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        { id: 'cleanup-uploads', prefix: 'uploads/', expiration: Duration.days(30) },
        { id: 'cleanup-outputs', prefix: 'outputs/', expiration: Duration.days(30) },
      ],
    });

    this.staticAssetsBucket = new s3.Bucket(this, 'StaticAssets', {
      bucketName: `${props.projectName}-static-${props.environment}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
