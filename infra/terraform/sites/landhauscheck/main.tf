terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state lives in the monorepo's shared S3 backend with a per-site key
  # (same bucket and lock table as the other sites; see the root README).
  # This stack's state was migrated here with `tofu init -migrate-state` from the
  # old standalone BasicWebApp backend.
  backend "s3" {
    bucket         = "derschweigert-terraform-state"
    key            = "landhauscheck/prod/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "derschweigert-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM certificates for CloudFront must be in us-east-1, regardless of the
# primary deployment region. This aliased provider is used only for that.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# Pull the current AWS account ID (used to name the S3 bucket uniquely)
data "aws_caller_identity" "current" {}

locals {
  name = var.app_name

  tags = {
    Project     = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
