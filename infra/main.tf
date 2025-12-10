terraform {
  required_version = ">= 1.4.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # S3 Backend for State Storage (REQUIRED FOR PRODUCTION)
  # To enable: Remove the "local" backend block below and uncomment the s3 block
  #
  # Prerequisites:
  # 1. Create S3 bucket: aws s3 mb s3://ai-coding-team-tfstate
  # 2. Enable versioning: aws s3api put-bucket-versioning --bucket ai-coding-team-tfstate --versioning-configuration Status=Enabled
  # 3. Create DynamoDB table for locking:
  #    aws dynamodb create-table --table-name ai-coding-team-tflock \
  #      --attribute-definitions AttributeName=LockID,AttributeType=S \
  #      --key-schema AttributeName=LockID,KeyType=HASH \
  #      --billing-mode PAY_PER_REQUEST
  #
  # backend "s3" {
  #   bucket         = "ai-coding-team-tfstate"
  #   key            = "terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "ai-coding-team-tflock"
  # }
  #
  # Local backend (for development only - SWITCH TO S3 FOR PRODUCTION)
  # Comment this out when using S3 backend
  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ai-coding-team"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Local values
locals {
  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}
