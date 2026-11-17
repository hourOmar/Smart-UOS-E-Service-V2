"""Content checks: the type comes from the bytes; encrypted PDFs, macro-enabled or
template DOCX, legacy .doc, damaged / bomb ZIPs, empty and oversized files and
extension mismatches are all refused."""

import pytest

from app.course_equivalency.syllabus_files import (
    DOCX_MIME, MAX_FILE_BYTES, PDF_MIME, InvalidSyllabusFileError, check_syllabus_file, display_file_name,
)

from .fakes import DOCM_MAIN, DOTX_MAIN, OLE_DOC, make_docx, make_pdf


def refused(name, data):
    with pytest.raises(InvalidSyllabusFileError) as info:
        check_syllabus_file(name, data)
    return info.value.code


def test_valid_pdf():
    checked = check_syllabus_file("Calculus I.pdf", make_pdf())
    assert (checked.kind, checked.extension, checked.mime_type) == ("pdf", "pdf", PDF_MIME)
    assert checked.size_bytes == len(make_pdf())


def test_valid_docx():
    checked = check_syllabus_file("Calculus I.docx", make_docx())
    assert (checked.kind, checked.extension, checked.mime_type) == ("docx", "docx", DOCX_MIME)


@pytest.mark.parametrize("name", ["SYLLABUS.PDF", "C:\\fakepath\\syllabus.Pdf", "dir/sub/syllabus.pdf"])
def test_extension_case_and_client_paths_accepted(name):
    assert check_syllabus_file(name, make_pdf()).kind == "pdf"


def test_encrypted_pdf_refused():
    assert refused("a.pdf", make_pdf(encrypted=True)) == "encrypted_pdf"


def test_pdf_word_containing_encrypt_prefix_is_not_misread():
    assert check_syllabus_file("a.pdf", make_pdf(b"/EncryptionNotes are discussed in week 3")).kind == "pdf"


def test_truncated_pdf_refused():
    assert refused("a.pdf", make_pdf(eof=False)) == "invalid_pdf"


def test_macro_part_refused():
    assert refused("a.docx", make_docx(macro_part=True)) == "macro_docx"


def test_macro_enabled_content_type_refused():
    assert refused("a.docx", make_docx(main_type=DOCM_MAIN)) == "macro_docx"


def test_template_refused():
    assert refused("a.docx", make_docx(main_type=DOTX_MAIN)) == "invalid_docx"


def test_docx_without_document_part_refused():
    assert refused("a.docx", make_docx(document=False)) == "invalid_docx"


def test_encrypted_docx_entry_refused():
    assert refused("a.docx", make_docx(encrypted_flag=True)) == "encrypted_docx"


def test_zip_bomb_refused():
    assert refused("a.docx", make_docx(bomb=True)) == "invalid_docx"


def test_too_many_zip_entries_refused():
    assert refused("a.docx", make_docx(extra_entries=2001)) == "invalid_docx"


def test_damaged_zip_refused():
    assert refused("a.docx", b"PK\x03\x04" + b"\x00" * 100) == "invalid_docx"


def test_legacy_doc_refused():
    assert refused("a.doc", OLE_DOC) == "legacy_doc"


@pytest.mark.parametrize("data", [b"plain text pretending to be a pdf", b"\x89PNG\r\n\x1a\n" + b"0" * 50,
                                  b"<html><body>hi</body></html>"])
def test_other_content_refused_whatever_the_name(data):
    assert refused("syllabus.pdf", data) == "unsupported_type"


def test_empty_refused():
    assert refused("a.pdf", b"") == "empty_file"


def test_over_10_mb_refused():
    data = make_pdf() + b"0" * (MAX_FILE_BYTES - len(make_pdf()) + 1)
    assert len(data) == MAX_FILE_BYTES + 1
    assert refused("a.pdf", data) == "file_too_large"


def test_exactly_10_mb_accepted():
    head = make_pdf()
    data = head[:-6] + b"0" * (MAX_FILE_BYTES - len(head)) + b"%%EOF\n"
    assert len(data) == MAX_FILE_BYTES
    assert check_syllabus_file("a.pdf", data).kind == "pdf"


@pytest.mark.parametrize("name,data", [("a.docx", make_pdf()), ("a.pdf", make_docx()), ("a.txt", make_pdf()),
                                       ("noextension", make_pdf()), (None, make_pdf())])
def test_extension_must_match_content(name, data):
    assert refused(name, data) == "extension_mismatch"


def test_display_name_cleaning():
    assert display_file_name("C:\\fakepath\\My   Syllabus\u202e.pdf", "old", "pdf") == "My Syllabus.pdf"
    assert display_file_name("../../etc/passwd.pdf", "new", "pdf") == "passwd.pdf"
    assert display_file_name("...", "old", "pdf") == "old-course-syllabus.pdf"
    assert display_file_name(None, "new", "docx") == "new-course-syllabus.docx"
    assert display_file_name("\x00\x01", "old", "pdf") == "old-course-syllabus.pdf"
    long_name = "a" * 300 + ".docx"
    cleaned = display_file_name(long_name, "old", "docx")
    assert len(cleaned) == 200 and cleaned.endswith(".docx")
