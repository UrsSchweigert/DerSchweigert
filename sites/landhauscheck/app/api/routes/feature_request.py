"""Feature-request endpoint.

Accepts a feature request submitted by a donor after a PayPal donation.
Validates the request body, then creates a Jira Task in the configured
project and returns a thank-you message.

POST /api/v1/feature-request
    Body:  FeatureRequestBody  (name, email, feature)
    200:   {"status": "created", "message": "..."}
    503:   Jira not configured (JIRA_API_KEY missing)
    502:   Jira responded with an unexpected error

Security notes:
- Pydantic validates and length-caps every input field.
- Email is validated against RFC-5322-compatible regex (no raw-HTML stored).
- Jira description is formatted as plain Atlassian Document Format (ADF) nodes;
  user-supplied text is placed inside a verbatim "text" node, never interpolated
  into a URL or query string.
- No authentication is required on this endpoint — the PayPal donation redirect
  is the implicit gate. Keeping it public avoids state management complexity.
"""

import base64
import re
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from app.core.config import get_settings

router = APIRouter()

# RFC-5322-compatible simplified email regex.
# Validation is a best-effort server-side check; the <input type="email">
# in the frontend provides the primary UX guard.
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+"
    r"@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*"
    r"\.[a-zA-Z]{2,}$",
    re.ASCII,
)


class FeatureRequestBody(BaseModel):
    """Validated payload for a feature request.

    Fields are intentionally narrow — length caps protect against
    oversized Jira payloads and potential injection into descriptions.
    """

    name: Annotated[str, ...]  # donor name, 1–100 chars
    email: Annotated[str, ...]  # donor email, validated
    feature: Annotated[str, ...]  # freeform request, 1–2000 chars

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        if len(v) > 100:
            raise ValueError("name must be at most 100 characters")
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("invalid email address")
        return v

    @field_validator("feature")
    @classmethod
    def validate_feature(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("feature must not be empty")
        if len(v) > 2000:
            raise ValueError("feature must be at most 2000 characters")
        return v


def _build_jira_description(name: str, email: str, feature: str) -> dict:
    """Return an Atlassian Document Format (ADF) description node.

    Text is embedded as plain ADF text nodes — no HTML or markdown injection.
    """
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 3},
                "content": [{"type": "text", "text": "Donor information"}],
            },
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "Name: ",
                                        "marks": [{"type": "strong"}],
                                    },
                                    {"type": "text", "text": name},
                                ],
                            }
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "Email: ",
                                        "marks": [{"type": "strong"}],
                                    },
                                    {"type": "text", "text": email},
                                ],
                            }
                        ],
                    },
                ],
            },
            {
                "type": "heading",
                "attrs": {"level": 3},
                "content": [{"type": "text", "text": "Feature request"}],
            },
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": feature}],
            },
        ],
    }


@router.post("/feature-request", status_code=200)
async def create_feature_request(body: FeatureRequestBody) -> dict:
    """Create a Jira Task with the submitted feature request.

    The endpoint is unauthenticated: the PayPal donation redirect acts as the
    implicit gate.  Rate-limiting is applied at the CloudFront / ALB layer.

    Returns a JSON thank-you message regardless of Jira issue key so that
    internal Jira identifiers are never exposed in the HTTP response.
    """
    settings = get_settings()

    if not settings.jira_api_key:
        raise HTTPException(
            status_code=503,
            detail="Feature requests are temporarily unavailable. Please try again later.",
        )

    # Basic auth token: base64(email:api_token)
    raw_token = f"{settings.jira_email}:{settings.jira_api_key}"
    auth_token = base64.b64encode(raw_token.encode()).decode()
    headers = {
        "Authorization": f"Basic {auth_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    payload = {
        "fields": {
            "project": {"key": settings.jira_project_key},
            "issuetype": {"id": settings.jira_issue_type_id},
            "summary": f"Feature Request from {body.name}",
            "description": _build_jira_description(body.name, body.email, body.feature),
        }
    }

    jira_url = f"{settings.jira_host}/rest/api/3/issue"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(jira_url, json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not reach the feature request service. Please try again later.",
        ) from exc

    if response.status_code not in (200, 201):
        raise HTTPException(
            status_code=502,
            detail="Could not register the feature request. Please try again later.",
        )

    return {
        "status": "created",
        "message": (
            "Vielen Dank für deine Unterstützung! "
            "Dein Feature-Wunsch wurde erfolgreich eingereicht und wird auf "
            "Best-Effort-Basis berücksichtigt."
        ),
    }
