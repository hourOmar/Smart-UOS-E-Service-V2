"""Document reading (PDF / DOCX, bounded extraction) and the syllabus loader: registry rows
only, staff-session downloads, size / SHA-256 / type / content verification before text
extraction, unreadable text is not an error, references only."""

import hashlib

import pytest

from app.agents.course_equivalency import document_reader, syllabus_files
from app.agents.course_equivalency.exceptions import (
    DocumentReadError, SyllabiMissingError, SyllabusFileMissingError, SyllabusIntegrityError, SyllabusInvalidError,
)
from app.core import storage

from .fakes import RID, SID_NEW, SID_OLD, TOKEN, make_text_docx, make_text_pdf, registry_rows

PDF_LINES = ["Course Title: Introduction to Programming", "Credit Hours: 3", "Topics: variables, loops, methods, arrays."]
PDF = make_text_pdf(PDF_LINES)
DOCX = make_text_docx(["Course Title: Programming I", "Topics: variables, selection, loops, methods."],
                      table=[["Week", "Topic"], ["1", "Variables"]])


def test_pdf_and_docx_text_as_in_the_standalone():
    pdf_text = document_reader.read_document(PDF, "old.pdf")
    assert "Introduction to Programming" in pdf_text and "loops" in pdf_text
    docx_text = document_reader.read_document(DOCX, "new.docx")
    assert docx_text.splitlines()[:2] == ["Course Title: Programming I", "Topics: variables, selection, loops, methods."]
    assert "Week | Topic" in docx_text and "1 | Variables" in docx_text


def test_cut_at_max_chars_and_bounded_extraction_give_the_same_text():
    long_docx = make_text_docx([f"Paragraph {i} " + "x" * 50 for i in range(200)])
    short = document_reader.read_document(long_docx, "a.docx", max_chars=500)
    full = document_reader._normalize(document_reader._read_docx(long_docx, 10 ** 9))[:500]
    assert short == full and len(short) == 500


def test_unsupported_or_empty_documents_raise():
    with pytest.raises(DocumentReadError):
        document_reader.read_document(b"plain text", "notes.txt")
    with pytest.raises(DocumentReadError):
        document_reader.read_document(make_text_pdf(["short"]), "a.pdf")
    with pytest.raises(DocumentReadError):
        document_reader.read_document(b"%PDF-1.4 broken", "a.pdf")


@pytest.fixture
def bucket(monkeypatch):
    objects = {f"{RID}/old/{SID_OLD}.pdf": PDF, f"{RID}/new/{SID_NEW}.docx": DOCX}
    calls = []

    def download(bucket_name, path, token, *, max_bytes):
        calls.append((bucket_name, path, token, max_bytes))
        if path not in objects:
            raise storage.StorageObjectNotFoundError("missing")
        return objects[path]
    monkeypatch.setattr(storage, "download_object", download)
    return objects, calls


def rows(**kw):
    kw.setdefault("old_size", len(PDF))
    kw.setdefault("new_size", len(DOCX))
    return registry_rows(**kw)


def test_loads_both_sides_with_the_staff_token_and_returns_references_only(bucket):
    objects, calls = bucket
    load = syllabus_files.load_syllabi(RID, rows(new_sha=hashlib.sha256(DOCX).hexdigest()), {}, TOKEN, 60000)
    assert [c[:3] for c in calls] == [("course-syllabi", f"{RID}/old/{SID_OLD}.pdf", TOKEN),
                                      ("course-syllabi", f"{RID}/new/{SID_NEW}.docx", TOKEN)]
    assert load.sides["old"]["readable"] and "Introduction to Programming" in load.sides["old"]["text"]
    refs = {r["side"]: r for r in load.references}
    assert set(refs["old"]) == set(syllabus_files.REFERENCE_KEYS)
    assert refs["old"]["sha256"] == hashlib.sha256(PDF).hexdigest() and refs["old"]["source"] == "legacy_import"
    assert refs["new"]["syllabus_id"] == SID_NEW and refs["new"]["text_chars"] == len(load.sides["new"]["text"])
    assert "Programming" not in repr(load.references)


@pytest.mark.parametrize("label,kw,error", [
    ("size differs", {"old_size": 1}, SyllabusIntegrityError),
    ("registered sha differs", {"new_sha": "0" * 64}, SyllabusIntegrityError),
])
def test_integrity_mismatches_are_data_errors(bucket, label, kw, error):
    with pytest.raises(error):
        syllabus_files.load_syllabi(RID, rows(**kw), {}, TOKEN, 60000)


def test_legacy_file_must_match_the_hash_recorded_by_an_earlier_evaluation(bucket):
    with pytest.raises(SyllabusIntegrityError, match="changed since it was last evaluated"):
        syllabus_files.load_syllabi(RID, rows(), {SID_OLD: "f" * 64}, TOKEN, 60000)
    load = syllabus_files.load_syllabi(RID, rows(), {SID_OLD: hashlib.sha256(PDF).hexdigest()}, TOKEN, 60000)
    assert load.sides["old"]["readable"]


def test_missing_object_and_missing_side(bucket):
    objects, _ = bucket
    del objects[f"{RID}/new/{SID_NEW}.docx"]
    with pytest.raises(SyllabusFileMissingError):
        syllabus_files.load_syllabi(RID, rows(), {}, TOKEN, 60000)
    with pytest.raises(SyllabiMissingError):
        syllabus_files.load_syllabi(RID, [r for r in rows() if r["side"] == "old"], {}, TOKEN, 60000)


def test_path_outside_the_request_folder_is_refused_before_download(bucket):
    _, calls = bucket
    bad = rows()
    bad[1]["storage_path"] = "STUD_EQVO_ECTU_000999/old/x.pdf"
    with pytest.raises(SyllabusIntegrityError):
        syllabus_files.load_syllabi(RID, bad, {}, TOKEN, 60000)
    assert calls == [] or all(c[1].startswith(f"{RID}/") for c in calls)


def test_invalid_content_and_type_mismatch(bucket):
    objects, _ = bucket
    objects[f"{RID}/old/{SID_OLD}.pdf"] = b"%PDF-1.4\n/Encrypt 1 0 R\n%%EOF\n"
    with pytest.raises(SyllabusInvalidError):
        syllabus_files.load_syllabi(RID, rows(old_size=len(objects[f"{RID}/old/{SID_OLD}.pdf"])), {}, TOKEN, 60000)
    objects[f"{RID}/old/{SID_OLD}.pdf"] = PDF
    wrong = rows()
    wrong[0]["mime_type"] = "application/pdf"          # the new side holds a DOCX
    with pytest.raises(SyllabusIntegrityError):
        syllabus_files.load_syllabi(RID, wrong, {}, TOKEN, 60000)


def test_scanned_document_is_marked_unreadable_not_failed(bucket):
    objects, _ = bucket
    image_only = make_text_pdf([""])
    objects[f"{RID}/old/{SID_OLD}.pdf"] = image_only
    load = syllabus_files.load_syllabi(RID, rows(old_size=len(image_only)), {}, TOKEN, 60000)
    assert load.sides["old"]["readable"] is False and "No readable text" in load.sides["old"]["error"]
    assert {r["side"]: r["text_chars"] for r in load.references}["old"] == 0


def test_storage_failures_propagate_as_technical(monkeypatch):
    def denied(*a, **k):
        raise storage.StorageAccessDeniedError("refused")
    monkeypatch.setattr(storage, "download_object", denied)
    with pytest.raises(storage.StorageAccessDeniedError):
        syllabus_files.load_syllabi(RID, rows(), {}, TOKEN, 60000)
