from candidate_export import ExportRequest, export_csv
from fastapi import Header
from candidate_tasks import list_task_items, task_overview
"""Shared report data and paginated applications for the local HR workspace.
No messages are sent. Reporting uses the configured local schedule and UTC queries.
"""
from candidate_assessments import application_matches, match_summary
import json
import unicodedata
from contextlib import closing
from datetime import datetime, time, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime
from candidate_workflow import ApplicationStatus

SOURCE_LABELS = {
    "hh": "hh.ru", "telegram": "Telegram", "linkedin": "LinkedIn",
    "djinni": "Djinni", "website": "Сайт", "manual": "Вручную",
}


def utc_now():
    return datetime.now(timezone.utc)


def settings(connection):
    row = connection.execute("SELECT data FROM company_settings WHERE id=1").fetchone()
    saved = json.loads(row["data"]) if row else {}
    return {
        "report_timezone": saved.get("report_timezone", "Asia/Nicosia"),
        "morning_report_time": saved.get("morning_report_time", "09:00"),
        "evening_report_time": saved.get("evening_report_time", "18:00"),
    }


def report_window(config, now, mode="latest"):
    zone = ZoneInfo(config["report_timezone"])
    local = now.astimezone(zone)
    day = local.date()
    morning_time = time.fromisoformat(config["morning_report_time"])
    evening_time = time.fromisoformat(config["evening_report_time"])
    morning = datetime.combine(day, morning_time, zone)
    evening = datetime.combine(day, evening_time, zone)
    if local >= evening:
        start, end, kind = morning, evening, "evening"
        next_at = datetime.combine(day + timedelta(days=1), morning_time, zone)
    elif local >= morning:
        start = datetime.combine(day - timedelta(days=1), evening_time, zone)
        end, kind, next_at = morning, "morning", evening
    else:
        start = datetime.combine(day - timedelta(days=1), morning_time, zone)
        end = datetime.combine(day - timedelta(days=1), evening_time, zone)
        kind, next_at = "evening", morning
    if mode == "current":
        start, end, kind = end, local, "current"
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc), kind, next_at


def source_rows(counts):
    codes = list(SOURCE_LABELS) + sorted(set(counts) - set(SOURCE_LABELS))
    return [{"source": code, "label": SOURCE_LABELS.get(code, code), "count": counts.get(code, 0)} for code in codes]


def build_report(connection, config, now=None, mode="latest", exclude_hh=False):
    """Reusable for a future Telegram sender, with an explicit scheduled `now`."""
    now = now or utc_now()
    start, end, kind, next_at = report_window(config, now, mode)
    # Half-open intervals prevent counting boundary events in two reports.
    where = "julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)"
    if exclude_hh:
        where += " AND source != 'hh'"
    params = (start.isoformat(), end.isoformat())
    counts = {row["source"]: row["count"] for row in connection.execute(
        f"SELECT source, COUNT(*) AS count FROM applications WHERE {where} GROUP BY source", params
    )}
    received = sum(counts.values())
    new_count = connection.execute(
        f"SELECT COUNT(*) FROM applications WHERE {where} AND status='new'", params
    ).fetchone()[0]
    by_vacancy = {str(row["vacancy_id"]): row["count"] for row in connection.execute(
        "SELECT vacancy_id, COUNT(*) AS count FROM applications "
        + ("WHERE source != 'hh' " if exclude_hh else "")
        + "GROUP BY vacancy_id"
    )}
    cohort = connection.execute(f"SELECT id,vacancy_id,status FROM applications WHERE {where}",params).fetchall()
    matches = application_matches(connection,cohort)
    manual_assessed = sum(m['has_assessment'] for m in matches.values())
    from candidate_workflow import STAGES
    stage_counts = {key:0 for key in STAGES}
    for row in cohort:stage_counts[row['status']] = stage_counts.get(row['status'],0)+1
    waiting = connection.execute("SELECT COUNT(*) FROM application_reply_flags f JOIN applications a ON a.id=f.application_id WHERE f.needs_reply=1" + (" AND a.source!='hh'" if exclude_hh else "")).fetchone()[0]
    link = "/applications?" + urlencode({"created_from": start.isoformat(), "created_before": end.isoformat()})
    return {
        "mode": mode, "kind": kind, "timezone": config["report_timezone"],
        "period_start": start.isoformat(), "period_end": end.isoformat(),
        "generated_at": now.isoformat(), "next_report_at": next_at.isoformat(),
        "morning_time": config["morning_report_time"], "evening_time": config["evening_report_time"],
        "manual_assessed":manual_assessed,"manual_unassessed":received-manual_assessed,
        "stages":[{"status":k,"label":STAGES.get(k,k),"count":v} for k,v in stage_counts.items()],
        "awaiting_reply":waiting,
        "received": received, "new_in_period": new_count,
        "ai_processed": None, "ai_assessment": None, "ai_status": "not_connected",
        "sources": source_rows(counts), "applications_url": link,
        "vacancy_application_counts": by_vacancy,
        "all_applications_total": sum(by_vacancy.values()),
        "telegram_delivery_status": "not_connected",
    }


