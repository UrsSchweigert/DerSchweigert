terraform {
  required_version = ">= 1.5.7"

  backend "s3" {
    bucket         = "derschweigert-terraform-state"
    key            = "lesen/prod/terraform.tfstate"
    region         = "eu-central-1"
    encrypt        = true
    dynamodb_table = "derschweigert-terraform-locks"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
