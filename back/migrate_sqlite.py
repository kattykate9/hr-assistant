"""Однократный перенос данных из SQLite (hr_assistant.db, telegram_reports.db) в PostgreSQL.

    python migrate_sqlite.py /path/to/hr_assistant.db [/path/to/telegram_reports.db]

Схема в PostgreSQL создаётся автоматически. Переносить можно только в пустую базу.
"""
import json
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Jsonb

from db import CONNECTION_KWARGS, database_url, init_db

# Порядок важен из-за внешних ключей.
TABLES = {
    "job_descriptions": {
        "columns": ["id", "title", "direction", "content", "status", "version", "created_at", "updated_at", "approved_at"],
        "timestamps": {"created_at", "updated_at", "approved_at"},
    },
    "vacancies": {
        "columns": ["id", "title", "direction", "description", "criteria", "created_at", "vacancy_status", "archived_at",
                    "archive_version", "language", "source_jd_id", "source_jd_version", "preferred_criteria"],
        "timestamps": {"created_at", "archived_at"},
        "json": {"criteria", "preferred_criteria"},
    },
    "applications": {
        "columns": ["id", "vacancy_id", "name", "contact", "source", "resume_text", "status", "created_at", "review_version"],
        "timestamps": {"created_at"},
    },
    "application_events": {
        "columns": ["id", "application_id", "event_type", "old_status", "new_status", "note", "request_id", "created_at"],
        "timestamps": {"created_at"},
    },
    "candidate_assessments": {
        "columns": ["application_id", "criteria_json", "answers_json", "version", "updated_at"],
        "timestamps": {"updated_at"},
        "json": {"criteria_json", "answers_json"},
    },
    "candidate_tasks": {
        "columns": ["application_id", "title", "comment", "due_at", "completed_at", "version", "updated_at"],
        "timestamps": {"due_at", "completed_at", "updated_at"},
    },
    "candidate_task_events": {
        "columns": ["id", "application_id", "action", "snapshot", "created_at"],
        "timestamps": {"created_at"},
        "json": {"snapshot"},
    },
    "company_settings": {
        "columns": ["id", "data", "version", "updated_at"],
        "timestamps": {"updated_at"},
        "json": {"data"},
    },
}

REPORT_TABLE = {
    "columns": ["recipient", "period", "status", "updated_at"],
    "timestamps": {"updated_at"},
}


def to_timestamp(value):
    if value is None:
        return None
    result = datetime.fromisoformat(value)
    # Код всегда писал UTC; на случай наивных значений считаем их UTC.
    return result if result.tzinfo else result.replace(tzinfo=timezone.utc)


def copy_table(source, target, name, spec):
    if not source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone():
        print(f"{name}: нет в SQLite, пропущено")
        return
    existing = {row[1] for row in source.execute(f"PRAGMA table_info({name})")}
    # Колонки, добавленные поздними версиями, могут отсутствовать: тогда работают DEFAULT.
    columns = [column for column in spec["columns"] if column in existing]
    rows = source.execute(f"SELECT {', '.join(columns)} FROM {name}").fetchall()
    converted = []
    for row in rows:
        values = []
        for column, value in zip(columns, row):
            if column in spec.get("timestamps", ()):
                value = to_timestamp(value)
            elif column in spec.get("json", ()) and value is not None:
                value = Jsonb(json.loads(value))
            values.append(value)
        converted.append(values)
    placeholders = ", ".join(["%s"] * len(columns))
    with target.cursor() as cursor:
        if name == "company_settings":
            # Строка по умолчанию могла быть создана API при старте — заменяем её.
            cursor.execute("DELETE FROM company_settings")
        cursor.executemany(f"INSERT INTO {name} ({', '.join(columns)}) VALUES ({placeholders})", converted)
    if "id" in columns and name != "company_settings":
        target.execute(
            f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), COALESCE((SELECT max(id) FROM {name}), 0) + 1, false)"
        )
    print(f"{name}: {len(converted)}")


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit(__doc__)
    with psycopg.connect(database_url(), **CONNECTION_KWARGS) as target:
        init_db(target)
        for name in TABLES:
            if name != "company_settings" and target.execute(f"SELECT 1 FROM {name} LIMIT 1").fetchone():
                raise SystemExit(f"В PostgreSQL уже есть данные ({name}). Перенос возможен только в пустую базу.")
        with closing(sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)) as source:
            for name, spec in TABLES.items():
                copy_table(source, target, name, spec)
        if len(sys.argv) == 3:
            with closing(sqlite3.connect(f"file:{sys.argv[2]}?mode=ro", uri=True)) as source:
                copy_table(source, target, "report_delivery", REPORT_TABLE)
    print("Готово.")


if __name__ == "__main__":
    main()
