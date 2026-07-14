import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface EdgeProps {
  readonly projectName: string;
  readonly environment: string;
  readonly staticAssetsBucket: s3.IBucket;
  readonly backendServiceUrl: string;
  readonly cloudfrontSecret: string;
  readonly domainName?: string;
  readonly route53ZoneId?: string;
}

/**
 * Edge tier: CloudFront distribution + optional Route53 + ACM.
 *
 * Two origins:
 *   - S3 static assets (SPA)    — default behavior
 *   - ECS/ALB API               — /api/* behavior, no caching
 *
 * CloudFront terminates TLS; the ALB origin uses HTTP-only.
 *
 * For custom domains, `domainName` + `route53ZoneId` must both be set.
 * ACM certificates for CloudFront must live in us-east-1; pass one via
 * CDK context `acmCertificateArn` or rely on `DnsValidatedCertificate`.
 */
export class EdgeConstruct extends Construct {
  readonly distributionDomain: string;
  readonly distributionId: string;

  constructor(scope: Construct, id: string, props: EdgeProps) {
    super(scope, id);

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(props.staticAssetsBucket, {
      originAccessLevels: [cloudfront.AccessLevel.READ],
    });

    const apiOrigin = new origins.HttpOrigin(props.backendServiceUrl, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(30),
      customHeaders: { 'X-CloudFront-Secret': props.cloudfrontSecret },
    });

    let viewerCert: acm.ICertificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;
    if (props.domainName && props.route53ZoneId) {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: props.route53ZoneId,
        zoneName: props.domainName.split('.').slice(-2).join('.'),
      });
      viewerCert = new acm.DnsValidatedCertificate(this, 'Certificate', {
        domainName: props.domainName,
        hostedZone,
        region: 'us-east-1',
      });
    }

    // CloudFront access logs bucket
    const cfLogsBucket = new s3.Bucket(this, 'CfLogsBucket', {
      bucketName: `${props.projectName}-cf-logs-${props.environment}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ id: 'expire-cf-logs', expiration: Duration.days(90) }],
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate: viewerCert,
      minimumProtocolVersion: props.domainName
        ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021
        : undefined,
      enableLogging: true,
      logBucket: cfLogsBucket,
      logFilePrefix: 'cf/',
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      additionalBehaviors: {
        'api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          compress: false,
        },
      },
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });

    // Grant ListBucket so missing objects return 404 (not 403), required for SPA routing
    props.staticAssetsBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudFrontListBucket',
      actions: ['s3:ListBucket'],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      resources: [props.staticAssetsBucket.bucketArn],
      conditions: { StringEquals: { 'AWS:SourceArn': distribution.distributionArn } },
    }));

    this.distributionDomain = distribution.distributionDomainName;
    this.distributionId = distribution.distributionId;

    if (hostedZone && props.domainName) {
      new route53.ARecord(this, 'AliasA', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
      new route53.AaaaRecord(this, 'AliasAAAA', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }
  }
}
