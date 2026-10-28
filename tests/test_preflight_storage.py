"""R1.3: the storage/archive config surface (plan §A.2.1/§A.2.2/§A.2.4) and
app/scripts/preflight.py's storage/archive network-probe *logic* (§A.2.5).

Network-probe tests exercise `_r2_probe`/`_archive_probe` against a
`botocore.stub.Stubber`-wrapped client built directly from an
`ObjectStoreConfig` (same idiom as test_storage_seam.py/test_archive_store.py)
— never a real R2/AWS network call. Real network behaviour of these probes
(which HeadBucket/list_objects_v2 fallback the real R2 token needs, whether
GetObjectLockConfiguration actually reports GOVERNANCE) is gate-time manual:
R2.2 and R2.4, not this file (R0.2 §1, items 12/13).

Settings-refusal tests cover every §A.2.4 production-preflight bullet not
already owned by test_production_hardening.py, plus the new all-environment
validators from §A.2.2 (legacy S3_* var, ARCHIVE_DELETE_SOURCE requiring both
stores live, the archive storage-class enum).
"""
import pytest
from botocore.stub import Stubber

from tests.test_production_hardening import LIVE_ENV
from tests.test_storage_seam import _cfg

# `asyncio_mode = "auto"` (pyproject.toml) picks up the async tests below
# without an explicit pytestmark — this file also has plain sync tests
# (the Settings-refusal matrix), so a module-level `pytestmark =
# pytest.mark.asyncio` would incorrectly tag those too.


# ═══════════════════════════════════════════════════════════════════════════
# §A.2.5 — network-probe logic (mocked boto3 client, not live network)
# ═══════════════════════════════════════════════════════════════════════════
def _archive_cfg(**overrides):
    base = dict(endpoint_url=None, region="us-east-1", addressing_style="auto", checksum_mode=None)
    base.update(overrides)
    return _cfg(**base)


