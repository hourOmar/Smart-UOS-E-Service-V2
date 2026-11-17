"""The integrated package uses only the backend's own settings and access: no standalone
.env or credentials, no anon / service_role keys, no listing / upload / signed links, no
writes to application tables, and it leaves the other agents and the syllabus service alone."""

from pathlib import Path

import app

PACKAGE = Path(app.__file__).parent / "agents" / "course_equivalency"
CODE = {path.name: path.read_text(encoding="utf-8") for path in PACKAGE.glob("*.py")}
API = (Path(app.__file__).parent / "api" / "course_equivalency_review.py").read_text(encoding="utf-8")


def code_only(source: str) -> str:
    if source.startswith('"""'):
        return source[source.index('"""', 3) + 3:]
    return source


def test_no_standalone_credentials_or_insecure_access():
    forbidden = ("load_dotenv", "os.getenv", "SERVICE_ROLE", "service_role", "SUPABASE_ANON_KEY", "/rest/v1",
                 "object/list", "object/sign", "x-upsert", "upload_object", "requests.", "genai.Client",
                 "study_plans.json", "samples")
    for name, source in {**CODE, "api": API}.items():
        body = code_only(source)
        for token in forbidden:
            assert token not in body, f"{token!r} in {name}"


def test_only_the_run_history_is_written_and_only_by_the_repository():
    for name, source in CODE.items():
        body = code_only(source).upper()
        for statement in ("INSERT INTO PUBLIC", "UPDATE PUBLIC", "DELETE FROM", "TRUNCATE", "INSERT INTO APP_PRIVATE",
                          "REGISTER_COURSE_SYLLABUS"):
            assert statement not in body, f"{statement} in {name}"
        if name != "repository.py":
            assert "INSERT INTO" not in body and "UPDATE AGENTS" not in body, name


def test_downloads_use_the_course_syllabi_bucket_with_the_staff_token_only():
    body = code_only(CODE["syllabus_files.py"])
    assert 'BUCKET = "course-syllabi"' in body and "storage.download_object(BUCKET, path, access_token" in body


def test_existing_agents_are_untouched_by_this_package():
    for name, source in CODE.items():
        assert "incomplete_exam" not in code_only(source) and "program_change_eligibility" not in code_only(source), name
