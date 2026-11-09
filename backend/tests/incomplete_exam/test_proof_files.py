"""proof_files.py: bucket-only downloads as the staff member, with path,
type and size checks. Storage is faked."""

import logging

import pytest

from app.agents.incomplete_exam import proof_files
from app.agents.incomplete_exam.exceptions import ProofFileMissingError, ProofPathError, ProofTooLargeError
from app.core import storage

from .fakes import JPEG, PDF, PNG, REQUEST_ID, TOKEN, WEBP


class FakeStorage:
    def __init__(self, objects):
        self.objects = objects
        self.calls = []

    def __call__(self, bucket, path, access_token, *, max_bytes):
        self.calls.append({"bucket": bucket, "path": path, "token": access_token, "max_bytes": max_bytes})
        value = self.objects[path]
        if isinstance(value, BaseException):
            raise value
        return value


@pytest.fixture
def fake_storage(monkeypatch):
    def install(objects):
        fake = FakeStorage(objects)
        monkeypatch.setattr(proof_files.storage, "download_object", fake)
        return fake
    return install


def p(name):
    return f"{REQUEST_ID}/{name}"


def test_no_paths_means_no_download(fake_storage):
    fake = fake_storage({})
    load = proof_files.load_proof_files(REQUEST_ID, [], TOKEN)
    assert load.files == [] and load.records == [] and fake.calls == []


def test_downloads_as_staff_and_keeps_order(fake_storage):
    fake = fake_storage({p("a.pdf"): PDF, p("b.PNG"): PNG, p("c.jpeg"): JPEG, p("d.webp"): WEBP})
    load = proof_files.load_proof_files(REQUEST_ID, [p("a.pdf"), p("b.PNG"), p("c.jpeg"), p("d.webp")], TOKEN)
    assert [(f["filename"], f["mime_type"]) for f in load.files] == [
        ("a.pdf", "application/pdf"), ("b.PNG", "image/png"), ("c.jpeg", "image/jpeg"), ("d.webp", "image/webp")]
    assert load.files[0]["data"] == PDF
    assert {c["bucket"] for c in fake.calls} == {"incomplete-exam-proofs"}
    assert {c["token"] for c in fake.calls} == {TOKEN}
    assert {c["max_bytes"] for c in fake.calls} == {10 * 1024 * 1024}
    record = load.records[0]
    assert record["outcome"] == "attached" and record["bytes"] == len(PDF) and len(record["sha256"]) == 64
    assert all("data" not in r for r in load.records)
    assert "%PDF" not in repr(load)


@pytest.mark.parametrize("bad", [
    "STUD_INCRQ_INC2_900002/a.pdf",          # another request's folder
    f"{REQUEST_ID}/nested/a.pdf",
    f"{REQUEST_ID}/../a.pdf",
    f"{REQUEST_ID}/..",
    f"{REQUEST_ID}/",
    f"{REQUEST_ID}/a\\b.pdf",
    f"{REQUEST_ID}/a\n.pdf",
    f"incomplete-exam-proofs/{REQUEST_ID}/a.pdf",
    None,
])
def test_paths_outside_the_request_folder_are_data_errors(fake_storage, bad):
    fake = fake_storage({p("ok.pdf"): PDF})
    with pytest.raises(ProofPathError):
        proof_files.load_proof_files(REQUEST_ID, [p("ok.pdf"), bad], TOKEN)
    assert fake.calls == []   # every path is checked before any download


def test_unsupported_type_is_skipped_without_download(fake_storage, caplog):
    fake = fake_storage({p("a.pdf"): PDF})
    with caplog.at_level(logging.WARNING):
        load = proof_files.load_proof_files(REQUEST_ID, [p("notes.docx"), p("a.pdf")], TOKEN)
    assert [f["filename"] for f in load.files] == ["a.pdf"]
    assert load.records[0] == {"path": p("notes.docx"), "outcome": "skipped_unsupported_type"}
    assert [c["path"] for c in fake.calls] == [p("a.pdf")]
    assert "notes.docx" not in caplog.text


def test_content_that_does_not_match_its_name_is_skipped(fake_storage):
    fake_storage({p("fake.pdf"): PNG})
    load = proof_files.load_proof_files(REQUEST_ID, [p("fake.pdf")], TOKEN)
    assert load.files == [] and load.records[0]["outcome"] == "skipped_content_mismatch"


def test_oversized_file_is_skipped(fake_storage):
    fake_storage({p("big.pdf"): storage.StorageObjectTooLargeError("x")})
    load = proof_files.load_proof_files(REQUEST_ID, [p("big.pdf")], TOKEN)
    assert load.files == [] and load.records[0]["outcome"] == "skipped_too_large"


def test_listed_file_missing_is_a_data_error(fake_storage):
    fake_storage({p("gone.pdf"): storage.StorageObjectNotFoundError("x")})
    with pytest.raises(ProofFileMissingError):
        proof_files.load_proof_files(REQUEST_ID, [p("gone.pdf")], TOKEN)


@pytest.mark.parametrize("error", [storage.StorageAccessDeniedError, storage.StorageUnavailableError,
                                   storage.StorageNotConfiguredError])
def test_storage_problems_are_technical_and_never_no_file(fake_storage, error):
    fake_storage({p("a.pdf"): error("x")})
    with pytest.raises(error):
        proof_files.load_proof_files(REQUEST_ID, [p("a.pdf")], TOKEN)


def test_total_size_limit(fake_storage):
    seven_mb = b"%PDF-" + b"0" * (7 * 1024 * 1024)
    fake_storage({p("1.pdf"): seven_mb, p("2.pdf"): seven_mb, p("3.pdf"): seven_mb})
    with pytest.raises(ProofTooLargeError):
        proof_files.load_proof_files(REQUEST_ID, [p("1.pdf"), p("2.pdf"), p("3.pdf")], TOKEN)


def test_duplicate_paths_are_sent_once(fake_storage):
    fake = fake_storage({p("a.pdf"): PDF})
    load = proof_files.load_proof_files(REQUEST_ID, [p("a.pdf"), p("a.pdf")], TOKEN)
    assert len(load.files) == 1 and len(fake.calls) == 1


def test_sniffing():
    assert proof_files.sniff_mime_type(PDF) == "application/pdf"
    assert proof_files.sniff_mime_type(PNG) == "image/png"
    assert proof_files.sniff_mime_type(JPEG) == "image/jpeg"
    assert proof_files.sniff_mime_type(WEBP) == "image/webp"
    assert proof_files.sniff_mime_type(b"MZ\x90\x00") is None
    assert proof_files.expected_mime_type(".pdf") is None and proof_files.expected_mime_type("x.PDF") == "application/pdf"
