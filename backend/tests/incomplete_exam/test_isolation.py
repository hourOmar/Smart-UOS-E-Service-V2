"""The integrated package uses only the backend's own settings and access:
no standalone .env, credentials, anon/service_role keys, RPCs or uploads."""

from pathlib import Path

import app
from app import config

PACKAGE = Path(app.__file__).parent / "agents" / "incomplete_exam"
CODE = {path.name: path.read_text(encoding="utf-8") for path in PACKAGE.glob("*.py")}


def code_only(source: str) -> str:
    """Source without its module docstring (which documents what was removed)."""
    if source.startswith('"""'):
        return source[source.index('"""', 3) + 3:]
    return source


def test_backend_settings_come_only_from_backend_env():
    assert config.BACKEND_DIR == Path(app.__file__).resolve().parent.parent
    assert config.BACKEND_DIR.name == "backend"


def test_no_standalone_credentials_or_insecure_access_in_code():
    forbidden = ("Incomplete-Exam-Eligibility", "load_dotenv", "os.getenv", "SERVICE_ROLE", "service_role",
                 "/rest/v1/rpc", "get_incomplete_exam_proofs", "set_incomplete_exam_proofs", "x-upsert",
                 "requests.post", "object/sign", "Proof_File_URL", "proof_documents", "genai.Client")
    for name, source in CODE.items():
        body = code_only(source)
        for token in forbidden:
            assert token not in body, f"{token!r} found in {name}"


def test_no_writes_to_application_tables_and_no_env_files_in_package():
    """Only the run history (agents.incomplete_exam_evaluation) is ever written,
    and only by service.py; nothing writes a public (application) table."""
    for name, source in CODE.items():
        body = code_only(source).upper()
        for statement in ("INSERT INTO PUBLIC", "UPDATE PUBLIC", "DELETE FROM", "TRUNCATE"):
            assert statement not in body, f"{statement} in {name}"
        if name != "service.py":
            assert "WRITE_TRANSACTION" not in body, f"write_transaction used in {name}"
    assert 'INSERT INTO {TABLE}' in CODE["repository.py"] and 'TABLE = "agents.incomplete_exam_evaluation"' in CODE["repository.py"]
    assert not any(PACKAGE.rglob(".env*"))
