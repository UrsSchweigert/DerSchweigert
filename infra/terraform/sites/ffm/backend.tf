terraform {
  backend "s3" {
    bucket         = "derschweigert-terraform-state"
    key            = "ffm/prod/terraform.tfstate"
    region         = "eu-central-1"
    encrypt        = true
    dynamodb_table = "derschweigert-terraform-locks"
  }
}
