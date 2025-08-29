from __future__ import annotations

from pathlib import Path

from .base import BlobStorage


class LocalBlobStorage(BlobStorage):
    """Local filesystem-backed blob storage for .txt files."""

    def __init__(self, root_dir: Path) -> None:
        self.root_dir = Path(root_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def read_text(self, blob_name: str, *, max_chars: int | None = None) -> str:
        name = Path(blob_name).name
        if name.lower().endswith(".pdf"):
            name = Path(name).with_suffix(".txt").name
        if not name.lower().endswith(".txt"):
            raise ValueError("Only .txt is supported in this demo.")
        path = self.root_dir / name
        if not path.exists():
            raise FileNotFoundError(
                f"Blob not found: {name}. Put it in {self.root_dir}"
            )
        text = path.read_text(encoding="utf-8", errors="replace")
        if max_chars is not None and len(text) > max_chars:
            return text[:max_chars] + "\n\n[...truncated...]"
        return text


