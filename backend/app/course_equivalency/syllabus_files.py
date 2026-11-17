"""Content checks for uploaded syllabi.

The file type is decided from the bytes, never from the client's file name or
declared Content-Type. Accepted: a PDF that is not encrypted, or a Word DOCX
document (not macro-enabled, not a template, not encrypted). Everything else is
refused, including legacy .doc files.

DOCX files are checked from the ZIP directory and the small [Content_Types].xml
part only (byte search, no XML parser, no decompression of the document body),
with limits against ZIP bombs. Nothing here writes or executes anything.
"""

import io
import re
import zipfile
from dataclasses import dataclass

MAX_FILE_BYTES = 10 * 1024 * 1024          # bucket and database limit (10,485,760)
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_DOCX_MAIN_TYPE = b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
_OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_PDF_ENCRYPT = re.compile(rb"/Encrypt(?![A-Za-z0-9])")
_MAX_ZIP_ENTRIES = 2000
_MAX_ZIP_UNCOMPRESSED = 50 * 1024 * 1024
_MAX_ZIP_RATIO = 100
_MAX_CONTENT_TYPES_BYTES = 1024 * 1024


class InvalidSyllabusFileError(Exception):
    """The file is not an acceptable syllabus. `code` is stable; the message is safe to show."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class CheckedFile:
    kind: str           # "pdf" or "docx"
    extension: str      # "pdf" or "docx" (used for the Storage object name)
    mime_type: str
    size_bytes: int


def _extension(file_name: str | None) -> str | None:
    if not file_name:
        return None
    base = re.split(r"[\\/]", file_name)[-1]
    if "." not in base:
        return None
    return base.rsplit(".", 1)[1].strip().lower() or None


def _check_pdf(data: bytes) -> None:
    if b"%%EOF" not in data[-2048:]:
        raise InvalidSyllabusFileError("invalid_pdf", "The PDF file is incomplete or damaged.")
    if _PDF_ENCRYPT.search(data):
        raise InvalidSyllabusFileError(
            "encrypted_pdf", "The PDF is encrypted or password-protected. Upload an unprotected PDF.")


def _check_docx(data: bytes) -> None:
    damaged = InvalidSyllabusFileError("invalid_docx", "The Word document is damaged or not a .docx file.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError, OSError):
        raise damaged from None
    with archive:
        try:
            entries = archive.infolist()
        except (zipfile.BadZipFile, ValueError, OSError):
            raise damaged from None
        if not entries or len(entries) > _MAX_ZIP_ENTRIES:
            raise damaged
        total = 0
        for entry in entries:
            if entry.flag_bits & 0x1:
                raise InvalidSyllabusFileError(
                    "encrypted_docx", "The Word document is encrypted or password-protected.")
            total += entry.file_size
            if entry.file_size > 1024 * 1024 and entry.file_size > _MAX_ZIP_RATIO * max(entry.compress_size, 1):
                raise damaged
        if total > _MAX_ZIP_UNCOMPRESSED:
            raise damaged
        names = {entry.filename for entry in entries}
        if any(name.lower().endswith("vbaproject.bin") for name in names):
            raise InvalidSyllabusFileError(
                "macro_docx", "Macro-enabled Word documents are not accepted. Save it as a normal .docx.")
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise damaged
        content_types = archive.getinfo("[Content_Types].xml")
        if content_types.file_size > _MAX_CONTENT_TYPES_BYTES:
            raise damaged
        try:
            types_xml = archive.read(content_types)
        except (zipfile.BadZipFile, ValueError, OSError, RuntimeError):
            raise damaged from None
    if b"macroEnabled" in types_xml:
        raise InvalidSyllabusFileError(
            "macro_docx", "Macro-enabled Word documents are not accepted. Save it as a normal .docx.")
    if _DOCX_MAIN_TYPE not in types_xml:
        raise InvalidSyllabusFileError(
            "invalid_docx", "The file is not a Word document (.docx); templates are not accepted.")


def check_syllabus_file(file_name: str | None, data: bytes) -> CheckedFile:
    """The accepted type, or InvalidSyllabusFileError."""
    size = len(data)
    if size == 0:
        raise InvalidSyllabusFileError("empty_file", "The file is empty.")
    if size > MAX_FILE_BYTES:
        raise InvalidSyllabusFileError("file_too_large", "The file is larger than 10 MB.")

    if data.startswith(b"%PDF-"):
        _check_pdf(data)
        kind, mime = "pdf", PDF_MIME
    elif data.startswith(b"PK\x03\x04"):
        _check_docx(data)
        kind, mime = "docx", DOCX_MIME
    elif data.startswith(_OLE_SIGNATURE):
        raise InvalidSyllabusFileError(
            "legacy_doc", "Old Word (.doc) files are not accepted. Save it as .docx or PDF.")
    else:
        raise InvalidSyllabusFileError("unsupported_type", "Only PDF and Word (.docx) files are accepted.")

    extension = _extension(file_name)
    if extension != kind:
        raise InvalidSyllabusFileError(
            "extension_mismatch",
            f"The file name must end in .{kind} to match its content." if extension
            else f"The file name must end in .{kind}.")
    return CheckedFile(kind=kind, extension=kind, mime_type=mime, size_bytes=size)


def display_file_name(file_name: str | None, side: str, extension: str) -> str:
    """The client's file name for display only (never part of a Storage path): last
    path component, control and invisible characters removed, at most 200 characters;
    a neutral name when nothing usable remains."""
    base = re.split(r"[\\/]", file_name or "")[-1]
    base = re.sub(r"[\x00-\x1f\x7f­​-‏‪-‮⁠-⁩﻿]", "", base)
    base = re.sub(r"\s+", " ", base).strip()
    if not base or base in (".", "..") or not re.search(r"[A-Za-z0-9]", base):
        return f"{side}-course-syllabus.{extension}"
    if len(base) > 200:
        stem, dot, ext = base.rpartition(".")
        base = (stem[: 200 - len(ext) - 1].rstrip() + "." + ext) if dot and len(ext) <= 10 else base[:200].rstrip()
    return base
