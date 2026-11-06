from pathlib import Path
import os
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent

def load_backend_environment(environment: str, local_app_data: str | None, base_dir: Path) -> Path | None:
    explicit = os.getenv("MOONIE_ENV_FILE")
    if explicit:
        env_path = Path(explicit)
    elif environment.lower() in {"production", "packaged"} and local_app_data:
        env_path = Path(local_app_data) / "Moonie" / ".env"
    else:
        env_path = base_dir / ".env"
    if env_path.is_file():
        load_dotenv(env_path, override=False)
        return env_path
    return None

load_backend_environment(os.getenv("ENVIRONMENT", "development"), os.getenv("LOCALAPPDATA"), BASE_DIR)

def default_database_path(environment: str, local_app_data: str | None, base_dir: Path) -> str:
    if environment.lower() in {"production", "packaged"}:
        root = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
        return str(root / "Moonie" / "moonie.db")
    return str(base_dir / "moonie.db")

class Settings:
    PROJECT_NAME = "Moonie Task Engine"
    API_V1_PREFIX = "/api/v1"

    def __init__(self) -> None:
        self.BASE_DIR = BASE_DIR
        self.ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
        self.DATABASE_PATH = os.getenv("DATABASE_PATH") or default_database_path(
            self.ENVIRONMENT,
            os.getenv("LOCALAPPDATA"),
            self.BASE_DIR,
        )
        Path(self.DATABASE_PATH).expanduser().parent.mkdir(parents=True, exist_ok=True)
    
    @property
    def DATABASE_URL(self) -> str:
        # sqlite+aiosqlite requires forward slashes on Windows
        clean_path = Path(self.DATABASE_PATH).expanduser().as_posix()
        return f"sqlite+aiosqlite:///{clean_path}"

settings = Settings()
