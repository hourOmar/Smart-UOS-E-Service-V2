"""The package uses only the backend's own settings and access: no environment
reads, Gemini client or database connection at import, no standalone .env,
print or credentials, byte-identical data files, and no constraints file."""

import hashlib
import subprocess
import sys
from pathlib import Path

import app
from app.agents import course_substitution_eligibility as package
from app.config import BACKEND_DIR

PACKAGE = Path(app.__file__).parent / "agents" / "course_substitution_eligibility"
CODE = {path.name: path.read_text(encoding="utf-8") for path in PACKAGE.glob("*.py")}
MODULES = sorted(path.stem for path in PACKAGE.glob("*.py") if path.stem != "__init__")

DATA_SHA256 = {
    "course_offerings_knowledge_base.txt": "c00ea9f5a789ee9bda79b2bed944aa338688bde9dd38eb06aaf5d5800fcb5cfd",
    "bachelors_program_catalog.txt": "49324f1ea7f683af642845330201d469cec8683914a4023dcc633c1f724c52db",
    "rejection_keywords.json": "c16b99d46253901ddc47f54f52ebe32f883b7b46e065213edef279547ffb42ec",
}


def code_only(source: str) -> str:
    """Source without its module docstring (which documents what was removed)."""
    if source.startswith('"""'):
        return source[source.index('"""', 3) + 3:]
    return source


def test_version_and_expected_modules():
    assert (package.AGENT_NAME, package.AGENT_VERSION, package.STANDALONE_COMMIT) == (
        "course_substitution_eligibility", "1.0.0", "32f83d3")
    assert set(MODULES) == {
        "agent", "eligibility_checks", "exceptions", "explanation_generator", "llm_client", "pipeline",
        "rejection_agent", "rejection_gemini", "rejection_input_tools", "rejection_keyword_tools", "request_data",
        "study_plan_check", "workflow",
    }


def test_data_files_are_byte_identical_and_complete():
    data = PACKAGE / "data"
    assert sorted(p.name for p in data.iterdir()) == sorted(DATA_SHA256)
    for name, digest in DATA_SHA256.items():
        assert hashlib.sha256((data / name).read_bytes()).hexdigest() == digest, name


def test_no_constraints_file_anywhere_in_the_package():
    assert not any(PACKAGE.rglob("course_substitution_constraints*"))
    for name, source in CODE.items():
        assert "course_substitution_constraints" not in source, name


def test_no_standalone_configuration_clients_prints_or_credentials():
    forbidden = ("load_dotenv", "os.getenv", "os.environ", "genai.Client", "print(", "create_engine",
                 "SERVICE_ROLE", "service_role", "sslmode", "DATABASE_URL", "GEMINI_MODELS", "import config",
                 "from config", "from services", "from tools", "from agents", "sys.argv", "input(")
    for name, source in CODE.items():
        body = code_only(source)
        for token in forbidden:
            assert token not in body, f"{token!r} found in {name}"


def test_no_writes_and_no_env_files():
    for name, source in CODE.items():
        body = code_only(source).upper()
        for statement in ("INSERT ", "UPDATE PUBLIC", "DELETE FROM", "TRUNCATE", "WRITE_TRANSACTION"):
            assert statement not in body, f"{statement} in {name}"
    assert not any(PACKAGE.rglob(".env*"))
    assert not any(PACKAGE.rglob(".git"))


def test_importing_reads_no_settings_and_opens_no_client_or_connection():
    """A fresh interpreter imports every module with settings, the Gemini client
    and the database engine all made to fail if touched."""
    script = (
        "import app.config, app.core.gemini, app.core.database, google.genai, sqlalchemy\n"
        "def boom(*a, **k): raise AssertionError('touched at import')\n"
        "app.config.get_settings = boom\n"
        "app.core.gemini.get_client = boom\n"
        "app.core.database.get_engine = boom\n"
        "google.genai.Client = boom\n"
        "sqlalchemy.create_engine = boom\n"
        "import importlib\n"
        f"for m in {MODULES!r}:\n"
        "    importlib.import_module('app.agents.course_substitution_eligibility.' + m)\n"
        "print('ok')\n"
    )
    done = subprocess.run([sys.executable, "-c", script], cwd=BACKEND_DIR, capture_output=True, text=True,
                          timeout=60)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "ok"
