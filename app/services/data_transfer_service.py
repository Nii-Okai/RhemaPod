"""Admin database export / import (Settings › Data).

* `list_tables` describes every table the app owns, with a row count and what
  each one allows (export, import, replace) and which tables point at it.
* `export_tables` reads whole tables into one JSON document:

      {"format": "rhemapod-export", "version": 1, "exported_at": ...,
       "schema_revision": "<alembic head>",
       "tables": {"<name>": {"columns": [...], "rows": [[...], ...]}}}

* `import_document` validates such a document and writes it in ONE
  transaction, either merging (upsert by primary key) or replacing (delete
  every row, then insert). A dry run does all of it and rolls back, so the
  preview counts are what a real run would do.

Guard rails, all enforced here rather than in the UI:

* Admin only (the router), and every run that is not a dry run must carry the
  typed confirmation phrase for its mode.
* The document's `schema_revision` must match this database's, so a file from
  an older or newer schema is refused instead of half-applied.
* Every value is coerced to its column's type up front; one bad cell refuses
  the whole import before anything is written.
* `users.password_hash` is never exported and never accepted on import, so an
  export file holds no credentials and an import can't plant one.
* `audit_log` is export-only: the trail of who did what can't be rewritten.
* `users` can only be merged, never replaced, and the importing admin's own
  row is always skipped, so an import can't lock its runner out.
* Replacing a table also deletes (or nulls) rows in the tables that point at
  it, so replace mode refuses a selection that leaves any of those out —
  nothing outside the selection changes silently.
"""
from __future__ import annotations

import base64
import enum
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Table,
    Time,
    Uuid,
    delete,
    func,
    insert,
    inspect,
    select,
    text,
    tuple_,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import TypeDecorator, TypeEngine

import app.models.models  # noqa: F401 — registers every table on Base.metadata
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.db.database import Base
from app.models.models import AuditAction, AuditOutcome, User
from app.services import audit_service, content_service, settings_service
from app.services.audit_service import AuditContext, AuditTarget

log = get_logger("data_transfer")

FORMAT = "rhemapod-export"
FORMAT_VERSION = 1

# Columns left out of every export and refused on import.
REDACTED_COLUMNS: dict[str, frozenset[str]] = {"users": frozenset({"password_hash"})}
# Export-only tables.
IMPORT_FORBIDDEN: frozenset[str] = frozenset({"audit_log"})
# Merge-only tables.
REPLACE_FORBIDDEN: frozenset[str] = frozenset({"users"})
# Tables that must hold exactly one row after a replace.
SINGLETON_TABLES: frozenset[str] = frozenset({"church_settings"})

CONFIRM_PHRASE: dict[str, str] = {"merge": "IMPORT", "replace": "REPLACE"}

# Upper bound on rows in one export or import — the whole document is built
# (and, through the BFF, buffered) in memory.
MAX_ROWS = 250_000
_CHUNK = 500
_MAX_ERRORS_SHOWN = 10

Mode = Literal["merge", "replace"]


class DataTransferError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


# ── Table registry ────────────────────────────────────────────────────────────
def _tables() -> list[Table]:
    """Every app table, parents before children."""
    return list(Base.metadata.sorted_tables)


def _table_map() -> dict[str, Table]:
    return {t.name: t for t in _tables()}


def _exported_columns(table: Table) -> list[str]:
    hidden = REDACTED_COLUMNS.get(table.name, frozenset())
    return [c.name for c in table.columns if c.name not in hidden]


def referenced_by() -> dict[str, set[str]]:
    """table -> the other tables holding a foreign key to it."""
    out: dict[str, set[str]] = {t.name: set() for t in _tables()}
    for table in _tables():
        for fk in table.foreign_keys:
            parent = fk.column.table.name
            if parent != table.name:
                out.setdefault(parent, set()).add(table.name)
    return out


def replace_closure(names: set[str]) -> set[str]:
    """`names` plus every table that (transitively) points at one of them —
    the tables a replace of `names` would touch."""
    refs = referenced_by()
    closed = set(names)
    pending = list(names)
    while pending:
        for child in refs.get(pending.pop(), ()):
            if child not in closed:
                closed.add(child)
                pending.append(child)
    return closed


