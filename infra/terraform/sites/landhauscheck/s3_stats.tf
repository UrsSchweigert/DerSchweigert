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

# The stats PIN guard function could not be deleted in the same apply that
# detaches it from the distribution: CloudFront refused with 409
# FunctionInUse, and the half-finished apply left the Lambda without its
# API Gateway invoke permission (LHC returned 500 for about seven minutes
# on 2026-11-18). Forget it here so the apply can finish; the function is
# deleted by hand once the distribution no longer references it.
removed {
  from = aws_cloudfront_function.stats_pin_guard
  lifecycle {
    destroy = false
  }
}
