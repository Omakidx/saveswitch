provider "aws" {
  region              = var.region
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = merge(
      var.tags,
      {
        Project            = "saveswitch"
        Environment        = "production"
        ManagedBy          = "terraform"
        DataClassification = "internal"
        Component          = "api-certificate"
      },
    )
  }
}
