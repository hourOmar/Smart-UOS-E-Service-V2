"""The two current syllabi of a request, read as the signed-in staff member.

Replaces the standalone syllabus retrieval (bucket listing by file-name prefix with the
anon / service_role key, local sample folder, several files per side). Only source: the
CURRENT version of each side in the Phase 3A registry (public."Course_Equivalency_Syllabus",
read by request_data), downloaded through app.core.storage with the staff member's own
session (Phase 1 staff-only read policy). No key, no listing, no upload, no signed link.

Before any text is extracted each file must match its registration: exact size, the
registered SHA-256 (legacy rows have none: then the SHA-256 recorded by an earlier
evaluation of the same Syllabus_ID, when there is one), and the Phase 3B content checks
(check_syllabus_file) with the registered MIME type. A mismatch is a DATA error (the run
fails); a Storage problem is a TECHNICAL error. A readable-text problem (e.g. a scanned
PDF) is NOT an error: as in the standalone the side is marked unreadable and the agent asks
for a readable syllabus (MANUAL_REVIEW path).

The extracted text exists only in memory for this run. The run stores REFERENCES only:
syllabus_id, side, storage_path, file_name, mime_type, size_bytes, sha256, source, text_chars.
"""

import hashlib
from dataclasses import dataclass, field

from app.core import storage
from app.course_equivalency.syllabus_files import MAX_FILE_BYTES, InvalidSyllabusFileError, check_syllabus_file

from .document_reader import read_document
from .exceptions import (
    DocumentReadError, SyllabiMissingError, SyllabusFileMissingError, SyllabusIntegrityError, SyllabusInvalidError,
)

BUCKET = "course-syllabi"
SIDES = ("old", "new")
REFERENCE_KEYS = ("syllabus_id", "side", "storage_path", "file_name", "mime_type", "size_bytes", "sha256", "source",
                  "text_chars")
_LABEL = {"old": "previously completed course", "new": "requested course"}


@dataclass(frozen=True)
class SyllabusLoad:
    sides: dict = field(repr=False)     # standalone get_syllabi shape, with the text (memory only)
    references: list[dict]               # stored with the run


def _empty(side: str) -> dict:
    return {"side": side, "available": False, "readable": False, "source": None, "filename": None, "files": [],
            "file_count": 0, "text": None, "error": None}


def load_syllabi(request_id: str, rows: list[dict], known: dict[str, str], access_token: str,
                 max_chars: int) -> SyllabusLoad:
    by_side = {}
    for row in rows:
        if row.get("side") in by_side:
            raise SyllabusIntegrityError("More than one current syllabus is registered for one side.")
        by_side[row.get("side")] = row
    sides, references = {}, []
    for side in SIDES:
        row = by_side.get(side)
        if row is None:
            raise SyllabiMissingError(f"No current syllabus is registered for the {_LABEL[side]}.")
        path = row["storage_path"]
        if not isinstance(path, str) or not path.startswith(f"{request_id}/"):
            raise SyllabusIntegrityError("A registered syllabus path is not inside this request's folder.")
        try:
            data = storage.download_object(BUCKET, path, access_token, max_bytes=MAX_FILE_BYTES)
        except storage.StorageObjectNotFoundError as exc:
            raise SyllabusFileMissingError(
                f"The registered syllabus for the {_LABEL[side]} was not found in Storage (or is not visible to staff)."
            ) from exc
        except storage.StorageObjectTooLargeError as exc:
            raise SyllabusIntegrityError(f"The syllabus for the {_LABEL[side]} is larger than its registration allows.") from exc
        if len(data) != row["size_bytes"]:
            raise SyllabusIntegrityError(f"The syllabus file for the {_LABEL[side]} does not have its registered size.")
        sha = hashlib.sha256(data).hexdigest()
        if row.get("sha256"):
            if sha != row["sha256"]:
                raise SyllabusIntegrityError(f"The syllabus file for the {_LABEL[side]} does not match its registered SHA-256.")
        elif known.get(row["syllabus_id"]) and known[row["syllabus_id"]] != sha:
            raise SyllabusIntegrityError(
                f"The syllabus file for the {_LABEL[side]} changed since it was last evaluated (SHA-256 differs)."
            )
        try:
            checked = check_syllabus_file(row["file_name"], data)
        except InvalidSyllabusFileError as exc:
            raise SyllabusInvalidError(
                f"The syllabus for the {_LABEL[side]} is not an acceptable PDF or DOCX file ({exc.code})."
            ) from exc
        if checked.mime_type != row["mime_type"]:
            raise SyllabusIntegrityError(f"The syllabus file for the {_LABEL[side]} does not match its registered type.")

        item = _empty(side)
        item.update(available=True, source="bucket", filename=row["file_name"], files=[row["file_name"]], file_count=1)
        try:
            item["text"] = read_document(data, f"{side}_course_syllabus.{checked.extension}", max_chars)
            item["readable"] = True
        except DocumentReadError as exc:
            item["error"] = str(exc)
        del data
        sides[side] = item
        references.append({
            "syllabus_id": row["syllabus_id"], "side": side, "storage_path": path, "file_name": row["file_name"],
            "mime_type": row["mime_type"], "size_bytes": row["size_bytes"], "sha256": sha, "source": row["source"],
            "text_chars": len(item["text"] or ""),
        })
    return SyllabusLoad(sides=sides, references=references)
