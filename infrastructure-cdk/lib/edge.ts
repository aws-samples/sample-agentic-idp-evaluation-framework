import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface EdgeProps {
  readonly projectName: string;
  readonly environment: string;
  readonly staticAssetsBucket: s3.IBucket;
  readonly appRunnerServiceUrl: string;
  readonly domainName?: string;
  readonly route53ZoneId?: string;
}

/**
 * Edge tier: CloudFront distribution + optional Route53 + ACM.
 *
 * Two origins:
 *   - S3 static assets (SPA)    — default behavior
 *   - App Runner API            — /api/* behavior, no caching
 *
 * For custom domains, `domainName` + `route53ZoneId` must both be set.
 * ACM certificates for CloudFront must live in us-east-1; pass one via
 * CDK context `acmCertificateArn` or rely on `DnsValidatedCertificate`.
 */
export class EdgeConstruct extends Construct {
  readonly distributionDomain: string;

  constructor(scope: Construct, id: string, props: EdgeProps) {
    super(scope, id);

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(props.staticAssetsBucket, {
      originAccessLevels: [cloudfront.AccessLevel.READ],
    });

    const apiOrigin = new origins.HttpOrigin(props.appRunnerServiceUrl, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
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

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate: viewerCert,
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
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          compress: false,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });

    this.distributionDomain = distribution.distributionDomainName;

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