def install_recruitment_views(app, connect_db):
    router = APIRouter(prefix="/recruiting", tags=["Отчёты и отклики"])

    @router.get("/report")
    def report(mode: Literal["latest", "current"] = "latest"):
        with closing(connect_db()) as connection:
            # A single read snapshot keeps totals and bars consistent.
            connection.execute("BEGIN")
            return build_report(connection, settings(connection), mode=mode)

    @router.get("/telegram-report")
    def telegram_report():
        with closing(connect_db()) as connection:
            connection.execute("BEGIN")
            data = build_report(connection, settings(connection), exclude_hh=False)
            tasks = task_overview(connection, exclude_hh=False, include_items=False)
        # Only aggregate fields; no resume, contacts, candidate or vacancy IDs.
        fields = ("mode", "kind", "timezone", "period_start", "period_end", "next_report_at",
                  "generated_at", "manual_assessed", "manual_unassessed", "stages", "awaiting_reply", "received", "new_in_period", "ai_processed", "ai_assessment", "ai_status", "applications_url")
        result = {key: data[key] for key in fields}
        result["sources"] = data["sources"]
        result["tasks"] = tasks
        result["scope"] = "all_sources_aggregates"
        return result

    @router.get("/applications")
    def applications(
        status: ApplicationStatus | None = None,
        vacancy_id: Annotated[int | None, Query(gt=0)] = None,
        source: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
        q: Annotated[str, Query(max_length=200)] = "",
        assessment: Literal["all", "none", "assessed"] = "all",
        sort: Literal["date_desc", "date_asc", "match_desc", "match_asc"] = "date_desc",
        created_from: AwareDatetime | None = None,
        created_before: AwareDatetime | None = None,
        page: Annotated[int, Query(ge=1)] = 1,
        page_size: Annotated[int, Query(ge=1, le=100)] = 30,
        reply: Literal["all", "waiting"] = "all",
    ):
        return query_applications(status, vacancy_id, source, q, assessment, sort, created_from, created_before, page, page_size, reply)

    def query_applications(
        status: ApplicationStatus | None = None,
        vacancy_id: Annotated[int | None, Query(gt=0)] = None,
        source: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
        q: Annotated[str, Query(max_length=200)] = "",
        assessment: Literal["all", "none", "assessed"] = "all",
        sort: Literal["date_desc", "date_asc", "match_desc", "match_asc"] = "date_desc",
        created_from: AwareDatetime | None = None,
        created_before: AwareDatetime | None = None,
        page: Annotated[int, Query(ge=1)] = 1,
        page_size: Annotated[int, Query(ge=1, le=100)] = 30,
        reply: Literal["all", "waiting"] = "all",
        export_request=None,
    ):
        if created_from and created_before and created_from > created_before:
            raise HTTPException(422, "Начало периода должно быть не позже окончания.")
        def fold(value):
            return unicodedata.normalize("NFKC", value or "").casefold()
        # Reuse the same scoring formula as the candidate card. No stored score to go stale.
        def assessment_metric(criteria, answers, metric):
            if criteria is None or answers is None:
                return 0
            return int(match_summary(json.loads(criteria), json.loads(answers), True)[metric])
        evaluated = "assessment_metric(e.criteria_json, e.answers_json, 'has_assessment')"
        percent = "assessment_metric(e.criteria_json, e.answers_json, 'percent')"
        clauses, params = [], []
        if reply == "waiting":
            clauses.append("EXISTS (SELECT 1 FROM application_reply_flags f WHERE f.application_id=a.id AND f.needs_reply=1)")
        if status:
            clauses.append("a.status = ?"); params.append(status)
        if vacancy_id is not None:
            clauses.append("a.vacancy_id = ?"); params.append(vacancy_id)
        if created_from:
            clauses.append("julianday(a.created_at) >= julianday(?)"); params.append(created_from.isoformat())
        if created_before:
            clauses.append("julianday(a.created_at) < julianday(?)"); params.append(created_before.isoformat())
        if assessment != "all":
            clauses.append(evaluated + (" = 0" if assessment == "none" else " = 1"))
        # All words must be present; they may be in different fields. Symbols are literal.
        for word in dict.fromkeys(fold(q).split()):
            clauses.append("instr(search_fold(COALESCE(a.name,'') || ' ' || COALESCE(a.contact,'') || ' ' || COALESCE(a.resume_text,'')), ?) > 0")
            params.append(word)
        joins = "FROM applications a LEFT JOIN vacancies v ON v.id=a.vacancy_id LEFT JOIN candidate_assessments e ON e.application_id=a.id"
        ordering = {
            "date_desc": "julianday(a.created_at) DESC, a.id DESC",
            "date_asc": "julianday(a.created_at) ASC, a.id ASC",
            "match_desc": evaluated + " DESC, " + percent + " DESC, julianday(a.created_at) DESC, a.id DESC",
            "match_asc": evaluated + " DESC, " + percent + " ASC, julianday(a.created_at) DESC, a.id DESC",
        }[sort]
        with closing(connect_db()) as connection:
            connection.create_function("search_fold", 1, fold, deterministic=True)
            connection.create_function("assessment_metric", 3, assessment_metric, deterministic=True)
            connection.execute("BEGIN")
            vacancy = None
            if vacancy_id is not None:
                row = connection.execute("SELECT id, title FROM vacancies WHERE id = ?", (vacancy_id,)).fetchone()
                if row is None:
                    raise HTTPException(404, "Вакансия не найдена")
                vacancy = dict(row)
            base_where = " AND ".join(clauses) or "1=1"
            counts = {row["source"]: row["count"] for row in connection.execute(
                f"SELECT a.source, COUNT(*) AS count {joins} WHERE {base_where} GROUP BY a.source", params
            )}
            if source:
                clauses.append("a.source = ?"); params.append(source)
            if export_request is not None:
                clauses.append("a.source != 'hh'")
                if export_request.mode == 'selected':
                    if not export_request.ids:
                        raise HTTPException(422, 'Выберите хотя бы один отклик')
                    ids = list(dict.fromkeys(export_request.ids))
                    clauses.append('a.id IN (' + ','.join('?' for _ in ids) + ')')
                    params.extend(ids)
            where = " AND ".join(clauses) or "1=1"
            total = connection.execute(f"SELECT COUNT(*) {joins} WHERE {where}", params).fetchone()[0]
            if export_request is not None:
                if total == 0: raise HTTPException(422, 'Нет доступных откликов для экспорта. Отклики hh.ru пока исключены.')
                if total > 2000: raise HTTPException(413, 'Найдено больше 2000 откликов. Сузьте фильтры; частичный файл не создавался.')
                if export_request.mode == 'selected' and total != len(set(export_request.ids)):
                    raise HTTPException(409, 'Часть выбранных откликов недоступна или больше не соответствует фильтрам. Обновите страницу.')
                page, page_size = 1, 2000
            pages = max(1, (total + page_size - 1) // page_size)
            page = min(page, pages)
            rows = connection.execute(
                f"SELECT a.*, v.title AS vacancy_title {joins} WHERE {where} ORDER BY {ordering} LIMIT ? OFFSET ?",
                [*params, page_size, (page-1)*page_size],
            ).fetchall()
            config = settings(connection)
            matches = application_matches(connection, rows)
            if export_request is not None:
                return export_csv(connection, rows, matches, export_request)
            tasks = list_task_items(connection, rows)
        return {
            "items": [{**dict(row), "match": matches[row["id"]], "next_action": tasks.get(row["id"])} for row in rows], "total": total, "page": page,
            "page_size": page_size, "pages": pages, "vacancy": vacancy,
            "sources": source_rows(counts), "timezone": config["report_timezone"],
            "query": q.strip(), "assessment": assessment, "sort": sort,
            "created_from": created_from.isoformat() if created_from else None,
            "created_before": created_before.isoformat() if created_before else None,
        }

    @router.post('/export')
    def export(data: ExportRequest, x_hr_action: Annotated[str | None, Header()] = None):
        if x_hr_action != 'candidate-workflow': raise HTTPException(403, 'Используйте экспорт из кабинета')
        return query_applications(**data.filters.model_dump(), export_request=data)

    app.include_router(router)
