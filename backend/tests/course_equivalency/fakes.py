"""Synthetic data and fakes for the Course Equivalency agents' offline tests.
No real student data, database, Storage or Gemini call is used anywhere."""

import io
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from app.agents.course_equivalency import gemini_calls, llm_calls, plan_tools, repository
from app.agents.course_equivalency.request_data import CourseEquivalencyData
from app.core.auth import StaffIdentity, StaffSession

RID = "STUD_EQVO_ECTU_900001"
STUDENT_ID = "U99000001"
STUDENT_NAME = "Synthetic Distinctname"
REASON = "SYNTHETIC-REASON-TEXT I completed this course at my previous university."
TOKEN = "staff-access-token-SYNTHETIC-0123456789"
STAFF = StaffIdentity(auth_user_id="00000000-0000-0000-0000-0000000000b1", staff_id=100001)
SESSION = StaffSession(identity=STAFF, access_token=TOKEN)
SID_OLD = "11111111-1111-4111-8111-111111111111"
SID_NEW = "22222222-2222-4222-8222-222222222222"
SID_NEW2 = "33333333-3333-4333-8333-333333333333"

OLD_TEXT = ("Course Title: Introduction to Programming\nCredit Hours: 3\n"
            "Topics: variables, loops, methods, arrays, strings, classes, file input and output.\n"
            "Learning Outcomes: write programs, use arrays, test and debug code.\nAssessment: Exams 60%, Assignments 40%.")
NEW_TEXT = ("Course Title: Programming I\nCredit Hours: 3\n"
            "Topics: variables, selection, loops, methods, arrays, strings, classes, files.\n"
            "Learning Outcomes: write programs, use arrays, test and debug code.\nAssessment: Exams 60%, Assignments 40%.")


class FakeLookup:
    """Study plans by program NAME: a set (plan loaded) or absent (no plan loaded)."""

    def __init__(self, plans: dict):
        self.plans = plans

    def courses(self, program_id, program_name):
        value = self.plans.get(program_name)
        return None if value is None else set(value)


def make_data(grade="B", in_plan=True, program_change=None, plans=None, transferred=0, college="College of Sciences",
              plan_total=132, old_credit=3, new_credit=3, old_id="1501110", new_id="1501116", transcript=None,
              syllabi=None, known=None, program=("1501", "Computer Science")):
    if plans is None:
        plans = {} if in_plan is None else {program[1]: {new_id} if in_plan else {"9999999"}}
    student = {"student_id": STUDENT_ID, "name": STUDENT_NAME, "cgpa": 3.1, "completed_hours": 45,
               "program_id": program[0], "program_name": program[1]}
    plan, used = plan_tools.resolve_study_plan(FakeLookup(plans), student, new_id, program_change)
    if transcript is None:
        transcript = [] if grade == "none" else [{"Course_ID": old_id, "Section_ID": "21", "Term": 202510, "Grade": grade}]
    request = {
        "request_id": RID, "student_id": STUDENT_ID, "request_date": "2026-11-01", "status": "In Progress",
        "old_course_id": old_id, "new_course_id": new_id, "reason": REASON, "stated_grade": None,
        "extra_fields": {"Program_Change_Request_ID": "STUD_CPSR_CHP3_900002", "Old_Program_ID": "1502",
                         "Old_Program_Name": "Computer Engineering", "New_Program_ID": program[0],
                         "New_Program_Name": program[1], "Plan_Version": "CS-WEB-2026-10-31",
                         "Old_Course_Grade": grade if grade != "none" else None, "Old_Course_Term": 202510},
    }
    courses = {
        "old": {"course_id": old_id, "name": "Old Course", "credit_hours": old_credit, "level": 1, "in_catalog": True},
        "new": {"course_id": new_id, "name": "New Course", "credit_hours": new_credit, "level": 1, "in_catalog": True},
    }
    info = {"program_id": used["program_id"], "college": college, "plan_total_credits": plan_total,
            "plan_table": "Program_Study_Plan_Total" if plan_total else None}
    return CourseEquivalencyData(request=request, student=student, transcript=transcript, courses=courses,
                                 study_plan=plan, program=used, program_info=info, transferred=transferred,
                                 syllabi=syllabi if syllabi is not None else registry_rows(), known_hashes=known or {})