async def schema_revision(db: AsyncSession) -> str | None:
    """The alembic head this database is at, or None when it was never
    migrated with alembic (the test suite's `create_all`)."""
    has_table = await db.run_sync(
        lambda s: inspect(s.connection()).has_table("alembic_version")
    )
    if not has_table:
        return None
    return (
        await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
    ).scalar_one_or_none()


@dataclass
class TableInfo:
    name: str
    rows: int
    importable: bool
    replaceable: bool
    referenced_by: list[str]


async def list_tables(db: AsyncSession) -> tuple[list[TableInfo], str | None]:
    refs = referenced_by()
    infos: list[TableInfo] = []
    for table in _tables():
        count = (await db.execute(select(func.count()).select_from(table))).scalar_one()
        infos.append(TableInfo(
            name=table.name,
            rows=count,
            importable=table.name not in IMPORT_FORBIDDEN,
            replaceable=(
                table.name not in IMPORT_FORBIDDEN
                and table.name not in REPLACE_FORBIDDEN
            ),
            referenced_by=sorted(refs.get(table.name, ())),
        ))
    return infos, await schema_revision(db)


# ── Export ────────────────────────────────────────────────────────────────────
def _encode(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, (dict, list)):
        return value
    return str(value)


def _resolve(names: list[str] | None) -> list[Table]:
    """The requested tables in dependency order; all of them for None."""
    tables = _tables()
    if not names:
        return tables
    known = {t.name for t in tables}
    unknown = sorted(set(names) - known)
    if unknown:
        raise DataTransferError(f"Unknown table(s): {', '.join(unknown)}", 422)
    wanted = set(names)
    return [t for t in tables if t.name in wanted]


async def export_tables(db: AsyncSession, names: list[str] | None) -> dict[str, Any]:
    tables = _resolve(names)
    out: dict[str, Any] = {}
    total = 0
    for table in tables:
        columns = _exported_columns(table)
        stmt = select(*[table.c[name] for name in columns]).order_by(
            *table.primary_key.columns
        )
        rows = (await db.execute(stmt)).all()
        total += len(rows)
        if total > MAX_ROWS:
            raise DataTransferError(
                f"That export is over {MAX_ROWS:,} rows. Export fewer tables at a time.",
                413,
            )
        out[table.name] = {
            "columns": columns,
            "rows": [[_encode(v) for v in row] for row in rows],
        }
    return {
        "format": FORMAT,
        "version": FORMAT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "schema_revision": await schema_revision(db),
        "tables": out,
    }


# ── Import: decoding ──────────────────────────────────────────────────────────
class _BadValue(ValueError):
    pass


def _base_type(t: TypeEngine) -> TypeEngine:
    while isinstance(t, TypeDecorator):
        t = t.impl_instance if hasattr(t, "impl_instance") else t.impl
    return t


