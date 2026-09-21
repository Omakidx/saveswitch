resource "aws_budgets_budget" "account_monthly" {
  name         = local.budget_name
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 18
    threshold_type             = "ABSOLUTE_VALUE"
    subscriber_email_addresses = [trimspace(var.budget_alert_email)]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 21
    threshold_type             = "ABSOLUTE_VALUE"
    subscriber_email_addresses = [trimspace(var.budget_alert_email)]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    threshold                  = 21
    threshold_type             = "ABSOLUTE_VALUE"
    subscriber_email_addresses = [trimspace(var.budget_alert_email)]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 24
    threshold_type             = "ABSOLUTE_VALUE"
    subscriber_email_addresses = [trimspace(var.budget_alert_email)]
  }

  lifecycle {
    prevent_destroy = true
  }
}
