from pathlib import Path
import os

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import default_database_path, load_backend_environment
from app.main import migrate_additive_schema


def test_production_database_path_is_user_scoped(tmp_path: Path) -> None:
    path = default_database_path("production", str(tmp_path / "LocalAppData"), tmp_path / "backend")
    assert path == str(tmp_path / "LocalAppData" / "Moonie" / "moonie.db")


def test_backend_environment_loader_uses_packaged_user_config_without_printing_values(tmp_path: Path, monkeypatch) -> None:
    local_app_data = tmp_path / "LocalAppData"
    env_path = local_app_data / "Moonie" / ".env"
    env_path.parent.mkdir(parents=True)
    env_path.write_text("MOONIE_LLM_PROVIDER=openai_compatible\nMOONIE_LLM_API_KEY=test-only-secret\n", encoding="utf-8")
    monkeypatch.delenv("MOONIE_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("MOONIE_LLM_API_KEY", raising=False)

    loaded = load_backend_environment("production", str(local_app_data), tmp_path / "backend")

    assert loaded == env_path
    assert os.environ["MOONIE_LLM_PROVIDER"] == "openai_compatible"
    assert os.environ["MOONIE_LLM_API_KEY"] == "test-only-secret"


@pytest.mark.asyncio
async def test_additive_migration_is_repeatable(tmp_path: Path) -> None:
    database_path = tmp_path / "migration.db"
    database_engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
    try:
        async with database_engine.begin() as connection:
            await connection.execute(text("CREATE TABLE recurring_rules (id VARCHAR(36) PRIMARY KEY)"))

        await migrate_additive_schema(database_engine)
        await migrate_additive_schema(database_engine)

        async with database_engine.connect() as connection:
            columns = await connection.run_sync(
                lambda sync_connection: {column["name"] for column in inspect(sync_connection).get_columns("recurring_rules")}
            )
        assert "enabled" in columns
    finally:
        await database_engine.dispose()
