from __future__ import annotations

from decimal import Decimal
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from .config import load_settings
from .db import db_session, init_db
from .sponsors import (
    create_sponsor_claim,
    get_sponsor_claim,
    list_admin_claims,
    list_public_sponsors,
    sponsor_counts,
    update_claim_status,
    verify_sponsor_admin,
)


settings = load_settings()
init_db(settings.db_path)

app = FastAPI(title="DV EXPORT Sponsor Backend", version="1.0.0")
if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Accept", "Content-Type", "X-Admin-Token"],
        allow_credentials=False,
    )


class SponsorClaimBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    display_name: str = Field(alias="displayName", min_length=1, max_length=80)
    amount: Decimal
    payment_channel: Literal["wechat", "alipay"] = Field(alias="paymentChannel")
    website: str = Field(default="", max_length=200)


class SponsorAdminActionBody(BaseModel):
    action: Literal["confirm", "reject"]


def _client_identity(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    host = forwarded or (request.client.host if request.client else "unknown")
    user_agent = request.headers.get("user-agent", "")[:180]
    return f"{host}|{user_agent}"


@app.get("/api/dv-export-support/v1/health")
def health() -> dict[str, object]:
    with db_session(settings.db_path) as conn:
        counts = sponsor_counts(conn)
    return {"ok": True, "service": "dv-export-support", "version": "1.0.0", "sponsorClaims": counts}


@app.get("/api/dv-export-support/v1/sponsors")
def public_sponsors() -> dict[str, object]:
    with db_session(settings.db_path) as conn:
        items = list_public_sponsors(conn)
    return {"ok": True, "returnedCount": len(items), "sponsors": items}


@app.post("/api/dv-export-support/v1/claims", status_code=status.HTTP_201_CREATED)
def submit_sponsor_claim(payload: SponsorClaimBody, request: Request) -> dict[str, object]:
    if payload.website.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="提交内容无效。")
    with db_session(settings.db_path) as conn:
        claim = create_sponsor_claim(
            conn,
            settings=settings,
            display_name=payload.display_name,
            amount=payload.amount,
            payment_channel=payload.payment_channel,
            client_identity=_client_identity(request),
        )
    return {"ok": True, "message": "已提交，待管理员核实到账后公开显示。", "claim": claim}


@app.get("/api/dv-export-support/v1/claims/{public_id}")
def sponsor_claim_status(public_id: str) -> dict[str, object]:
    with db_session(settings.db_path) as conn:
        claim = get_sponsor_claim(conn, public_id)
    if claim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="赞助记录不存在。")
    return {"ok": True, "claim": claim}


@app.get("/api/dv-export-support/v1/admin/claims")
def admin_sponsor_claims(
    claim_status: str = "pending",
    admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, object]:
    verify_sponsor_admin(settings, admin_token)
    with db_session(settings.db_path) as conn:
        items = list_admin_claims(conn, claim_status)
    return {"ok": True, "returnedCount": len(items), "claims": items}


@app.post("/api/dv-export-support/v1/admin/claims/{public_id}")
def admin_update_sponsor_claim(
    public_id: str,
    payload: SponsorAdminActionBody,
    admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, object]:
    verify_sponsor_admin(settings, admin_token)
    with db_session(settings.db_path) as conn:
        claim = update_claim_status(conn, public_id=public_id, action=payload.action)
    return {"ok": True, "claim": claim}
