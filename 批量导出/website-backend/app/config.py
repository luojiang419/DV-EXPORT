from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


@dataclass(slots=True)
class Settings:
    base_dir: Path
    host: str
    port: int
    db_path: Path
    sponsor_admin_token: str
    allowed_origins: list[str]


def load_settings(base_dir: Path | None = None) -> Settings:
    resolved_base_dir = (base_dir or Path(__file__).resolve().parents[1]).resolve()
    env_values = _read_env_file(resolved_base_dir / ".env")

    def read(name: str, default: str) -> str:
        return os.environ.get(name, env_values.get(name, default))

    host = read("DV_EXPORT_SUPPORT_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(read("DV_EXPORT_SUPPORT_PORT", "3013"))
    db_path = Path(
        read(
            "DV_EXPORT_SUPPORT_DB_PATH",
            str(resolved_base_dir / "db" / "dv_export_support.sqlite3"),
        )
    ).resolve()
    sponsor_admin_token = read("DV_EXPORT_SPONSOR_ADMIN_TOKEN", "").strip()
    allowed_origins = [
        item.strip().rstrip("/")
        for item in read(
            "DV_EXPORT_SUPPORT_ALLOWED_ORIGINS",
            "http://127.0.0.1:43128,http://localhost:43128,http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
        if item.strip()
    ]

    db_path.parent.mkdir(parents=True, exist_ok=True)
    return Settings(
        base_dir=resolved_base_dir,
        host=host,
        port=port,
        db_path=db_path,
        sponsor_admin_token=sponsor_admin_token,
        allowed_origins=allowed_origins,
    )
