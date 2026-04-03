# ONE IDP Infrastructure Guide

## Architecture Overview

```
                                    ┌─────────────────────────────────────┐
                                    │           Route53 (A/AAAA)          │
                                    │   idp.sanghwa.people.aws.dev        │
                                    └──────────────┬──────────────────────┘
                                                   │
                                    ┌──────────────▼──────────────────────┐
                                    │     CloudFront Distribution         │
                                    │  (aws_cloudfront_distribution.main) │
                                    │                                     │
                                    │   TLS: ACM cert (us-east-1)        │
                                    │   PriceClass_100 (NA+EU)           │
                                    └────────┬──────────────┬─────────────┘
                                             │              │
                               /api/*        │              │  /* (default)
                                             │              │
                            ┌────────────────▼───┐   ┌──────▼──────────────┐
                            │   App Runner        │   │  S3 Static Assets   │
                            │  (Express :3001)    │   │  (OAC, SigV4)      │
                            │                     │   │                     │
                            │ X-CloudFront-Secret │   │  Frontend (React +  │
                            │ header verification │   │  Vite + Cloudscape) │
                            └────────┬────────────┘   └─────────────────────┘
                                     │
                      ┌──────────────▼──────────────┐
                      │    Bedrock AgentCore         │
                      │ (IAM auth, same ECR image)   │
                      │  agent mode on :8080         │
                      └──────┬─────┬─────┬──────────┘
                             │     │     │
                   ┌─────────▼┐ ┌──▼───┐ ┌▼──────────┐
                   │ Bedrock   │ │ BDA  │ │ Textract  │
                   │ Claude    │ │      │ │           │
                   │ Nova      │ │      │ │           │
                   └──────────┘ └──────┘ └───────────┘
                             │
                      ┌──────▼──────────────────────┐
                      │  S3 Uploads Bucket           │
                      │  KMS encrypted, versioned    │
                      │  30-day lifecycle             │
                      └─────────────────────────────┘
```

## Terraform Files

| File | Manages |
|---|---|
| `main.tf` | Provider config (aws, random), S3 backend (`one-idp-terraform-state`), us-east-1 alias for ACM |
| `variables.tf` | 7 variables: region, environment, project_name, ecr_image_tag, bda_profile_arn, bda_project_arn, domain_name, route53_zone_id |
| `cloudfront.tf` | CloudFront distribution, S3 static assets bucket + OAC, bucket policy, secret header |
| `apprunner.tf` | App Runner service, ECR access role, instance role, 4 inline policies (S3, Bedrock, Textract, AgentCore) |
| `agentcore.tf` | Bedrock AgentCore runtime, execution role with 10 policy statements |
| `ecr.tf` | ECR repository with scan-on-push, lifecycle (keep last 10 images) |
| `s3.tf` | Uploads bucket: versioning, KMS encryption, 30-day lifecycle, CORS, public access block |
| `route53.tf` | ACM certificate (us-east-1), DNS validation, A/AAAA alias records to CloudFront |
| `iam.tf` | Placeholder (IAM roles are co-located with their services in apprunner.tf and agentcore.tf) |
| `outputs.tf` | 11 outputs: bucket names/ARNs, ECR URL, AgentCore ARN/endpoint, App Runner URL, CloudFront domain, site URL |

## Security Architecture

### CloudFront to S3 (Static Assets)

Origin Access Control (OAC)를 사용합니다. CloudFront가 S3에 SigV4 서명 요청을 보내고, S3 bucket policy에서 CloudFront distribution ARN을 source condition으로 검증합니다.

```hcl
# OAC 설정
resource "aws_cloudfront_origin_access_control" "static_assets" {
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"    # 모든 요청 서명
  signing_protocol                  = "sigv4"
}
```

```json
// S3 bucket policy - CloudFront ARN 기반 접근 제한
{
  "Condition": {
    "StringEquals": {
      "AWS:SourceArn": "<cloudfront_distribution_arn>"
    }
  }
}
```

S3 버킷 자체는 **전면 퍼블릭 차단** (block_public_acls, block_public_policy, ignore_public_acls, restrict_public_buckets 모두 true).

### CloudFront to App Runner (API)

