# The stats dashboard was retired (2026-11-18). Its bucket is dropped from state
# here instead of destroyed, because it is not empty and has no force_destroy, so
# a destroy would fail the deploy. The bucket itself was deleted by hand once the
# Lambda that wrote to it was gone. Delete this file after one successful apply.

removed {
  from = aws_s3_bucket.stats
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_versioning.stats
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_lifecycle_configuration.stats
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_public_access_block.stats
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_server_side_encryption_configuration.stats
  lifecycle {
    destroy = false
  }
}
