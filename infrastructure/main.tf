terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.21"
    }
  }

  # Default backend points at the bucket used by the original deployment so
  # that `terraform init` with no args continues to work and no state is
  # migrated. Override via `-backend-config` for public deployments:
  #   terraform init -reconfigure \
  #     -backend-config="bucket=<your-state-bucket>" \
  #     -backend-config="key=one-idp/terraform.tfstate" \
  #     -backend-config="region=us-west-2"
  backend "s3" {
    bucket = "one-idp-terraform-state"
    key    = "one-idp/terraform.tfstate"
    region = "us-west-2"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "one-idp"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ACM certificates for CloudFront must be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

provider "random" {}
