variable "project" { type = string  default = "atomic-agents" }
variable "aws_region" { type = string  default = "us-east-1" }
variable "database_url" { type = string  description = "Postgres connection string (use RDS or external)." }
variable "anthropic_api_key" { type = string  sensitive = true }

