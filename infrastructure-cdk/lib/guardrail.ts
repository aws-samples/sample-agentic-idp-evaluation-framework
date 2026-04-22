import { Construct } from 'constructs';
import { CfnResource } from 'aws-cdk-lib';

export interface GuardrailProps {
  readonly projectName: string;
  readonly environment: string;
}

/**
 * Amazon Bedrock Guardrail with a full PII-anonymize config.
 *
 * The CloudFormation resource is `AWS::Bedrock::Guardrail`. The CDK L2 was
 * not shipped in aws-cdk-lib at the time of this stack, so we use CfnResource
 * directly to mirror the Terraform stack exactly.
 */
export class GuardrailConstruct extends Construct {
  readonly guardrailId: string;
  readonly guardrailArn: string;
  readonly guardrailVersion: string;

  constructor(scope: Construct, id: string, props: GuardrailProps) {
    super(scope, id);

    const piiTypes = [
      'ADDRESS', 'AGE', 'AWS_ACCESS_KEY', 'AWS_SECRET_KEY', 'CA_HEALTH_NUMBER',
      'CA_SOCIAL_INSURANCE_NUMBER', 'CREDIT_DEBIT_CARD_CVV',
      'CREDIT_DEBIT_CARD_EXPIRY', 'CREDIT_DEBIT_CARD_NUMBER', 'DRIVER_ID',
      'EMAIL', 'INTERNATIONAL_BANK_ACCOUNT_NUMBER', 'IP_ADDRESS',
      'LICENSE_PLATE', 'MAC_ADDRESS', 'NAME', 'PASSWORD', 'PHONE', 'PIN',
      'SWIFT_CODE', 'UK_NATIONAL_HEALTH_SERVICE_NUMBER',
      'UK_NATIONAL_INSURANCE_NUMBER', 'UK_UNIQUE_TAXPAYER_REFERENCE_NUMBER',
      'URL', 'USERNAME', 'US_BANK_ACCOUNT_NUMBER', 'US_BANK_ROUTING_NUMBER',
      'US_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER', 'US_PASSPORT_NUMBER',
      'US_SOCIAL_SECURITY_NUMBER', 'VEHICLE_IDENTIFICATION_NUMBER',
    ];

    const guardrail = new CfnResource(this, 'Guardrail', {
      type: 'AWS::Bedrock::Guardrail',
      properties: {
        Name: `${props.projectName}-pii-${props.environment}`,
        Description: 'ONE IDP — managed PII detection and redaction guardrail.',
        BlockedInputMessaging: '[Blocked: input contained restricted content]',
        BlockedOutputsMessaging: '[Blocked: output contained restricted content]',
        SensitiveInformationPolicyConfig: {
          PiiEntitiesConfig: piiTypes.map((type) => ({ Type: type, Action: 'ANONYMIZE' })),
        },
      },
    });

    const version = new CfnResource(this, 'GuardrailVersion', {
      type: 'AWS::Bedrock::GuardrailVersion',
      properties: {
        GuardrailIdentifier: guardrail.getAtt('GuardrailId').toString(),
        Description: 'Managed by CDK',
      },
    });
    version.addDependency(guardrail);

    this.guardrailId = guardrail.getAtt('GuardrailId').toString();
    this.guardrailArn = guardrail.getAtt('GuardrailArn').toString();
    this.guardrailVersion = version.getAtt('Version').toString();
  }
}
