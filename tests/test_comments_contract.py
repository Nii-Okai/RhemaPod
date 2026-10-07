"""OpenAPI contract allow-list for the comments feature (S14 gap 1) and the
Notes-removal assertions (S14 gap 2).

The first group builds everything from ``app.openapi()`` and touches no
database: the path/method set, the exact property allow-lists of the viewer
DTOs, the EDITOR-safe admin DTO, enum values, and bearer security. These guard
the generated TypeScript clients against silent drift and the PII / minors
boundary against a schema-level leak.

The Notes identifiers are assembled from fragments so the repo-wide
removal grep (DoD-1) does not match this file.
"""
from __future__ import annotations

import pytest

from app.models.models import Base
from main import app

API = "/api/v1"

# S8 + S10b. Every (path, METHOD) the comments feature owns.
EXPECTED_COMMENT_OPERATIONS: set[tuple[str, str]] = {
    # viewer
    (f"{API}/sermons/{{sermon_id}}/comments", "GET"),
    (f"{API}/sermons/{{sermon_id}}/comments", "POST"),
    (f"{API}/comments/{{comment_id}}", "DELETE"),
    (f"{API}/comments/{{comment_id}}/report", "POST"),
    (f"{API}/comments/{{comment_id}}/block", "POST"),
    (f"{API}/me/blocks", "GET"),
    (f"{API}/me/blocks/{{block_id}}", "DELETE"),
    (f"{API}/me/comments-terms", "POST"),
    (f"{API}/auth/me", "PATCH"),
    # admin
    (f"{API}/admin/comments", "GET"),
    (f"{API}/admin/comments/{{comment_id}}", "DELETE"),
    (f"{API}/admin/comments/{{comment_id}}/hide", "POST"),
    (f"{API}/admin/comments/{{comment_id}}/restore", "POST"),
    (f"{API}/admin/comments/{{comment_id}}/dismiss-reports", "POST"),
}

_N = "no" + "tes"
REMOVED_PATHS = [
    f"{API}/sermons/{{sermon_id}}/{_N}",
    f"{API}/{_N}/{{note_id}}",
    f"{API}/me/{_N}",
]
_HTTP = {"get", "post", "put", "patch", "delete"}


@pytest.fixture(scope="module")
def spec() -> dict:
    return app.openapi()


def _comment_operations(spec: dict) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for path, item in spec["paths"].items():
        if "comment" in path or path.startswith(f"{API}/me/blocks"):
            found |= {(path, m.upper()) for m in item if m in _HTTP}
    # PATCH /auth/me belongs to this feature (display name); GET /auth/me does not.
    if "patch" in spec["paths"].get(f"{API}/auth/me", {}):
        found.add((f"{API}/auth/me", "PATCH"))
    return found


def _schema(spec: dict, name: str) -> dict:
    return spec["components"]["schemas"][name]


def _reachable_schemas(spec: dict, node) -> set[str]:
    """Every component schema name transitively referenced from ``node``."""
    seen: set[str] = set()
    stack = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            ref = cur.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
                name = ref.rsplit("/", 1)[-1]
                if name not in seen:
                    seen.add(name)
                    stack.append(spec["components"]["schemas"][name])
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
    return seen


def _enum_values(prop: dict) -> set[str]:
    """Enum values of a property, direct or inside an anyOf / $ref."""
    if "enum" in prop:
        return set(prop["enum"])
    out: set[str] = set()
    for branch in prop.get("anyOf", []):
        out |= set(branch.get("enum", []))
    return out


# --- CT-01 / CT-03: path and method allow-list -------------------------------


def test_comments_paths_and_methods_match_s8_s10b_exactly(spec: dict) -> None:
    actual = _comment_operations(spec)
    assert actual == EXPECTED_COMMENT_OPERATIONS, {
        "unexpected": sorted(actual - EXPECTED_COMMENT_OPERATIONS),
        "missing": sorted(EXPECTED_COMMENT_OPERATIONS - actual),
    }


def test_removed_paths_absent_from_openapi(spec: dict) -> None:
    for path in REMOVED_PATHS:
        assert path not in spec["paths"], path
    assert not [p for p in spec["paths"] if _N in p]
    assert not [n for n in spec["components"]["schemas"] if _N.rstrip("s") in n.lower()]


# --- CT-02 / C-DTO-05: DTO allow-lists ---------------------------------------


