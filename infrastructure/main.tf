terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.21"
    }
  }

  # The default bucket name is a placeholder — S3 bucket names are globally
  # unique, so every fresh deployment must override via `-backend-config`.
  # Convention: derive the bucket name from your account ID so it is unique
  # per account and easy to reason about.
  #
  #   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  #   terraform init -reconfigure \
  #     -backend-config="bucket=one-idp-tfstate-${ACCOUNT_ID}" \
  #     -backend-config="key=one-idp-tf/terraform.tfstate" \
  #     -backend-config="region=us-west-2"
  backend "s3" {
    bucket = "one-idp-tf-terraform-state"
    key    = "one-idp-tf/terraform.tfstate"
    region = "us-west-2"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
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
