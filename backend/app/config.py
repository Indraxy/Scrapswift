"""Application configuration.

DATABASE_URL is optional: when it is empty the app falls back to a local
SQLite file so the prototype runs with zero database setup. All models are
written to be PostgreSQL compatible, so pointing DATABASE_URL at Postgres
is the only change needed for a real deployment.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()


import urllib.parse


def _get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url or not url.strip():
        # Check if individual Supabase connection parameters are set
        user = os.environ.get("user") or os.environ.get("DB_USER")
        password = os.environ.get("password") or os.environ.get("DB_PASSWORD")
        host = os.environ.get("host") or os.environ.get("DB_HOST")
        port = os.environ.get("port") or os.environ.get("DB_PORT", "5432")
        dbname = os.environ.get("dbname") or os.environ.get("DB_NAME", "postgres")

        if host and user and password:
            encoded_password = urllib.parse.quote_plus(password)
            return f"postgresql+psycopg2://{user}:{encoded_password}@{host}:{port}/{dbname}?sslmode=require"
        return f"sqlite:///{BASE_DIR / 'kabadiwala.db'}"

    url = url.strip().strip("'").strip('"')
    if not url:
        return f"sqlite:///{BASE_DIR / 'kabadiwala.db'}"
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    elif url.startswith("postgres+psycopg2://"):
        url = url.replace("postgres+psycopg2://", "postgresql+psycopg2://", 1)
    return url



class Settings:
    APP_NAME = "Kabadiwala Connect API"
    VERSION = "1.0.0"
    DATABASE_URL = _get_database_url()
    SECRET_KEY = os.environ.get("SECRET_KEY", "kabadiwala-connect-prototype-secret")
    CORS_ORIGINS = [
        o.strip()
        for o in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if o.strip()
    ]
    TOKEN_TTL_SECONDS = 60 * 60 * 12
    UPLOAD_DIR = BASE_DIR / "uploads"
    GEMINI_API_KEY = os.environ.get(
        "GEMINI_API_KEY", ""
    )



settings = Settings()
settings.UPLOAD_DIR.mkdir(exist_ok=True)