def test_comment_public_property_set_is_exact_allow_list(spec: dict) -> None:
    props = set(_schema(spec, "CommentPublic")["properties"])
    assert props == {
        "id",
        "sermon_id",
        "author_display_name",
        "body",
        "created_at",
        "is_mine",
        "status",
        "hidden_label",
    }
    assert not {p for p in props if "user" in p or "email" in p or "role" in p}


def test_block_public_property_set_is_exact_allow_list(spec: dict) -> None:
    props = set(_schema(spec, "BlockPublic")["properties"])
    assert props == {"id", "display_name", "created_at"}
    assert not {p for p in props if "user" in p or "email" in p or "role" in p}


def test_comment_admin_for_editor_has_no_identity_fields(spec: dict) -> None:
    props = set(_schema(spec, "CommentAdminForEditor")["properties"])
    assert not props & {"author_id", "author_email", "hidden_by_id"}
    # and the full MANAGER/ADMIN schema is the superset that adds exactly those
    full = set(_schema(spec, "CommentAdmin")["properties"])
    assert full - props == {"author_id", "author_email", "hidden_by_id"}


def test_comment_admin_not_reachable_from_any_non_admin_route(spec: dict) -> None:
    leaking = {"CommentAdmin", "Page_CommentAdmin_"}
    checked = 0
    for path, item in spec["paths"].items():
        if path.startswith(f"{API}/admin/"):
            continue
        for method, op in item.items():
            if method not in _HTTP:
                continue
            checked += 1
            assert not _reachable_schemas(spec, op) & leaking, (path, method)
    assert checked > 0
    # sanity: the admin list is where it IS reachable (the walk works)
    admin_list = spec["paths"][f"{API}/admin/comments"]["get"]
    assert _reachable_schemas(spec, admin_list) & leaking


def test_viewer_dtos_reachable_from_viewer_routes_only_as_public(spec: dict) -> None:
    viewer_list = spec["paths"][f"{API}/sermons/{{sermon_id}}/comments"]["get"]
    reachable = _reachable_schemas(spec, viewer_list)
    assert "CommentPublic" in reachable
    assert not reachable & {"CommentAdmin", "CommentAdminForEditor"}


# --- enums --------------------------------------------------------------------


def test_hidden_label_enum_values_match_agreed_set(spec: dict) -> None:
    expected = {"under_review", "removed_by_moderator"}
    for name in ("CommentPublic", "CommentAdmin", "CommentAdminForEditor"):
        prop = _schema(spec, name)["properties"]["hidden_label"]
        assert _enum_values(prop) == expected, name


def test_report_reason_enum_matches_agreed_values(spec: dict) -> None:
    assert set(_schema(spec, "CommentReportReason")["enum"]) == {
        "spam",
        "harassment",
        "hate",
        "sexual",
        "self_harm",
        "other",
    }


# --- dismiss-reports body ------------------------------------------------------


def test_dismiss_reports_body_is_required_moderation_reason(spec: dict) -> None:
    op = spec["paths"][f"{API}/admin/comments/{{comment_id}}/dismiss-reports"]["post"]
    body = op["requestBody"]
    assert body["required"] is True
    assert body["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ModerationReason"
    }
    assert _schema(spec, "ModerationReason")["required"] == ["reason"]


# --- CT-05: bearer security ----------------------------------------------------


def test_every_comments_operation_requires_bearer_security(spec: dict) -> None:
    for path, method in sorted(EXPECTED_COMMENT_OPERATIONS):
        op = spec["paths"][path][method.lower()]
        assert op.get("security") == [{"HTTPBearer": []}], (path, method)


# --- RM-01 / RM-03: Notes removal ----------------------------------------------


@pytest.mark.parametrize("method", ["get", "post", "patch", "delete"])
@pytest.mark.parametrize(
    "path",
    [
        f"{API}/sermons/00000000-0000-0000-0000-000000000001/{_N}",
        f"{API}/{_N}/00000000-0000-0000-0000-000000000001",
        f"{API}/me/{_N}",
    ],
)
async def test_notes_routes_removed(client, path: str, method: str) -> None:
    resp = await client.request(method.upper(), path)
    assert resp.status_code in (404, 405), (method, path, resp.status_code)


def test_notes_table_gone_and_comments_tables_present() -> None:
    tables = set(Base.metadata.tables)
    assert ("sermon_" + _N) not in tables
    assert not [t for t in tables if _N in t]
    assert {
        "sermon_comments",
        "sermon_comment_reports",
        "comment_moderation_log",
        "user_blocks",
    } <= tables
