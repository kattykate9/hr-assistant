"""Local single-company settings. Does not schedule or send reports."""
import json
import re
from contextlib import closing
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CompanySettings(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    company_name: str = Field(default="", max_length=200)
    company_description: str = Field(default="", max_length=5000)
    website: str = Field(default="", max_length=2000)
    hr_email: str = Field(default="", max_length=254)
    vacancy_language: Literal["ru", "en", "uk"] = "ru"
    report_timezone: str = Field(default="Asia/Nicosia", min_length=1, max_length=100)
    morning_report_time: str = "09:00"
    evening_report_time: str = "18:00"

    @field_validator("website")
    @classmethod
    def valid_website(cls, value):
        if not value:
            return value
        try:
            url = urlsplit(value)
            port = url.port
            if (url.scheme not in {"http", "https"} or not url.hostname
                    or url.username is not None or url.password is not None
                    or any(char.isspace() or ord(char) < 32 for char in value)):
                raise ValueError()
        except ValueError:
            raise ValueError("Укажите полный адрес сайта, например https://example.com") from None
        return value

    @field_validator("hr_email")
    @classmethod
    def valid_email(cls, value):
        if value and not re.fullmatch(r"[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+", value):
            raise ValueError("Проверьте рабочую почту HR")
        return value

    @field_validator("report_timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Укажите существующий часовой пояс IANA, например Asia/Nicosia") from None
        return value

    @field_validator("morning_report_time", "evening_report_time")
    @classmethod
    def valid_time(cls, value):
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("Укажите время в формате ЧЧ:ММ")
        return value

    @model_validator(mode="after")
    def valid_order(self):
        if self.morning_report_time >= self.evening_report_time:
            raise ValueError("Время утреннего отчёта должно быть раньше вечернего")
        return self


class SettingsUpdate(CompanySettings):
    company_name: str = Field(min_length=1, max_length=200)
    version: int = Field(ge=1, strict=True)


class SettingsResponse(CompanySettings):
    version: int
    updated_at: datetime | None
    reports_status: Literal["not_connected"] = "not_connected"


def install_company_settings(app, connect_db):
    router = APIRouter(tags=["Настройки компании"])
    with closing(connect_db()) as connection:
        with connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS company_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    data TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT
                )
            """)
            connection.execute(
                "INSERT OR IGNORE INTO company_settings (id, data, version) VALUES (1, ?, 1)",
                (CompanySettings().model_dump_json(),),
            )

    def response_from_row(row):
        return {**json.loads(row["data"]), "version": row["version"],
                "updated_at": row["updated_at"], "reports_status": "not_connected"}

    # Both endpoints inherit the existing application-wide security middleware.
    @router.get("/settings/company", response_model=SettingsResponse)
    def get_settings():
        with closing(connect_db()) as connection:
            row = connection.execute("SELECT * FROM company_settings WHERE id = 1").fetchone()
        return response_from_row(row)

    @router.put("/settings/company", response_model=SettingsResponse)
    def save_settings(data: SettingsUpdate):
        values = data.model_dump(exclude={"version"})
        now = datetime.now(timezone.utc).isoformat()
        with closing(connect_db()) as connection:
            with connection:
                cursor = connection.execute(
                    "UPDATE company_settings SET data = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?",
                    (json.dumps(values, ensure_ascii=False), now, data.version),
                )
                if cursor.rowcount != 1:
                    raise HTTPException(409, "Настройки уже изменены в другой вкладке. Скопируйте нужные правки и обновите страницу перед повторным сохранением.")
                row = connection.execute("SELECT * FROM company_settings WHERE id = 1").fetchone()
        return response_from_row(row)

    app.include_router(router)