async def test_r2_probe_uses_head_bucket_when_allowed():
    from app.core.storage import _make_client
    from app.scripts.preflight import _r2_probe

    client = _make_client(_cfg())
    with Stubber(client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": "sermon-media-dev"})
        result = await _r2_probe(client, "sermon-media-dev")
    assert result == "head_bucket"


async def test_r2_probe_falls_back_to_list_objects_on_403():
    """An object-scoped R2 token can refuse HeadBucket with 403 even though
    it can legitimately list/read objects — the code must fall back rather
    than treat that as a hard failure (plan §A.2.5)."""
    from app.core.storage import _make_client
    from app.scripts.preflight import _r2_probe

    client = _make_client(_cfg())
    with Stubber(client) as stub:
        stub.add_client_error(
            "head_bucket", service_error_code="AccessDenied", http_status_code=403,
        )
        stub.add_response(
            "list_objects_v2", {"Name": "sermon-media-dev"},
            {"Bucket": "sermon-media-dev", "MaxKeys": 1},
        )
        result = await _r2_probe(client, "sermon-media-dev")
    assert "list_objects_v2" in result


async def test_r2_probe_never_falls_back_when_head_bucket_succeeds():
    """Positive control for the fallback test above — list_objects_v2 must
    NOT be called when head_bucket already succeeds (a Stubber queue with an
    un-consumed response left in it fails on __exit__, so this doubles as
    the assertion)."""
    from app.core.storage import _make_client
    from app.scripts.preflight import _r2_probe

    client = _make_client(_cfg())
    with Stubber(client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": "sermon-media-dev"})
        result = await _r2_probe(client, "sermon-media-dev")
    assert result == "head_bucket"


async def test_r2_probe_reraises_non_403_errors():
    from botocore.exceptions import ClientError

    from app.core.storage import _make_client
    from app.scripts.preflight import _r2_probe

    client = _make_client(_cfg())
    with Stubber(client) as stub:
        stub.add_client_error(
            "head_bucket", service_error_code="InternalError", http_status_code=500,
        )
        with pytest.raises(ClientError):
            await _r2_probe(client, "sermon-media-dev")


async def test_archive_probe_all_stages_ok():
    from app.core.storage import _make_client
    from app.scripts.preflight import _archive_probe

    client = _make_client(_archive_cfg())
    with Stubber(client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": "sermon-archive-dev"})
        stub.add_response(
            "get_bucket_versioning", {"Status": "Enabled"}, {"Bucket": "sermon-archive-dev"},
        )
        stub.add_response(
            "get_bucket_lifecycle_configuration",
            {"Rules": [{
                "ID": "abort-mpu",
                "Status": "Enabled",
                "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
            }]},
            {"Bucket": "sermon-archive-dev"},
        )
        stub.add_response(
            "get_object_lock_configuration",
            {"ObjectLockConfiguration": {
                "ObjectLockEnabled": "Enabled",
                "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": 180}},
            }},
            {"Bucket": "sermon-archive-dev"},
        )
        result = await _archive_probe(client, "sermon-archive-dev")
    assert "ok" in result


async def test_archive_probe_short_circuits_on_versioning_not_enabled():
    """Each stage only runs once the previous one has passed — versioning
    disabled must stop before lifecycle/object-lock are ever checked (a
    Stubber queue with un-consumed responses fails on __exit__, proving
    those calls never happened)."""
    from app.core.storage import _make_client
    from app.scripts.preflight import _archive_probe

    client = _make_client(_archive_cfg())
    with Stubber(client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": "sermon-archive-dev"})
        stub.add_response(
            "get_bucket_versioning", {"Status": "Suspended"}, {"Bucket": "sermon-archive-dev"},
        )
        with pytest.raises(RuntimeError, match="Suspended"):
            await _archive_probe(client, "sermon-archive-dev")


async def test_archive_probe_fails_on_missing_abort_mpu_rule():
    from app.core.storage import _make_client
    from app.scripts.preflight import _archive_probe

    client = _make_client(_archive_cfg())
    with Stubber(client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": "sermon-archive-dev"})
        stub.add_response(
            "get_bucket_versioning", {"Status": "Enabled"}, {"Bucket": "sermon-archive-dev"},
        )
        stub.add_response(
            "get_bucket_lifecycle_configuration",
            {"Rules": [{"ID": "expire-old", "Status": "Enabled"}]},
            {"Bucket": "sermon-archive-dev"},
        )
        with pytest.raises(RuntimeError, match="abort-incomplete-multipart-upload"):
            await _archive_probe(client, "sermon-archive-dev")


async def test_archive_probe_fails_when_object_lock_mode_is_not_governance():
    from app.core.storage import _make_client
    from app.scripts.preflight import _archive_probe

    client = _make_client(_archive_cfg())
    with Stubber(client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": "sermon-archive-dev"})
        stub.add_response(
            "get_bucket_versioning", {"Status": "Enabled"}, {"Bucket": "sermon-archive-dev"},
        )
        stub.add_response(
            "get_bucket_lifecycle_configuration",
            {"Rules": [{
                "ID": "abort-mpu", "Status": "Enabled",
                "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
            }]},
            {"Bucket": "sermon-archive-dev"},
        )
        stub.add_response(
            "get_object_lock_configuration",
            {"ObjectLockConfiguration": {
                "ObjectLockEnabled": "Enabled",
                "Rule": {"DefaultRetention": {"Mode": "COMPLIANCE", "Days": 180}},
            }},
            {"Bucket": "sermon-archive-dev"},
        )
        with pytest.raises(RuntimeError, match="GOVERNANCE"):
            await _archive_probe(client, "sermon-archive-dev")


# ── _check_storage / _check_archive: singleton wiring, stub vs. live ─────────
async def test_check_storage_ok_on_stub_in_development():
    from app.scripts.preflight import _check_storage

    assert await _check_storage() == "local stub (development)"


async def test_check_archive_ok_on_stub_in_development():
    from app.scripts.preflight import _check_archive

    assert await _check_archive() == "local stub (development)"


async def test_check_storage_probes_the_real_client_when_live(monkeypatch):
    from app.core import storage as storage_module
    from app.core.config import get_settings
    from app.scripts.preflight import _check_storage

    monkeypatch.setattr(get_settings(), "object_store_access_key_id", "AKIA_X")
    monkeypatch.setattr(get_settings(), "object_store_secret_access_key", "secret")
    monkeypatch.setattr(
        get_settings(), "object_store_endpoint_url", "https://acct.r2.cloudflarestorage.com"
    )
    storage_module.set_storage(None)
    try:
        backend = storage_module.get_storage()
        with Stubber(backend._client) as stub:
            stub.add_response("head_bucket", {}, {"Bucket": get_settings().object_store_media_bucket})
            result = await _check_storage()
        assert "head_bucket" in result
    finally:
        storage_module.set_storage(storage_module.LocalStorage())


async def test_check_archive_probes_the_real_client_when_live(monkeypatch):
    from app.core import storage as storage_module
    from app.core.config import get_settings
    from app.scripts.preflight import _check_archive

    monkeypatch.setattr(get_settings(), "archive_store_access_key_id", "AKIAARCHIVE_X")
    monkeypatch.setattr(get_settings(), "archive_store_secret_access_key", "archive-secret")
    monkeypatch.setattr(get_settings(), "archive_store_region", "us-east-1")
    monkeypatch.setattr(get_settings(), "archive_store_bucket", "sermon-archive-dev")
    storage_module.set_archive_store(None)
    try:
        backend = storage_module.get_archive_store()
        with Stubber(backend._client) as stub:
            stub.add_response("head_bucket", {}, {"Bucket": "sermon-archive-dev"})
            stub.add_response(
                "get_bucket_versioning", {"Status": "Enabled"}, {"Bucket": "sermon-archive-dev"},
            )
            stub.add_response(
                "get_bucket_lifecycle_configuration",
                {"Rules": [{
                    "ID": "abort-mpu", "Status": "Enabled",
                    "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
                }]},
                {"Bucket": "sermon-archive-dev"},
            )
            stub.add_response(
                "get_object_lock_configuration",
                {"ObjectLockConfiguration": {
                    "ObjectLockEnabled": "Enabled",
                    "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": 180}},
                }},
                {"Bucket": "sermon-archive-dev"},
            )
            result = await _check_archive()
        assert "sermon-archive-dev" in result
    finally:
        storage_module.set_archive_store(storage_module.LocalArchiveStore())


# ═══════════════════════════════════════════════════════════════════════════
# §A.2.4 — production-preflight refusal matrix (Settings construction)
# ═══════════════════════════════════════════════════════════════════════════
def _settings(**overrides):
    from app.core.config import Settings

    return Settings(**{**LIVE_ENV, **overrides})


def test_preflight_refuses_stub_archive_store():
    """A live R2 store with a still-stub archive store must refuse on its
    own — independent of the live-store check (plan §A.2.4)."""
    with pytest.raises(ValueError, match="ARCHIVE_STORE_ACCESS_KEY_ID"):
        _settings(archive_store_access_key_id=None, archive_store_secret_access_key=None)


def test_preflight_refuses_missing_endpoint_when_storage_live():
    with pytest.raises(ValueError, match="OBJECT_STORE_ENDPOINT_URL"):
        _settings(object_store_endpoint_url=None)


def test_preflight_refuses_non_r2_host():
    with pytest.raises(ValueError, match=r"r2\.cloudflarestorage\.com"):
        _settings(object_store_endpoint_url="https://sermon-media.s3.amazonaws.com")


def test_preflight_refuses_missing_archive_bucket_when_archive_live():
    with pytest.raises(ValueError, match="ARCHIVE_STORE_BUCKET"):
        _settings(archive_store_bucket=None)


@pytest.mark.parametrize("field", ["object_store_raw_bucket", "object_store_media_bucket", "archive_store_bucket"])
@pytest.mark.parametrize("marker", ["-dev", "-staging"])
def test_preflight_refuses_dev_staging_bucket_name(field, marker):
    with pytest.raises(ValueError, match="dev/staging bucket name"):
        _settings(**{field: f"sermon-something{marker}"})


def test_preflight_refuses_raw_equals_media_bucket():
    with pytest.raises(ValueError, match="must not be the same bucket"):
        _settings(object_store_media_bucket=LIVE_ENV["object_store_raw_bucket"])


def test_preflight_refuses_non_deep_archive_storage_class():
    with pytest.raises(ValueError, match="ARCHIVE_STORE_STORAGE_CLASS must be DEEP_ARCHIVE"):
        _settings(archive_store_storage_class="GLACIER")


def test_preflight_all_refusals_are_independent():
    """Positive control: the fully-valid LIVE_ENV fixture must pass cleanly.
    Without this, a bug that makes preflight always refuse would pass every
    negative test above by accident."""
    s = _settings()
    assert s.is_production
    assert s.storage_is_live and s.archive_is_live


# ═══════════════════════════════════════════════════════════════════════════
# §A.2.1/§A.2.2 — new field enum + all-environment validators
# ═══════════════════════════════════════════════════════════════════════════
def _dev_settings(**overrides):
    from app.core.config import Settings

    base = {
        "secret_key": "a-sufficiently-long-secret-key-for-tests",
        "database_url": "postgresql+psycopg://u:p@db/app",
        "redis_url": "redis://r:6379/0",
        "environment": "development",
    }
    return Settings(**{**base, **overrides})


def test_archive_storage_class_rejects_unknown_value():
    with pytest.raises(ValueError, match="ARCHIVE_STORE_STORAGE_CLASS"):
        _dev_settings(archive_store_storage_class="REDUCED_REDUNDANCY")


def test_archive_storage_class_allows_glacier_outside_production():
    """GLACIER is a legal enum value (§A.2.1); production alone refuses it
    (covered above) — dev/staging may use it."""
    s = _dev_settings(archive_store_storage_class="GLACIER")
    assert s.archive_store_storage_class == "GLACIER"


@pytest.mark.parametrize("environment", ["development", "production"])
def test_legacy_s3_env_var_rejected_in_every_environment(monkeypatch, environment):
    """A.2.2: this must fire regardless of ENVIRONMENT, not just prod."""
    monkeypatch.setenv("S3_ENDPOINT_URL", "https://old.example.com")
    try:
        if environment == "production":
            with pytest.raises(ValueError, match="S3_ENDPOINT_URL"):
                _settings(environment="production")
        else:
            with pytest.raises(ValueError, match="S3_ENDPOINT_URL"):
                _dev_settings()
    finally:
        monkeypatch.delenv("S3_ENDPOINT_URL", raising=False)


def test_archive_delete_source_refused_with_both_stores_stub():
    with pytest.raises(ValueError, match="ARCHIVE_DELETE_SOURCE"):
        _dev_settings(archive_delete_source=True)


def test_archive_delete_source_refused_with_only_live_store():
    with pytest.raises(ValueError, match="ARCHIVE_DELETE_SOURCE"):
        _dev_settings(
            archive_delete_source=True,
            object_store_access_key_id="AKIA_X",
            object_store_secret_access_key="secret",
        )


def test_archive_delete_source_allowed_with_both_stores_live():
    s = _dev_settings(
        archive_delete_source=True,
        object_store_access_key_id="AKIA_X",
        object_store_secret_access_key="secret",
        archive_store_access_key_id="AKIAARCHIVE_X",
        archive_store_secret_access_key="archive-secret",
        archive_store_region="us-east-1",
    )
    assert s.archive_delete_source is True


def test_archive_source_retention_days_rejects_zero():
    with pytest.raises(ValueError):
        _dev_settings(archive_source_retention_days=0)


def test_archive_source_retention_days_default_is_14():
    s = _dev_settings()
    assert s.archive_source_retention_days == 14


@pytest.mark.parametrize(
    "raw",
    ["postgres://u:p@db:5432/app", "postgresql://u:p@db:5432/app"],
)
def test_bare_postgres_url_gets_psycopg_driver(raw):
    s = _dev_settings(database_url=raw, database_replica_url=raw)
    assert s.database_url == "postgresql+psycopg://u:p@db:5432/app"
    assert s.database_replica_url == "postgresql+psycopg://u:p@db:5432/app"


def test_explicit_driver_url_is_left_alone():
    s = _dev_settings(database_url="postgresql+psycopg://u:p@db/app")
    assert s.database_url == "postgresql+psycopg://u:p@db/app"
    assert _dev_settings().database_replica_url is None