def sides(old_readable=True, new_readable=True, old_text=OLD_TEXT, new_text=NEW_TEXT):
    def one(side, readable, text):
        return {"side": side, "available": True, "readable": readable, "source": "bucket",
                "filename": f"{side}-syllabus-{STUDENT_NAME}.pdf", "files": [f"{side}.pdf"], "file_count": 1,
                "text": text if readable else None,
                "error": None if readable else "No readable text found in 'x.pdf' (it may be a scanned image)."}
    return {"old": one("old", old_readable, old_text), "new": one("new", new_readable, new_text)}


def make_analysis(n_new=4, full=4, partial=0, old_assess=None, new_assess=None, n_out=2, out_full=2):
    """The standalone tests' _analysis (without quote verification)."""
    return {
        "old": {"title": "Old", "credit_hours": 3, "topics": [f"o{i}" for i in range(6)], "learning_outcomes": ["a", "b"],
                "assessment": old_assess or {"exams": 50, "assignments": 50}},
        "new": {"title": "New", "credit_hours": 3, "topics": [f"t{i}" for i in range(n_new)], "learning_outcomes": ["a"] * n_out,
                "assessment": new_assess or {"exams": 50, "assignments": 50}},
        "topic_matches": [{"new_index": i, "old_index": i, "strength": "full"} for i in range(full)]
                         + [{"new_index": full + i, "old_index": 0, "strength": "partial"} for i in range(partial)],
        "outcome_matches": [{"new_index": i, "old_index": i, "strength": "full"} for i in range(out_full)],
    }


def decision(recommendation="APPROVE", reasoning="Courses match.", differences=None):
    return {"status": "ok", "error": None, "recommendation": recommendation, "reasoning": reasoning,
            "checks": [{"name": "content_similarity", "status": "PASS", "explanation": "Topics covered."}],
            "major_similarities": [], "major_differences": differences or []}


def patch_gemini(monkeypatch, analysis=None, result=None, analysis_error=None, decision_error=None):
    """Replaces the two eligibility Gemini calls; records what they received."""
    seen = {"analysis": [], "decision": []}

    def analyze(old_text, new_text, request_id=""):
        seen["analysis"].append((old_text, new_text))
        if analysis_error:
            raise analysis_error
        llm_calls.record("syllabus_analysis", "model-analysis")
        return {"status": "ok", "error": None, "analysis": analysis or make_analysis(), "model": "model-analysis"}

    def decide(evidence):
        seen["decision"].append(gemini_calls.gemini_evidence(evidence))
        if decision_error:
            raise decision_error
        llm_calls.record("decision", "model-decision")
        out = dict(result or decision())
        out["model"] = "model-decision"
        return out
    monkeypatch.setattr(gemini_calls, "analyze_syllabi", analyze)
    monkeypatch.setattr(gemini_calls, "get_gemini_decision", decide)
    return seen


def registry_rows(old_sha=None, new_sha=None, old_size=None, new_size=None, sid_new=SID_NEW, old_name="old.pdf",
                  new_name="new.docx"):
    from app.course_equivalency.syllabus_files import DOCX_MIME, PDF_MIME
    return [
        {"syllabus_id": sid_new, "side": "new", "storage_path": f"{RID}/new/{sid_new}.docx", "file_name": new_name,
         "mime_type": DOCX_MIME, "size_bytes": new_size, "sha256": new_sha, "source": "staff_upload"},
        {"syllabus_id": SID_OLD, "side": "old", "storage_path": f"{RID}/old/{SID_OLD}.pdf", "file_name": old_name,
         "mime_type": PDF_MIME, "size_bytes": old_size, "sha256": old_sha, "source": "legacy_import"},
    ]


def _pdf_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_text_pdf(lines) -> bytes:
    """A small valid PDF whose page shows `lines` as text (extractable by pypdf)."""
    content = "BT /F1 11 Tf 50 750 Td 14 TL " + " ".join(f"({_pdf_escape(l)}) Tj T*" for l in lines) + " ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{obj}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def make_text_docx(paragraphs, table=None) -> bytes:
    import docx
    document = docx.Document()
    for p in paragraphs:
        document.add_paragraph(p)
    if table:
        t = document.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, cell in enumerate(row):
                t.cell(r, c).text = cell
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