def _decoder(column) -> Callable[[Any], Any]:
    """Coerce one JSON value to what `column` stores, or raise `_BadValue`."""
    t = _base_type(column.type)
    nullable = column.nullable

    def wrap(fn: Callable[[Any], Any]) -> Callable[[Any], Any]:
        def run(value: Any) -> Any:
            if value is None:
                if not nullable and column.default is None and column.server_default is None:
                    raise _BadValue("may not be empty")
                return None
            return fn(value)
        return run

    if isinstance(t, SAEnum) and t.enum_class is not None:
        enum_cls = t.enum_class

        def to_enum(v: Any) -> Any:
            if not isinstance(v, str):
                raise _BadValue("must be text")
            try:
                return enum_cls(v)
            except ValueError:
                try:
                    return enum_cls[v]
                except KeyError:
                    allowed = ", ".join(m.value for m in enum_cls)
                    raise _BadValue(f"must be one of: {allowed}") from None
        return wrap(to_enum)

    if isinstance(t, Uuid):
        def to_uuid(v: Any) -> uuid.UUID:
            try:
                return uuid.UUID(str(v))
            except ValueError:
                raise _BadValue("must be a UUID") from None
        return wrap(to_uuid)

    if isinstance(t, DateTime):
        def to_datetime(v: Any) -> datetime:
            if not isinstance(v, str):
                raise _BadValue("must be an ISO date-time")
            try:
                parsed = datetime.fromisoformat(v)
            except ValueError:
                raise _BadValue("must be an ISO date-time") from None
            if t.timezone and parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        return wrap(to_datetime)

    if isinstance(t, Date):
        def to_date(v: Any) -> date:
            try:
                return date.fromisoformat(v)
            except (TypeError, ValueError):
                raise _BadValue("must be an ISO date") from None
        return wrap(to_date)

    if isinstance(t, Time):
        def to_time(v: Any) -> time:
            try:
                return time.fromisoformat(v)
            except (TypeError, ValueError):
                raise _BadValue("must be an ISO time") from None
        return wrap(to_time)

    if isinstance(t, Boolean):
        def to_bool(v: Any) -> bool:
            if not isinstance(v, bool):
                raise _BadValue("must be true or false")
            return v
        return wrap(to_bool)

    if isinstance(t, Integer):
        def to_int(v: Any) -> int:
            if isinstance(v, bool) or not isinstance(v, int):
                raise _BadValue("must be a whole number")
            return v
        return wrap(to_int)

    if isinstance(t, Float):
        def to_float(v: Any) -> float:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise _BadValue("must be a number")
            return float(v)
        return wrap(to_float)

    if isinstance(t, Numeric):
        def to_decimal(v: Any) -> Decimal:
            if isinstance(v, bool):
                raise _BadValue("must be a number")
            try:
                return Decimal(str(v))
            except InvalidOperation:
                raise _BadValue("must be a number") from None
        return wrap(to_decimal)

    if isinstance(t, LargeBinary):
        def to_bytes(v: Any) -> bytes:
            try:
                return base64.b64decode(v, validate=True)
            except (TypeError, ValueError):
                raise _BadValue("must be base64") from None
        return wrap(to_bytes)

    if isinstance(t, JSON):
        return wrap(lambda v: v)

    if isinstance(t, String):
        limit = t.length

        def to_str(v: Any) -> str:
            if not isinstance(v, str):
                raise _BadValue("must be text")
            if limit is not None and len(v) > limit:
                raise _BadValue(f"is longer than {limit} characters")
            return v
        return wrap(to_str)

    # Anything else (a dialect-specific type the app doesn't use today) passes
    # through and is left to the database to accept or refuse.
    return wrap(lambda v: v)


@dataclass
class _TablePlan:
    table: Table
    columns: list[str]
    rows: list[dict[str, Any]]


def _validate_envelope(doc: Any) -> dict[str, Any]:
    if not isinstance(doc, dict) or doc.get("format") != FORMAT:
        raise DataTransferError("That isn't a RhemaPod export file.", 422)
    if doc.get("version") != FORMAT_VERSION:
        raise DataTransferError(
            f"Unsupported export version {doc.get('version')!r} "
            f"(this server reads version {FORMAT_VERSION}).",
            422,
        )
    tables = doc.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise DataTransferError("The file contains no tables.", 422)
    return tables


