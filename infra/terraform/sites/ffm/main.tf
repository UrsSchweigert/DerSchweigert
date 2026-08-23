terraform {
  required_version = ">= 1.5.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  app_name = "ffm"
  domain   = "ffm.derschweigert.de"
  tags = {
    Project   = "ffm"
    ManagedBy = "terraform"
    Domain    = "ffm.derschweigert.de"
  }
}

data "aws_route53_zone" "primary" {
  zone_id = var.route53_zone_id
}

module "api" {
  source = "../../modules/api_backend"

  app_name          = "ffm"
  description       = "Math game API for ffm.derschweigert.de"
  lambda_source_dir = "${path.root}/../../../../sites/ffm/lambda"

  environment_variables = {
    APP_ENV   = "production"
    FLASK_ENV = "production"
  }

  tags = local.tags
}

module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  app_name            = local.app_name
  domain              = local.domain
  additional_aliases  = []
  route53_zone_id     = data.aws_route53_zone.primary.zone_id
  default_root_object = "index.html"

  api_origin = {
    origin_id   = "api-origin"
    domain_name = "${module.api.rest_api_id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_path = "/prod"
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "users" {
  name         = "ffm-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "scores" {
  name         = "ffm-scores"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  tags = local.tags
}
