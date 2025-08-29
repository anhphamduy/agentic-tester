from __future__ import annotations

from typing import Optional

from .base import BlobStorage


class SupabaseBlobStorage(BlobStorage):
    """Supabase Storage-backed blob storage for text files.

    Uses `supabase_client.storage.from_(bucket).download(path)` to retrieve bytes,
    then decodes as UTF-8 with replacement.
    """

    def __init__(self, *, client, bucket: str, folder: Optional[str] = None) -> None:
        self.client = client
        self.bucket = bucket
        # Optional folder/prefix inside the bucket
        self.folder = (folder.strip("/\n") if folder else None)

    def _resolve_path(self, blob_name: str) -> str:
        name = blob_name.split("/")[-1]
        if name.lower().endswith(".pdf"):
            name = name[:-4] + ".txt"
        if not name.lower().endswith(".txt"):
            raise ValueError("Only .txt is supported in this demo.")
        if self.folder:
            return f"{self.folder}/{name}"
        return name

    def read_text(self, blob_name: str, *, max_chars: int | None = None) -> str:
        path = self._resolve_path(blob_name)
        try:
            data: bytes = (
                self.client.storage.from_(self.bucket).download(path)  # type: ignore[attr-defined]
            )
        except Exception as e:  # noqa: BLE001 - surface as FileNotFoundError
            raise FileNotFoundError(f"Blob not found in Supabase: {path}") from e

        text = data.decode("utf-8", errors="replace")
        if max_chars is not None and len(text) > max_chars:
            return text[:max_chars] + "\n\n[...truncated...]"
        return text