def _plan(
    raw_tables: dict[str, Any], selected: list[str] | None, mode: Mode
) -> list[_TablePlan]:
    known = _table_map()
    names = list(selected) if selected else list(raw_tables)
    errors: list[str] = []

    for name in names:
        if name not in raw_tables:
            errors.append(f"{name}: not in the file")
        elif name not in known:
            errors.append(f"{name}: no such table")
        elif name in IMPORT_FORBIDDEN:
            errors.append(f"{name}: export only — it can't be imported")
        elif mode == "replace" and name in REPLACE_FORBIDDEN:
            errors.append(f"{name}: can only be merged, not replaced")
    if errors:
        raise DataTransferError("Can't import: " + "; ".join(errors), 422)

    if mode == "replace":
        missing = sorted(replace_closure(set(names)) - set(names))
        if missing:
            raise DataTransferError(
                "Replacing these tables would also delete or change rows in "
                f"{', '.join(missing)}. Include those tables too, or use merge.",
                422,
            )

    plans: list[_TablePlan] = []
    total_rows = 0
    wanted = set(names)
    for table in _tables():
        if table.name not in wanted:
            continue
        body = raw_tables[table.name]
        if not isinstance(body, dict):
            errors.append(f"{table.name}: malformed")
            continue
        columns, rows = body.get("columns"), body.get("rows")
        if not isinstance(columns, list) or not isinstance(rows, list):
            errors.append(f"{table.name}: needs `columns` and `rows` lists")
            continue
        allowed = set(_exported_columns(table))
        unknown = [c for c in columns if c not in allowed]
        if unknown:
            errors.append(f"{table.name}: unknown column(s) {', '.join(map(str, unknown))}")
            continue
        if len(set(columns)) != len(columns):
            errors.append(f"{table.name}: a column is listed twice")
            continue
        pk = [c.name for c in table.primary_key.columns]
        if any(c not in columns for c in pk):
            errors.append(f"{table.name}: missing primary key column(s) {', '.join(pk)}")
            continue
        if mode == "replace" and table.name in SINGLETON_TABLES and len(rows) != 1:
            errors.append(f"{table.name}: must contain exactly one row")
            continue

        total_rows += len(rows)
        if total_rows > MAX_ROWS:
            raise DataTransferError(
                f"The import is over {MAX_ROWS:,} rows. Import fewer tables at a time.",
                413,
            )

        decoders = [_decoder(table.c[c]) for c in columns]
        decoded: list[dict[str, Any]] = []
        seen_keys: set[tuple] = set()
        for index, row in enumerate(rows, start=1):
            if not isinstance(row, list) or len(row) != len(columns):
                errors.append(f"{table.name} row {index}: expected {len(columns)} values")
                continue
            out: dict[str, Any] = {}
            for column, decode, value in zip(columns, decoders, row):
                try:
                    out[column] = decode(value)
                except _BadValue as exc:
                    errors.append(f"{table.name} row {index}: {column} {exc}")
            key = tuple(out.get(c) for c in pk)
            if key in seen_keys:
                errors.append(f"{table.name} row {index}: duplicate primary key")
            seen_keys.add(key)
            decoded.append(out)
            if len(errors) > _MAX_ERRORS_SHOWN:
                break
        if len(errors) > _MAX_ERRORS_SHOWN:
            break
        plans.append(_TablePlan(table=table, columns=list(columns), rows=decoded))

    if errors:
        shown = errors[:_MAX_ERRORS_SHOWN]
        more = len(errors) - len(shown)
        suffix = f" (and {more} more)" if more > 0 else ""
        raise DataTransferError(
            "The file has problems, so nothing was imported: "
            + "; ".join(shown) + suffix,
            422,
        )
    return plans


# ── Import: writing ───────────────────────────────────────────────────────────
@dataclass
class TableResult:
    name: str
    inserted: int = 0
    updated: int = 0
    deleted: int = 0
    skipped: int = 0


@dataclass
class ImportResult:
    mode: Mode
    dry_run: bool
    tables: list[TableResult] = field(default_factory=list)


def _upsert_stmt(dialect: str, table: Table, columns: list[str]):
    pk = [c.name for c in table.primary_key.columns]
    updatable = [c for c in columns if c not in pk]
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as dialect_insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as dialect_insert
    else:  # pragma: no cover - the app runs on Postgres; tests on SQLite
        raise DataTransferError(f"Merge import isn't supported on {dialect}.", 501)
    stmt = dialect_insert(table)
    if not updatable:
        return stmt.on_conflict_do_nothing(index_elements=pk)
    return stmt.on_conflict_do_update(
        index_elements=pk,
        set_={c: stmt.excluded[c] for c in updatable},
    )


async def _existing_keys(
    db: AsyncSession, table: Table, rows: list[dict[str, Any]]
) -> set[tuple]:
    pk_cols = list(table.primary_key.columns)
    keys = [tuple(r[c.name] for c in pk_cols) for r in rows]
    if len(pk_cols) == 1:
        found = (await db.execute(
            select(pk_cols[0]).where(pk_cols[0].in_([k[0] for k in keys]))
        )).scalars().all()
        return {(v,) for v in found}
    found = (await db.execute(
        select(*pk_cols).where(tuple_(*pk_cols).in_(keys))
    )).all()
    return {tuple(row) for row in found}


def _chunks(rows: list[dict[str, Any]]):
    for start in range(0, len(rows), _CHUNK):
        yield rows[start:start + _CHUNK]


