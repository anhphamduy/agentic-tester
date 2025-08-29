from pathlib import Path
from pydantic_settings import BaseSettings
from supabase import create_client
from app.blob_storage.base import BlobStorage
from app.blob_storage.local import LocalBlobStorage
from app.blob_storage.supabase import SupabaseBlobStorage
from app.results_writer import (
    ResultsWriter,
    SupabaseResultsWriter,
    NoopResultsWriter,
)


class Settings(BaseSettings):
    openai_api_key: str
    openai_model: str
    supabase_url: str | None = None
    supabase_key: str | None = None
    supabase_url: str
    supabase_key: str
    # Optional: configure Supabase Storage bucket and optional folder prefix
    supabase_bucket: str = "test"
    supabase_folder: str = "upload"


global_settings = Settings(_env_file=".env")

supabase_client = create_client(
    global_settings.supabase_url, global_settings.supabase_key
)

# Initialize blob storage provider here and import from other modules
_LOCAL_BLOB_ROOT = Path(__file__).parent / "blob_storage"
if global_settings.supabase_bucket:
    blob_storage: BlobStorage = SupabaseBlobStorage(
        client=supabase_client,
        bucket=global_settings.supabase_bucket,
        folder=global_settings.supabase_folder,
    )
else:
    blob_storage = LocalBlobStorage(_LOCAL_BLOB_ROOT)

# Initialize results writer
try:
    results_writer: ResultsWriter = SupabaseResultsWriter(client=supabase_client)
except Exception:
    results_writer = NoopResultsWriter()
