# Lambda container image — ARM64 (Graviton2) for lowest cost.
# Uses the official AWS Lambda Python 3.12 base image which includes the
# Lambda Runtime Interface Client (RIC) needed to handle Lambda events.
#
# Build context is REPO_ROOT (same as the uvicorn Dockerfile) so the
# deploy script can pass the same -v / COPY paths.

FROM --platform=linux/arm64 public.ecr.aws/lambda/python:3.12

# Install dependencies into the Lambda task root
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Copy application source
COPY app ${LAMBDA_TASK_ROOT}/app

# Entry point: app/lambda_handler.py → handler function
CMD ["app.lambda_handler.handler"]