async def _write(
    db: AsyncSession, plans: list[_TablePlan], mode: Mode, actor: User
) -> list[TableResult]:
    dialect = db.get_bind().dialect.name
    results = {p.table.name: TableResult(name=p.table.name) for p in plans}

    if mode == "replace":
        for plan in reversed(plans):
            res = await db.execute(delete(plan.table))
            results[plan.table.name].deleted = max(res.rowcount or 0, 0)

    for plan in plans:
        result = results[plan.table.name]
        rows = plan.rows
        if plan.table.name == "users":
            # Never let an import touch the account running it.
            kept = [r for r in rows if r.get("id") != actor.id]
            result.skipped = len(rows) - len(kept)
            rows = kept
        if not rows:
            continue
        if mode == "replace":
            for chunk in _chunks(rows):
                await db.execute(insert(plan.table), chunk)
            result.inserted = len(rows)
            continue
        stmt = _upsert_stmt(dialect, plan.table, plan.columns)
        for chunk in _chunks(rows):
            existing = await _existing_keys(db, plan.table, chunk)
            result.updated += len(existing)
            result.inserted += len(chunk) - len(existing)
            await db.execute(stmt, chunk)
    await db.flush()
    return [results[p.table.name] for p in plans]


def _db_error_message(exc: DBAPIError) -> str:
    detail = str(getattr(exc, "orig", exc)).strip().splitlines()[0][:300]
    return (
        "The database refused the import, so nothing was changed. This usually "
        "means a row points at something that isn't in the file or the "
        f"database, or clashes with an existing row. Database said: {detail}"
    )


async def invalidate_caches() -> None:
    """Drop every cache an import can make stale."""
    await content_service.invalidate_catalog_cache()
    await settings_service.invalidate_public_cache()
    try:
        redis = get_redis()
        keys = [key async for key in redis.scan_iter(match="entitlement:*")]
        if keys:
            await redis.delete(*keys)
    except Exception:  # noqa: BLE001 - best-effort; the TTL bounds staleness
        log.warning("entitlement_cache_invalidation_failed")


async def import_document(
    db: AsyncSession,
    document: Any,
    *,
    mode: Mode,
    tables: list[str] | None,
    dry_run: bool,
    confirm: str | None,
    actor: User,
    ctx: AuditContext,
) -> ImportResult:
    if not dry_run and confirm != CONFIRM_PHRASE[mode]:
        raise DataTransferError(
            f"Type {CONFIRM_PHRASE[mode]} to confirm this import.", 422
        )

    raw_tables = _validate_envelope(document)
    current = await schema_revision(db)
    if document.get("schema_revision") != current:
        raise DataTransferError(
            "This file was exported from a different database version "
            f"({document.get('schema_revision') or 'unknown'}; this one is "
            f"{current or 'unknown'}). Export again from a matching version.",
            409,
        )
    plans = _plan(raw_tables, tables, mode)

    try:
        results = await _write(db, plans, mode, actor)
    except (IntegrityError, DBAPIError) as exc:
        await db.rollback()
        log.warning("data_import_refused", mode=mode, error=str(getattr(exc, "orig", exc))[:300])
        raise DataTransferError(_db_error_message(exc), 409) from None

    names = [p.table.name for p in plans]
    if dry_run:
        await db.rollback()
        return ImportResult(mode=mode, dry_run=True, tables=results)

    await audit_service.record(
        db, AuditAction.DATA_IMPORTED,
        actor=actor,
        target=AuditTarget(type="database", label=f"{len(names)} table(s), {mode}"),
        details={
            "mode": mode,
            "tables": names,
            "all_tables": set(names) >= {t.name for t in _tables()} - IMPORT_FORBIDDEN,
            "counts": {
                r.name: {
                    "inserted": r.inserted, "updated": r.updated,
                    "deleted": r.deleted, "skipped": r.skipped,
                }
                for r in results
            },
        },
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    await db.commit()
    await invalidate_caches()
    log.info("data_imported", mode=mode, tables=names, by=str(actor.id))
    return ImportResult(mode=mode, dry_run=False, tables=results)


async def record_export(
    db: AsyncSession, names: list[str], *, all_tables: bool, actor: User, ctx: AuditContext
) -> None:
    """Fail-closed audit row for an export: committed before the file goes out."""
    await audit_service.record(
        db, AuditAction.DATA_EXPORTED,
        actor=actor,
        target=AuditTarget(type="database", label=f"{len(names)} table(s)"),
        details={"tables": names, "all_tables": all_tables},
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    await db.commit()