**Shared Secret Header** 패턴을 사용합니다. CloudFront가 `/api/*` 요청을 App Runner로 프록시할 때 `X-CloudFront-Secret` 커스텀 헤더를 주입합니다. 이 값은 Terraform `random_password` (32자, 특수문자 없음)로 생성되어 state에만 저장됩니다.

```hcl
custom_header {
  name  = "X-CloudFront-Secret"
  value = random_password.cloudfront_secret.result
}
```

App Runner 쪽 Express 서버에서 이 헤더를 검증해야 CloudFront를 우회한 직접 접근을 차단할 수 있습니다. **중요**: App Runner URL은 public이므로, 이 헤더 검증이 없으면 누구나 API에 직접 접근 가능합니다.

API 요청 시 캐싱은 비활성화 (default_ttl = 0, max_ttl = 0). Authorization, Content-Type 등 6개 헤더와 모든 쿠키를 포워딩합니다. Host 헤더는 의도적으로 포워딩하지 않습니다 (App Runner가 foreign Host 헤더를 reject하기 때문).

### App Runner to AgentCore (IAM Auth)

App Runner instance role에 `bedrock-agentcore:InvokeAgentRuntime` 권한이 있고, 리소스는 해당 AgentCore runtime ARN으로 제한됩니다. AgentCore 호출은 IAM SigV4 인증을 사용하므로 별도의 API key나 secret이 필요하지 않습니다.

### AgentCore Execution Role

AgentCore가 실행될 때 assume하는 role입니다. trust policy에 `aws:SourceAccount`와 `aws:SourceArn` condition이 걸려 있어서 cross-account 악용을 방지합니다.

10개 policy statement가 있으며, 각각:

| Statement | 용도 | 리소스 범위 |
|---|---|---|
| ECRImageAccess | 컨테이너 이미지 풀 | ECR repo ARN만 |
| ECRTokenAccess | ECR 인증 토큰 | * (필수) |
| CloudWatchLogs | 로그 기록 | `/aws/bedrock-agentcore/runtimes/*` |
| XRayTracing | 분산 추적 | * |
| CloudWatchMetrics | 메트릭 발행 | namespace = bedrock-agentcore |
| BedrockModelInvocation | Claude, Nova 모델 호출 | * |
| BDAAccess | Bedrock Data Automation | * |
| TextractAccess | 문서 OCR | * |
| S3DocumentAccess | 문서 업로드/다운로드 | uploads 버킷만 |
| WorkloadAccessTokens | AgentCore identity tokens | default directory만 |

### S3 Uploads Bucket

- **서버사이드 암호화**: KMS (aws:kms) 기본 적용
- **버저닝**: 활성화 (실수로 덮어쓰기 방지)
- **라이프사이클**: uploads/, outputs/ 둘 다 30일 후 자동 삭제
- **CORS**: localhost:5173 (개발)과 idp.sanghwa.people.aws.dev (프로덕션)만 허용
- **퍼블릭 차단**: 전면 활성화

### ECR

- **scan-on-push**: 이미지 push 시 자동 취약점 스캔
- **라이프사이클**: 최근 10개 이미지만 유지, 나머지 자동 삭제

## Deployment Flow

### 1. 초기 배포

```bash
cd infrastructure

# 초기화 (S3 backend에 state 저장)
terraform init

# 변수 파일 준비
cat > terraform.tfvars << 'EOF'
aws_region      = "us-west-2"
environment     = "dev"
domain_name     = "idp.sanghwa.people.aws.dev"
route53_zone_id = "<ZONE_ID>"
bda_profile_arn = "<BDA_STANDARD_PROFILE_ARN>"
ecr_image_tag   = "latest"
EOF

# 플랜 확인 후 적용
terraform plan
terraform apply
```

### 2. Docker 이미지 빌드 및 푸시

```bash
# ECR 로그인
ECR_URL=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin $ECR_URL

# 빌드 & 푸시
docker build -t one-idp-backend ./packages/backend
docker tag one-idp-backend:latest $ECR_URL:latest
docker push $ECR_URL:latest
```

### 3. App Runner 배포

`auto_deployments_enabled = false`이므로 ECR push만으로는 자동 배포되지 않습니다.

```bash
# App Runner 수동 배포 트리거
aws apprunner start-deployment \
  --service-arn $(terraform output -raw apprunner_service_arn 2>/dev/null || echo "check outputs")
```

