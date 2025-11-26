# CloudWatch Alarms and Dashboards

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

# Job Failure Rate Alarm
resource "aws_cloudwatch_metric_alarm" "job_failure_rate" {
  alarm_name          = "${local.name_prefix}-job-failure-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "JobFailures"
  namespace           = "AICodeTeam"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Job failure rate is high"

  alarm_actions = [aws_sns_topic.alerts.arn]

  dimensions = {
    Environment = var.environment
  }
}

# Escalation Rate Alarm
resource "aws_cloudwatch_metric_alarm" "escalation_rate" {
  alarm_name          = "${local.name_prefix}-escalation-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HumanEscalations"
  namespace           = "AICodeTeam"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Many jobs are being escalated to humans"

  alarm_actions = [aws_sns_topic.alerts.arn]

  dimensions = {
    Environment = var.environment
  }
}

# Worker Queue Depth Alarm
resource "aws_cloudwatch_metric_alarm" "mechanic_queue_depth" {
  alarm_name          = "${local.name_prefix}-mechanic-queue-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MechanicQueueDepth"
  namespace           = "AICodeTeam"
  period              = 60
  statistic           = "Average"
  threshold           = 20
  alarm_description   = "Mechanic job queue is backing up"

  alarm_actions = [aws_sns_topic.alerts.arn]

  dimensions = {
    Environment = var.environment
  }
}

# RDS CPU Alarm
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name_prefix}-rds-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization is high"

  alarm_actions = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }
}

# CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name_prefix}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Job Status"
          metrics = [
            ["AICodeTeam", "JobSuccesses", "Environment", var.environment, { color = "#2ca02c" }],
            [".", "JobFailures", ".", ".", { color = "#d62728" }],
            [".", "HumanEscalations", ".", ".", { color = "#ff7f0e" }]
          ]
          view    = "timeSeries"
          stacked = false
          period  = 300
          stat    = "Sum"
          region  = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Queue Depth"
          metrics = [
            ["AICodeTeam", "MechanicQueueDepth", "Environment", var.environment],
            [".", "GeniusQueueDepth", ".", "."]
          ]
          view   = "timeSeries"
          period = 60
          stat   = "Average"
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 8
        height = 6
        properties = {
          title   = "Job Duration"
          metrics = [
            ["AICodeTeam", "JobDuration", "Mode", "mechanic", { stat = "p50" }],
            ["...", { stat = "p90" }],
            [".", ".", "Mode", "genius", { stat = "p50" }],
            ["...", { stat = "p90" }]
          ]
          view   = "timeSeries"
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 6
        width  = 8
        height = 6
        properties = {
          title   = "Worker Scaling"
          metrics = [
            ["AWS/ECS", "DesiredTaskCount", "ServiceName", "mechanic-worker", "ClusterName", aws_ecs_cluster.main.name],
            [".", "RunningTaskCount", ".", ".", ".", "."],
            [".", "DesiredTaskCount", "ServiceName", "genius-worker", ".", "."],
            [".", "RunningTaskCount", ".", ".", ".", "."]
          ]
          view   = "timeSeries"
          period = 60
          stat   = "Average"
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 6
        width  = 8
        height = 6
        properties = {
          title   = "RDS Metrics"
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.id],
            [".", "DatabaseConnections", ".", "."],
            [".", "FreeStorageSpace", ".", ".", { yAxis = "right" }]
          ]
          view   = "timeSeries"
          period = 300
          stat   = "Average"
          region = var.aws_region
        }
      }
    ]
  })
}

# Outputs
output "sns_alerts_arn" {
  value = aws_sns_topic.alerts.arn
}

output "dashboard_url" {
  value = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}
