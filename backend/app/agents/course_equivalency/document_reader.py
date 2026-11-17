"""Document Reader: turns a syllabus (PDF or DOCX) into plain text.

From the standalone tools/document_reader.py: the same libraries (pypdf, python-docx), the
same text (PDF page texts joined by new lines; DOCX paragraphs, then table rows as
"cell | cell"), the same normalization (trailing spaces removed, outer blank lines
stripped), the same "no readable text" rule (< 40 characters) and the same cut at
`max_chars`. Changes: TXT / MD are not accepted (the upload service stores PDF and DOCX
only); extraction stops as soon as more than `max_chars` characters have been collected
(the returned text is identical, only less work is done) and after MAX_PDF_PAGES pages;
error messages name the exception type only. Every file reaching this module already
passed the Phase 3B content checks (no encryption, no macros, ZIP-bomb limits).
"""

import io

from .exceptions import DocumentReadError

SUPPORTED = ("pdf", "docx")
MAX_PDF_PAGES = 300


def _normalize(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.splitlines()).strip()


def read_document(data: bytes, filename: str, max_chars: int = 60000) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "pdf":
        text = _read_pdf(data, max_chars)
    elif ext == "docx":
        text = _read_docx(data, max_chars)
    else:
        raise DocumentReadError(f"Unsupported syllabus format {ext!r}. Use PDF or DOCX.")
    text = _normalize(text)
    if len(text) < 40:
        raise DocumentReadError(f"No readable text found in {filename!r} (it may be a scanned image).")
    return text[:max_chars]


def _enough(parts: list[str], max_chars: int) -> bool:
    """True once the normalized text collected so far is longer than max_chars: later
    parts cannot change its first max_chars characters (parts are joined by new lines,
    so no line spans two parts)."""
    return len(_normalize("\n".join(parts))) > max_chars


def _read_pdf(data: bytes, max_chars: int) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        parts: list[str] = []
        for index, page in enumerate(reader.pages):
            if index >= MAX_PDF_PAGES:
                break
            parts.append(page.extract_text() or "")
            if _enough(parts, max_chars):
                break
        return "\n".join(parts)
    except Exception as exc:  # noqa: BLE001
        raise DocumentReadError(f"Could not read the PDF ({type(exc).__name__}).") from exc


def _read_docx(data: bytes, max_chars: int) -> str:
    try:
        import docx
        d = docx.Document(io.BytesIO(data))
        parts: list[str] = []
        for p in d.paragraphs:
            parts.append(p.text)
            if _enough(parts, max_chars):
                return "\n".join(parts)
        for table in d.tables:
            for row in table.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
                if _enough(parts, max_chars):
                    return "\n".join(parts)
        return "\n".join(parts)
    except Exception as exc:  # noqa: BLE001
        raise DocumentReadError(f"Could not read the DOCX ({type(exc).__name__}).") from exc
