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
 * A dedicated access-logs bucket receives server access logs for both buckets
 * (ACAT SecureCdkBsc43 / S3 access logging).
 */
export class StorageConstruct extends Construct {
  readonly uploadsBucket: s3.Bucket;
  readonly staticAssetsBucket: s3.Bucket;
  readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    const origins = [...props.corsAllowedOrigins];
    if (props.domainName) origins.push(`https://${props.domainName}`);

    this.accessLogsBucket = new s3.Bucket(this, 'AccessLogs', {
      bucketName: `${props.projectName}-access-logs-${props.environment}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ id: 'expire-access-logs', expiration: Duration.days(90) }],
    });

    this.uploadsBucket = new s3.Bucket(this, 'Uploads', {
      bucketName: `${props.projectName}-uploads-${props.environment}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: 'uploads/',
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
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: 'static/',
    });
  }
}
