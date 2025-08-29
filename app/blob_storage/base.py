from __future__ import annotations

from abc import ABC, abstractmethod


class BlobStorage(ABC):
    """Abstract blob storage interface for reading text files.

    Subclasses must implement `read_text` and raise FileNotFoundError
    if the blob cannot be found.
    """

    @abstractmethod
    def read_text(self, blob_name: str, *, max_chars: int | None = None) -> str:
        """Read text content from `blob_name`.

        Args:
            blob_name: The name or path of the blob within the storage backend.
            max_chars: If provided, truncate the returned text to this many characters.

        Returns:
            The text content.

        Raises:
            FileNotFoundError: If the blob does not exist.
            ValueError: If the blob exists but is not readable as UTF-8 text.
        """
        raise NotImplementedError


