# ONE IDP — AWS CDK Stack (TypeScript)

This is the CDK TypeScript implementation of the ONE IDP platform, in
parity with the Terraform stack at [`../infrastructure/`](../infrastructure/).

Both stacks produce the same topology:

- **Storage**: S3 uploads bucket (KMS, versioned, CORS) + static asset bucket
- **ECR**: backend image repository
- **Agent tier**: `AWS::BedrockAgentCore::Runtime` (separate from the web tier)
- **Web tier**: `AWS::AppRunner::Service` running the Express API
- **Edge tier**: CloudFront + optional Route53/ACM for a custom domain

Pick either Terraform or CDK — do not run both against the same account/region.

## Layout

```
infrastructure-cdk/
├── bin/
│   └── app.ts              # CDK app entrypoint; reads context + env
├── lib/
│   ├── one-idp-stack.ts    # Top-level stack; wires the tiers together
│   ├── storage.ts          # S3 buckets
│   ├── ecr.ts              # ECR repo (shared by both tiers)
│   ├── agent-runtime.ts    # AgentCore runtime + execution role  (AGENT tier)
│   ├── app-runner.ts       # App Runner service + instance role  (WEB tier)
│   └── edge.ts             # CloudFront + Route53 + ACM          (EDGE tier)
├── cdk.json
├── tsconfig.json
└── package.json
```

The tier split (`agent-runtime.ts` vs `app-runner.ts`) makes the separation
explicit: the web tier is a stateless HTTP front that proxies agent calls via
SigV4 to AgentCore. You can upgrade, scale, or replace either tier without
touching the other.

## Prerequisites

- Node.js `>= 18`
- AWS CLI configured with credentials
- CDK bootstrap done once per account/region:
  ```bash
  npx cdk bootstrap aws://<account-id>/<region>
  ```

## Install & synth

```bash
cd infrastructure-cdk
npm install
npm run synth                # emits cdk.out/
```

## Deploy

Context values can be supplied via `cdk.json`, `-c key=value`, or env vars.

```bash
npx cdk deploy \
  -c projectName=one-idp \
  -c environment=dev \
  -c bdaProfileArn="arn:aws:bedrock:us-west-2:<account>:data-automation-profile/us.data-automation-v1" \
  -c domainName=idp.example.com \
  -c route53ZoneId=ZXXXXXXXXXXXX \
  -c authProvider=none
```

Or create a `cdk.context.json` / pass via environment:

| Context key | Env var | Default |
| --- | --- | --- |
| `projectName` | `PROJECT_NAME` | `one-idp` |
| `environment` | `ENVIRONMENT` | `dev` |
| `region` | `CDK_DEFAULT_REGION` | `us-west-2` |
| `domainName` | — | `""` |
| `route53ZoneId` | — | `""` |
| `bdaProfileArn` | — | `""` |
| `bdaProjectArn` | — | `""` |
| `ecrImageTag` | — | `latest` |
| `claudeModelId` | — | `us.anthropic.claude-sonnet-4-6` |
| `novaModelId` | — | `us.amazon.nova-2-lite-v1:0` |
| `authProvider` | — | `none` |
| `adminUsers` | — | `""` |

## Notes on AgentCore coverage

At time of writing, `AWS::BedrockAgentCore::Runtime` is available in
CloudFormation but has no L2 construct in `aws-cdk-lib`. This stack uses
`CfnResource` to declare the runtime directly. When the L2 construct lands,
migrate `lib/agent-runtime.ts` without touching the rest of the stack.

## Destroy

```bash
npx cdk destroy
```

S3 uploads and the static asset bucket are configured with
`RemovalPolicy.RETAIN`. To delete data, empty the buckets first.
