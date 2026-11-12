"""study_plan_check.py (check 3) with a fake Gemini: the catalog lookup, the
unchanged prompt, reply normalization and sanitized failures (contract section 4)."""

import hashlib

import pytest

from app.agents.course_substitution_eligibility import study_plan_check as spc

from .fakes import (
    FAKE_KEY, OOD_JAVA, PROGRAM_NAME, STUDENT_ID, STUDENT_NAME, STUDY_PLAN_URL, api_error, install_fake_gemini,
    make_request, study_plan_reply,
)

CHECK_3 = "Original course is a core course"
# The standalone prompt (commit 32f83d3) rendered for the contract's Example A inputs.
PROMPT_SHA256 = "5d58ac643ae0b9665012aaa5a83134a71fb8b5cf2b88df0a8101a11b61d9da4f"
MATCH = f"Matched catalog program: {PROGRAM_NAME}"


def catalog(tmp_path, *entries):
    path = tmp_path / "catalog.txt"
    path.write_text("\n\n".join(
        f"Program ID: {pid}\nProgram Name: {name}\nCollege: Synthetic\nOfficial URL: {url}"
        for pid, name, url in entries) + "\n", encoding="utf-8")
    return path


# --- catalog lookup -------------------------------------------------------------

def test_real_catalog_matches_the_computer_science_url():
    url, evidence = spc.find_program_study_plan_url({"program_id": "1501", "program_name": PROGRAM_NAME})
    assert url == STUDY_PLAN_URL
    assert evidence == MATCH


def test_scores_two_and_one_match(tmp_path):
    path = catalog(tmp_path, ("9", "Bachelor of Science in Synthetic Studies", "https://a.example/1"),
                   ("9", "Bachelor of Arts in Other Things", "https://a.example/2"))
    assert spc.find_program_study_plan_url({"program_id": "9", "program_name": "synthetic   studies"}, path)[0] == \
        "https://a.example/1"                                              # score 2: contained, normalized
    path = catalog(tmp_path, ("9", "Bachelor of Science (Hons) in Synthetic – Studies", "https://a.example/1"))
    assert spc.find_program_study_plan_url(
        {"program_id": "9", "program_name": "BS Synthetic Studies"}, path)[0] == "https://a.example/1"  # score 1


def test_no_candidate_score_zero_and_tie_give_no_url(tmp_path):
    path = catalog(tmp_path, ("9", "Bachelor of Science in Synthetic Studies", "https://a.example/1"),
                   ("9", "Bachelor of Science in Synthetic Studies", "https://a.example/2"))
    assert spc.find_program_study_plan_url({"program_id": "8", "program_name": "Synthetic"}, path)[0] is None
    assert spc.find_program_study_plan_url({"program_id": "9", "program_name": "Unrelated"}, path)[0] is None
    url, evidence = spc.find_program_study_plan_url({"program_id": "9", "program_name": "Synthetic Studies"}, path)
    assert url is None and evidence.startswith("Multiple catalog entries match the program")
    assert spc.find_program_study_plan_url({"program_id": "9"}, tmp_path / "missing.txt")[0] is None


@pytest.mark.parametrize("program_id, program_name", [("0000", PROGRAM_NAME), ("1501", "Unrelated Degree")])
def test_no_url_means_requires_review_and_no_gemini_call(monkeypatch, program_id, program_name):
    models = install_fake_gemini(monkeypatch)                  # any call would raise "more calls than configured"
    result = spc.check_original_course_is_core(make_request(program_id=program_id, program_name=program_name))
    assert result["condition"] == CHECK_3 and result["status"] == "REQUIRES_REVIEW"
    assert result["source_url"] is None and result["classification"] == "UNKNOWN"
    assert models.calls == []


def test_missing_catalog_file_means_no_gemini_call(monkeypatch, tmp_path):
    models = install_fake_gemini(monkeypatch)
    monkeypatch.setattr(spc, "CATALOG_PATH", tmp_path / "missing.txt")
    result = spc.check_original_course_is_core(make_request())
    assert result["status"] == "REQUIRES_REVIEW" and result["evidence"].startswith("Program catalog file not found")
    assert models.calls == []


# --- the Gemini call ------------------------------------------------------------

def test_prompt_is_unchanged_uses_url_context_and_has_no_student_identity(monkeypatch):
    models = install_fake_gemini(monkeypatch, study_plan_reply())
    spc.check_original_course_is_core(make_request(original=OOD_JAVA))
    (call,) = models.calls
    prompt = call["contents"]
    assert hashlib.sha256(prompt.encode()).hexdigest() == PROMPT_SHA256
    assert call["config"].tools[0].url_context is not None
    assert call["model"] == "test-model"
    for identity in (STUDENT_ID, STUDENT_NAME):
        assert identity not in prompt


