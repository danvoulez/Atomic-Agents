variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "ai-coding-team"
}

variable "environment" {
  description = "Environment (staging, production)"
  type        = string
  default     = "staging"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

# VPC Configuration
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# RDS Configuration
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "ai_coding_team"
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

# ECS Configuration
variable "dashboard_cpu" {
  description = "Dashboard task CPU"
  type        = number
  default     = 256
}

variable "dashboard_memory" {
  description = "Dashboard task memory"
  type        = number
  default     = 512
}

variable "worker_mechanic_cpu" {
  description = "Mechanic worker CPU"
  type        = number
  default     = 1024
}

variable "worker_mechanic_memory" {
  description = "Mechanic worker memory"
  type        = number
  default     = 2048
}

variable "worker_genius_cpu" {
  description = "Genius worker CPU"
  type        = number
  default     = 2048
}

variable "worker_genius_memory" {
  description = "Genius worker memory"
  type        = number
  default     = 4096
}

# Worker Configuration
variable "mechanic_model" {
  description = "LLM model for mechanic workers"
  type        = string
  default     = "gpt-4o-mini"
}

variable "genius_model" {
  description = "LLM model for genius workers"
  type        = string
  default     = "gpt-4o"
}

variable "mechanic_step_cap" {
  description = "Step cap for mechanic mode"
  type        = number
  default     = 20
}

variable "genius_step_cap" {
  description = "Step cap for genius mode"
  type        = number
  default     = 100
}

variable "mechanic_token_cap" {
  description = "Token cap for mechanic mode"
  type        = number
  default     = 50000
}

variable "genius_token_cap" {
  description = "Token cap for genius mode"
  type        = number
  default     = 200000
}
