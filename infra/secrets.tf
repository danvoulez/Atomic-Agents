# Secrets Manager

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${local.name_prefix}/db-password"
  description             = "RDS database password"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-db-password"
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db_password.result
}

resource "aws_secretsmanager_secret" "openai_key" {
  name                    = "${local.name_prefix}/openai-api-key"
  description             = "OpenAI API key"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-openai-key"
  }
}

resource "aws_secretsmanager_secret" "anthropic_key" {
  name                    = "${local.name_prefix}/anthropic-api-key"
  description             = "Anthropic API key"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-anthropic-key"
  }
}

# Note: API key values should be set manually in AWS Console or via:
# aws secretsmanager put-secret-value --secret-id <secret-arn> --secret-string <api-key>

# Outputs
output "db_password_secret_arn" {
  value = aws_secretsmanager_secret.db_password.arn
}

output "openai_key_secret_arn" {
  value = aws_secretsmanager_secret.openai_key.arn
}

output "anthropic_key_secret_arn" {
  value = aws_secretsmanager_secret.anthropic_key.arn
}