def test_pass_compulsory(monkeypatch):
    install_fake_gemini(monkeypatch, study_plan_reply())
    assert spc.check_original_course_is_core(make_request()) == {
        "condition": CHECK_3, "status": "PASS",
        "evidence": f"{MATCH}. Listed under Major Compulsory Courses.",
        "source_url": STUDY_PLAN_URL, "classification": "COMPULSORY",
    }


@pytest.mark.parametrize("status, classification, expected_status, expected_classification", [
    ("PASS", "ELECTIVE", "REQUIRES_REVIEW", "ELECTIVE"),
    ("FAIL", "COMPULSORY", "REQUIRES_REVIEW", "COMPULSORY"),
    ("FAIL", "ELECTIVE", "FAIL", "ELECTIVE"),
    ("fail ", " elective", "FAIL", "ELECTIVE"),
    ("MAYBE", "COMPULSORY", "REQUIRES_REVIEW", "COMPULSORY"),
    ("PASS", "CORE", "REQUIRES_REVIEW", "UNKNOWN"),
    ("REQUIRES_REVIEW", "UNKNOWN", "REQUIRES_REVIEW", "UNKNOWN"),
])
def test_reply_normalization(monkeypatch, status, classification, expected_status, expected_classification):
    install_fake_gemini(monkeypatch, study_plan_reply(status, classification))
    result = spc.check_original_course_is_core(make_request())
    assert (result["status"], result["classification"]) == (expected_status, expected_classification)


def test_fenced_json_and_json_inside_text_parse(monkeypatch):
    install_fake_gemini(monkeypatch, "```json\n" + study_plan_reply() + "\n```",
                        "Here it is: " + study_plan_reply("FAIL", "ELECTIVE") + " Done.")
    assert spc.check_original_course_is_core(make_request())["status"] == "PASS"
    assert spc.check_original_course_is_core(make_request())["status"] == "FAIL"


def test_missing_source_url_and_evidence_fall_back(monkeypatch):
    install_fake_gemini(monkeypatch, '{"status": "PASS", "classification": "COMPULSORY", "source_url": ""}')
    result = spc.check_original_course_is_core(make_request())
    assert result["source_url"] == STUDY_PLAN_URL
    assert result["evidence"] == f"{MATCH}. Gemini did not provide supporting evidence."


def test_non_json_reply_requires_review(monkeypatch):
    install_fake_gemini(monkeypatch, "I could not open the page.")
    result = spc.check_original_course_is_core(make_request())
    assert result == {
        "condition": CHECK_3, "status": "REQUIRES_REVIEW",
        "evidence": "Could not verify the official study plan with Gemini: "
                    "ValueError: Gemini response did not contain a JSON object.",
        "source_url": STUDY_PLAN_URL, "classification": "UNKNOWN",
    }


@pytest.mark.parametrize("reply", ["", None])
def test_empty_reply_requires_review(monkeypatch, reply):
    install_fake_gemini(monkeypatch, reply)
    result = spc.check_original_course_is_core(make_request())
    assert result["status"] == "REQUIRES_REVIEW"
    assert "returned an empty response" in result["evidence"]


def test_gemini_failure_requires_review_with_sanitized_evidence(monkeypatch):
    leak = f"bad request key={FAKE_KEY} for {STUDENT_ID} student@uos.ac.ae Bearer abc.def"
    install_fake_gemini(monkeypatch, api_error(400, leak))
    result = spc.check_original_course_is_core(make_request())
    assert result["status"] == "REQUIRES_REVIEW" and result["classification"] == "UNKNOWN"
    assert result["evidence"].startswith(
        "Could not verify the official study plan with Gemini: GeminiUnavailableError: Gemini request failed: "
        "ClientError 400 INVALID_ARGUMENT")
    for secret in (FAKE_KEY, STUDENT_ID, "student@uos.ac.ae", "abc.def"):
        assert secret not in result["evidence"]


def test_any_exception_text_is_sanitized_at_the_check(monkeypatch):
    """Defence in depth: even an error that did not come through app.core.gemini
    is sanitized before it becomes evidence."""
    def leaking(prompt, use_url_context=False):
        raise RuntimeError(f"failed with key={FAKE_KEY} for {STUDENT_ID} at someone@uos.ac.ae")
    monkeypatch.setattr(spc, "generate_with_fallback", leaking)
    evidence = spc.check_original_course_is_core(make_request())["evidence"]
    assert evidence.startswith("Could not verify the official study plan with Gemini: RuntimeError: failed with key=")
    for secret in (FAKE_KEY, STUDENT_ID, "someone@uos.ac.ae"):
        assert secret not in evidence