### 4. AgentCore 배포

AgentCore는 같은 ECR 이미지를 사용하지만 `SERVER_MODE=agent`, `AGENT_PORT=8080`으로 실행됩니다.
Terraform apply 시 이미지 태그가 변경되면 AgentCore가 새 이미지로 업데이트됩니다.

### 5. Frontend 배포

```bash
# 프론트엔드 빌드
cd packages/frontend
npm run build

# S3에 업로드
BUCKET=$(cd ../../infrastructure && terraform output -raw static_assets_bucket)
aws s3 sync dist/ s3://$BUCKET/ --delete

# CloudFront 캐시 무효화
DIST_ID=$(cd ../../infrastructure && terraform output -raw cloudfront_distribution_id)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

## CloudFront Configuration Detail

### Two Origins

| Origin ID | Target | Protocol | 용도 |
|---|---|---|---|
| `S3-static` | S3 static assets bucket | OAC (SigV4) | React SPA (HTML/JS/CSS) |
| `AppRunner-API` | App Runner service URL | HTTPS only (TLSv1.2) | Express REST API |

### Cache Behaviors

| Pattern | Origin | TTL | Headers Forwarded | Cookies |
|---|---|---|---|---|
| `/api/*` | AppRunner-API | 0 (no cache) | Authorization, Content-Type, Accept, Origin, Referer, X-IDP-User | all |
| `*` (default) | S3-static | 86400s (1 day) | none | none |

### SPA Fallback

403/404 에러를 index.html로 리다이렉트 (response code 200). React Router의 클라이언트사이드 라우팅을 지원합니다.

### Custom Domain (Optional)

`domain_name`과 `route53_zone_id`를 설정하면:
1. ACM 인증서가 us-east-1에 생성됨 (CloudFront 요구사항)
2. Route53에 DNS validation CNAME 레코드 생성
3. ACM 인증서 검증 완료 (최대 5분)
4. CloudFront distribution에 인증서 연결 (SNI, TLSv1.2_2021)
5. Route53에 A + AAAA alias 레코드가 CloudFront를 가리킴

미설정 시 CloudFront 기본 도메인 (xxxx.cloudfront.net)으로 접근합니다.

## Dual Compute: App Runner vs AgentCore

같은 Docker 이미지가 두 가지 모드로 실행됩니다:

| | App Runner | AgentCore |
|---|---|---|
| **역할** | HTTP 서버 (REST API) | Agent runtime (Strands SDK) |
| **포트** | 3001 | 8080 |
| **환경변수** | `NODE_ENV=production` | `SERVER_MODE=agent` |
| **접근** | CloudFront → HTTPS | IAM SigV4 인증 |
| **인스턴스** | 1 vCPU, 2GB RAM | AgentCore managed |
| **용도** | 프론트엔드 API 처리, S3 presigned URL 생성 | 문서 처리 파이프라인 실행 |

App Runner는 사용자 요청을 받아서 AgentCore에 위임하는 구조입니다. App Runner는 HTTP 라우팅과 인증을 처리하고, AgentCore는 실제 문서 처리 로직(Bedrock, Textract, BDA 호출)을 수행합니다.

## Terraform State

S3 backend (`one-idp-terraform-state` 버킷, us-west-2)에 저장됩니다.

```hcl
backend "s3" {
  bucket = "one-idp-terraform-state"
  key    = "one-idp/terraform.tfstate"
  region = "us-west-2"
}
```

State에는 `random_password.cloudfront_secret`이 포함되므로, **state 파일 접근 권한을 제한**해야 합니다. DynamoDB lock은 미설정 (single developer 환경).

## Key Outputs

```bash
terraform output site_url                 # https://idp.sanghwa.people.aws.dev
terraform output cloudfront_domain        # xxxx.cloudfront.net
terraform output apprunner_service_url    # https://xxxx.us-west-2.awsapprunner.com
terraform output ecr_repository_url       # xxxx.dkr.ecr.us-west-2.amazonaws.com/one-idp-backend
terraform output agentcore_endpoint       # AgentCore invocation URL
terraform output s3_bucket_name           # one-idp-uploads-dev
terraform output static_assets_bucket     # one-idp-static-dev
```