@contextmanager
def no_db():
    yield None


class UniqueViolation(Exception):
    sqlstate = "23505"


def _now():
    return datetime.now(timezone.utc)


class FakeRepo:
    """Behaves like agents.course_equivalency_evaluation and the registry: one running row per
    request, finished rows final, REJECT exactly with a rejection explanation, references only."""
    MAX_ERROR_LENGTH = repository.MAX_ERROR_LENGTH
    INTERRUPTED_MESSAGE = repository.INTERRUPTED_MESSAGE
    syllabus_references = staticmethod(repository.syllabus_references)

    def __init__(self, status="In Progress", request_type="Course Equivalency", details=True, ready=True):
        self.requests = {RID: {"request_type": request_type, "current_status": status}}
        self.details = {RID} if details else set()
        self.ready = {RID} if ready else set()
        self.current = {RID: {"old": SID_OLD, "new": SID_NEW}}
        self.sources = {RID: {"old": "staff_upload", "new": "staff_upload"}}
        self.runs: list[dict] = []
        self.locks: list[str] = []
        self.race_on_start = False

    def read_request(self, conn, rid):
        return self.requests.get(rid)

    def has_details(self, conn, rid):
        return rid in self.details

    def syllabi_ready(self, conn, rid):
        return rid in self.ready

    def current_syllabi(self, conn, rid):
        return dict(self.current.get(rid, {"old": None, "new": None}))

    def current_syllabus_sources(self, conn, rid):
        return dict(self.sources.get(rid, {"old": None, "new": None}))

    def lock_request(self, conn, rid):
        self.locks.append(rid)

    def expire_interrupted_runs(self, conn, rid):
        expired = 0
        for run in self.runs:
            if run["request_id"] == rid and run["run_status"] == "running" and run.pop("_stale", False):
                run.update(run_status="failed", finished_at=_now(), failure_kind="interrupted",
                           error_message=self.INTERRUPTED_MESSAGE)
                expired += 1
        return expired

    def has_running_run(self, conn, rid):
        return any(r["request_id"] == rid and r["run_status"] == "running" for r in self.runs)

    def has_any_run(self, conn, rid):
        return any(r["request_id"] == rid for r in self.runs)

    def start_run(self, conn, rid, trigger, uid, staff_id, version):
        if self.race_on_start:
            raise IntegrityError("INSERT", {}, UniqueViolation())
        assert not self.has_running_run(conn, rid), "the unique index would refuse this"
        run = {"id": len(self.runs) + 1, "request_id": rid, "run_status": "running", "run_trigger": trigger,
               "triggered_by": uid, "triggered_by_staff_id": staff_id, "started_at": _now(), "finished_at": None,
               "recommendation": None, "reasoning": None, "check_explanations": None, "deterministic_results": None,
               "evidence": None, "evaluated_syllabi": None, "rejection_explanation": None, "assessment_model": None,
               "rejection_model": None, "agent_version": version, "failure_kind": None, "error_message": None}
        self.runs.append(run)
        return run["id"]

    def _running(self, run_id):
        run = next(r for r in self.runs if r["id"] == run_id)
        return run if run["run_status"] == "running" else None

    def complete_run(self, conn, run_id, outcome):
        assert (outcome["recommendation"] == "REJECT") == (outcome["rejection_explanation"] is not None)
        assert len(outcome["evaluated_syllabi"]) == 2
        run = self._running(run_id)
        if run is None:
            return False
        run.update(run_status="completed", finished_at=_now(), **outcome)
        return True

    def fail_run(self, conn, run_id, kind, message):
        run = self._running(run_id)
        if run is None:
            return False
        run.update(run_status="failed", finished_at=_now(), failure_kind=kind, error_message=message[:2000])
        return True

    def list_runs(self, conn, rid):
        rows = [dict(r, interrupted=bool(r.get("_stale")) and r["run_status"] == "running")
                for r in self.runs if r["request_id"] == rid]
        return sorted(rows, key=lambda r: r["id"], reverse=True)
