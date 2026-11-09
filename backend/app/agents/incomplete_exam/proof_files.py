"""Proof documents for Agent 5, read from the private bucket as the signed-in
staff member.

Replaces the standalone tools/proof_file_tools.py and services/storage.py. Only
source: the paths saved in Incomplete_Exam.Proof_Files (read by request_data),
downloaded through app.core.storage with the staff member's own session. No
anon or service_role key, no RPC, no upload, no local folder, no URL fetch.

Kept from the standalone: allowed types PDF/PNG/JPEG/WEBP, 10 MB per file,
an unsupported type is skipped (not sent), the result is a list of
{"filename", "mime_type", "data"} in the stored order.

Added: each path must be exactly <Request_ID>/<file>; the content signature
must match the extension (otherwise skipped); 18 MB in total; duplicates sent
once. A missing file, a foreign path or a total above the limit raises a data
error, and Storage problems raise app.core.storage errors (technical) -- never
silently treated as "no file attached". `records` describes every path for the
run history (path, outcome, type, size, SHA-256; never the bytes).
"""

import hashlib
import logging
from dataclasses import dataclass, field

from app.core import storage

from .exceptions import ProofFileMissingError, ProofPathError, ProofTooLargeError

log = logging.getLogger(__name__)

BUCKET = "incomplete-exam-proofs"
MAX_FILE_BYTES = 10 * 1024 * 1024    # 10 MB, as in the standalone agent
MAX_TOTAL_BYTES = 18 * 1024 * 1024   # below Gemini's ~20 MB inline request limit

_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


@dataclass(frozen=True)
class ProofLoad:
    files: list[dict] = field(repr=False)   # {"filename", "mime_type", "data"}, sent to Gemini
    records: list[dict]                     # per path, stored with the run


def expected_mime_type(filename: str) -> str | None:
    dot = filename.rfind(".")
    return _EXTENSIONS.get(filename[dot:].lower()) if dot > 0 else None


def sniff_mime_type(data: bytes) -> str | None:
    """The document type from its first bytes, or None."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def filename_for(request_id: str, path) -> str:
    """The file name of a valid path <request_id>/<file>; ProofPathError otherwise."""
    prefix = f"{request_id}/"
    if not isinstance(path, str) or not path.startswith(prefix):
        raise ProofPathError("A saved proof path is not inside this request's folder.")
    name = path[len(prefix):]
    if (not name or "/" in name or "\\" in name or name in (".", "..")
            or any(ord(ch) < 32 or ord(ch) == 127 for ch in name)):
        raise ProofPathError("A saved proof path is not a plain file name inside this request's folder.")
    return name


def load_proof_files(request_id: str, paths: list[str], access_token: str) -> ProofLoad:
    unique: list[str] = list(dict.fromkeys(paths or []))
    names = [filename_for(request_id, path) for path in unique]   # all paths checked before any download

    files: list[dict] = []
    records: list[dict] = []
    total = 0
    for index, (path, name) in enumerate(zip(unique, names), start=1):
        mime = expected_mime_type(name)
        if mime is None:
            log.warning("Proof %d of %s has an unsupported type; skipped.", index, request_id)
            records.append({"path": path, "outcome": "skipped_unsupported_type"})
            continue
        try:
            data = storage.download_object(BUCKET, path, access_token, max_bytes=MAX_FILE_BYTES)
        except storage.StorageObjectNotFoundError as exc:
            raise ProofFileMissingError(
                "A proof file listed for this request was not found in Storage (or is not visible to staff)."
            ) from exc
        except storage.StorageObjectTooLargeError:
            log.warning("Proof %d of %s exceeds %d MB; skipped.", index, request_id, MAX_FILE_BYTES // (1024 * 1024))
            records.append({"path": path, "outcome": "skipped_too_large", "mime_type": mime})
            continue
        if sniff_mime_type(data) != mime:
            log.warning("Proof %d of %s does not contain the document type its name claims; skipped.", index, request_id)
            records.append({"path": path, "outcome": "skipped_content_mismatch", "mime_type": mime,
                            "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            continue
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise ProofTooLargeError(
                f"The proof documents together exceed {MAX_TOTAL_BYTES // (1024 * 1024)} MB and cannot be "
                "sent for automatic evaluation."
            )
        files.append({"filename": name, "mime_type": mime, "data": data})
        records.append({"path": path, "outcome": "attached", "mime_type": mime,
                        "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    return ProofLoad(files=files, records=records)
