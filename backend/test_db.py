"""Test script to verify connection to Supabase / PostgreSQL database."""
import sys
from pathlib import Path

# Ensure app package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.database import engine
from app.config import settings
from sqlalchemy import text

print(f"Testing connection with DATABASE_URL:\n{settings.DATABASE_URL.split('@')[-1] if '@' in settings.DATABASE_URL else settings.DATABASE_URL}")

try:
    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1;"))
        print("✅ Connection successful!")
except Exception as e:
    print(f"❌ Failed to connect: {e}")
