terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state lives in the monorepo's shared S3 backend with a per-site key
  # (same bucket and lock table as the other sites; see the root README).
  # Migrated with `tofu init -migrate-state` from the old standalone backend.
  backend "s3" {
    bucket         = "derschweigert-terraform-state"
    key            = "landhauscheck/dev/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "derschweigert-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM certificates for CloudFront must live in us-east-1 regardless of primary region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}

locals {
  name = var.app_name # "basicwebapp-dev"

  tags = {
    Project     = "basicwebapp"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
