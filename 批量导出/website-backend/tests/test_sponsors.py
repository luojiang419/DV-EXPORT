from __future__ import annotations

import shutil
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException

from app.config import load_settings
from app.db import connect, init_db
from app.sponsors import (
    create_sponsor_claim,
    get_sponsor_claim,
    list_admin_claims,
    list_public_sponsors,
    update_claim_status,
    verify_sponsor_admin,
)


class SponsorServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp(prefix="dv-export-sponsor-test-"))
        (self.temp_dir / ".env").write_text(
            "DV_EXPORT_SPONSOR_ADMIN_TOKEN=test-sponsor-token\n",
            encoding="utf-8",
        )
        self.settings = load_settings(self.temp_dir)
        init_db(self.settings.db_path)

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create(self, name: str, amount: str, identity: str) -> dict[str, object]:
        with connect(self.settings.db_path) as conn:
            claim = create_sponsor_claim(
                conn,
                settings=self.settings,
                display_name=name,
                amount=Decimal(amount),
                payment_channel="wechat",
                client_identity=identity,
            )
            conn.commit()
        return claim

    def test_pending_claim_is_not_public_until_confirmed(self) -> None:
        claim = self._create("热心朋友", "12.34", "client-a")
        with connect(self.settings.db_path) as conn:
            self.assertEqual(list_public_sponsors(conn), [])
            self.assertEqual(len(list_admin_claims(conn, "pending")), 1)
            updated = update_claim_status(conn, public_id=str(claim["id"]), action="confirm")
            conn.commit()

        self.assertEqual(updated["status"], "confirmed")
        with connect(self.settings.db_path) as conn:
            public = list_public_sponsors(conn)
        self.assertEqual(public[0]["displayName"], "热心朋友")
        self.assertEqual(public[0]["amount"], "12.34")
        self.assertNotIn("status", public[0])

    def test_public_list_uses_time_not_amount(self) -> None:
        first = self._create("先支持", "999.00", "client-a")
        second = self._create("后支持", "1.00", "client-b")
        with connect(self.settings.db_path) as conn:
            update_claim_status(conn, public_id=str(first["id"]), action="confirm")
            update_claim_status(conn, public_id=str(second["id"]), action="confirm")
            conn.commit()
            public = list_public_sponsors(conn)
        self.assertEqual([item["displayName"] for item in public], ["后支持", "先支持"])

    def test_claim_status_and_admin_token(self) -> None:
        claim = self._create("测试称呼", "8", "client-a")
        with connect(self.settings.db_path) as conn:
            stored = get_sponsor_claim(conn, str(claim["id"]))
        self.assertIsNotNone(stored)
        self.assertEqual(stored["status"], "pending")
        verify_sponsor_admin(self.settings, "test-sponsor-token")
        with self.assertRaises(HTTPException) as error:
            verify_sponsor_admin(self.settings, "wrong")
        self.assertEqual(error.exception.status_code, 401)

    def test_rate_limit_rejects_fourth_recent_claim(self) -> None:
        for index in range(3):
            self._create(f"用户{index}", "1", "same-client")
        with self.assertRaises(HTTPException) as error:
            self._create("第四次", "1", "same-client")
        self.assertEqual(error.exception.status_code, 429)


if __name__ == "__main__":
    unittest.main()
