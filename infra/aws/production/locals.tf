locals {
  name = "${var.project}-${var.environment}"

  required_tags = merge(
    var.tags,
    {
      Project            = var.project
      Environment        = var.environment
      ManagedBy          = "terraform"
      DataClassification = "confidential"
    },
  )

  azs = {
    for index, az in var.availability_zones : az => {
      public_cidr      = var.public_subnet_cidrs[index]
      application_cidr = var.application_subnet_cidrs[index]
      database_cidr    = var.database_subnet_cidrs[index]
    }
  }

  runtime_secret_names = toset([
    "database-url",
    "database-ssl-ca",
    "jwt-secret",
    "google-client-id",
    "google-client-secret",
    "cloudinary-url",
  ])

  secret_environment_names = {
    "database-url"         = "DATABASE_URL"
    "database-ssl-ca"      = "DATABASE_SSL_CA"
    "jwt-secret"           = "JWT_SECRET"
    "google-client-id"     = "GOOGLE_CLIENT_ID"
    "google-client-secret" = "GOOGLE_CLIENT_SECRET"
    "cloudinary-url"       = "CLOUDINARY_URL"
  }

  cleanup_secret_environment_names = {
    "database-url"    = "DATABASE_URL"
    "database-ssl-ca" = "DATABASE_SSL_CA"
    "cloudinary-url"  = "CLOUDINARY_URL"
  }

  api_container_name = "api"
  api_image = var.api_image_digest == null ? null : format(
    "%s@%s",
    aws_ecr_repository.api.repository_url,
    var.api_image_digest,
  )
}
