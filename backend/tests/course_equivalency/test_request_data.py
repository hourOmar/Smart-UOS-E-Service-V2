"""request_data / plan_tools against a fake connection: fixed queries with bound
parameters, one read-only transaction, standalone shapes, any-version study plan, totals,
colleges, TR-only transferred credits and earlier syllabus hashes."""

import pytest

from app.agents.course_equivalency import plan_tools, request_data
from app.agents.course_equivalency.exceptions import (
    CourseEquivalencyDetailsMissingError, CourseNotFoundError, NotCourseEquivalencyRequestError, RequestNotFoundError,
    StudentNotFoundError,
)

from .fakes import RID, SID_OLD, STUDENT_ID


class Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows

    def scalars(self):
        return Result([next(iter(r.values())) if isinstance(r, dict) else r for r in self.rows])

    def scalar(self):
        if not self.rows:
            return None
        row = self.rows[0]
        return next(iter(row.values())) if isinstance(row, dict) else row


class Conn:
    def __init__(self, **tables):
        self.tables = tables
        self.queries = []

    def execute(self, statement, params=None):
        sql = str(statement)
        self.queries.append((sql, params))
        for key, rows in self.tables.items():
            if key in sql:
                return Result(rows(params) if callable(rows) else rows)
        return Result([])


def tables(**over):
    base = {
        'FROM public."Request" WHERE': [{"Request_ID": RID, "Student_ID": STUDENT_ID, "Request_Type": "Course Equivalency",
                                         "Request_Date": "2026-11-01", "Current_Status": "In Progress"}],
        'FROM public."Course_Equivalency" WHERE': [{"Request_ID": RID, "Old_Course_ID": "1501110", "New_Course_ID": "1501116",
                                                     "Reason": "r", **{c: None for c in request_data.CONTEXT_COLUMNS}}],
        'FROM public."Student"': [{"Student_ID": STUDENT_ID, "Student_Name": "S", "CGPA": 3.0, "Completed_Hours": 30,
                                   "Program_ID": "1501", "Program_Name": "Bachelor of Science in Computer Science"}],
        'FROM public."Takes" WHERE': [{"Course_ID": "1501110", "Section_ID": "1", "Term": 202510, "Grade": "B"}],
        'FROM public."Course" WHERE': lambda p: [{"Course_ID": p["cid"], "Course_Name": "C" + p["cid"], "Credit_Hours": 3}],
        "Program_Change": [],
        "Program_Study_Plan_Course": [{"Course_ID": "1501116"}],
        "Program_Study_Plan_Total": [{"min": 123}],
        'FROM public."Program" WHERE': [{"College_Name": "College of Computing and Informatics"}],
        "upper(btrim": [{"sum": 0}],
        "Course_Equivalency_Syllabus": [],
        "agents.course_equivalency_evaluation": [],
    }
    base.update(over)
    return base


def test_reads_with_bound_parameters_and_standalone_shapes():
    conn = Conn(**tables())
    data = request_data.fetch_request_data(conn, RID)
    assert data.request["old_course_id"] == "1501110" and data.request["stated_grade"] is None
    assert set(data.request["extra_fields"]) == set(request_data.CONTEXT_COLUMNS)
    assert data.student["program_name"] == "Bachelor of Science in Computer Science"
    assert data.study_plan["in_plan"] is True and data.study_plan["program_checked"].endswith("Computer Science")
    assert data.program_info == {"program_id": "1501", "college": "College of Computing and Informatics",
                                 "plan_total_credits": 123, "plan_table": "Program_Study_Plan_Total"}
    assert data.transferred == 0
    for sql, params in conn.queries:
        assert "SELECT" in sql and "INSERT" not in sql and "UPDATE" not in sql and "DELETE" not in sql
        assert RID not in sql and STUDENT_ID not in sql            # values are bound, never inlined
    plan_sql = next(sql for sql, _ in conn.queries if "Program_Study_Plan_Course" in sql)
    assert "Is_Current" not in plan_sql and "Plan_Version" not in plan_sql   # no currentness check


@pytest.mark.parametrize("over,error", [
    ({'FROM public."Request" WHERE': []}, RequestNotFoundError),
    ({'FROM public."Request" WHERE': [{"Request_ID": RID, "Student_ID": STUDENT_ID, "Request_Type": "Raise Capacity",
                                        "Request_Date": None, "Current_Status": "In Progress"}]}, NotCourseEquivalencyRequestError),
    ({'FROM public."Course_Equivalency" WHERE': []}, CourseEquivalencyDetailsMissingError),
    ({'FROM public."Student"': []}, StudentNotFoundError),
    ({'FROM public."Course" WHERE': lambda p: []}, CourseNotFoundError),
])
def test_request_level_and_data_errors(over, error):
    with pytest.raises(error):
        request_data.fetch_request_data(Conn(**tables(**over)), RID)


def test_missing_plan_is_unverified_and_old_course_outside_catalog_is_kept():
    conn = Conn(**tables(**{"Program_Study_Plan_Course": [],
                            'FROM public."Course" WHERE': lambda p: [] if p["cid"] == "1501110" else
                            [{"Course_ID": p["cid"], "Course_Name": "N", "Credit_Hours": 3}]}))
    data = request_data.fetch_request_data(conn, RID)
    assert data.study_plan["in_plan"] is None and "not verified" in data.study_plan["note"]
    assert data.courses["old"]["in_catalog"] is False and data.courses["old"]["name"] is None


def test_program_change_classification_newest_first():
    rows = [{"_status": "Rejected", "New_Program_ID": "1", "New_Program_Name": "A", "Current_Program_Name": "X"},
            {"_status": "Completed", "New_Program_ID": "2", "New_Program_Name": "B", "Current_Program_Name": "X"},
            {"_status": "Completed", "New_Program_ID": "3", "New_Program_Name": "C", "Current_Program_Name": "X"},
            {"_status": "In Progress", "New_Program_ID": "4", "New_Program_Name": "D", "Current_Program_Name": "X"}]
    out = plan_tools.classify_program_changes(rows)
    assert out["completed"]["new_program_name"] == "B" and out["rejected"]["new_program_name"] == "A"
    assert out["pending"]["new_program_name"] == "D"


def test_transfer_limit_rules_unchanged():
    assert plan_tools.transfer_limit("College of Engineering", None)["cap_credit_hours"] == 70
    assert plan_tools.transfer_limit("College of Health Sciences", 132)["cap_credit_hours"] == 66
    assert plan_tools.transfer_limit("College of Pharmacy", 200)["cap_credit_hours"] == 70
    assert plan_tools.transfer_limit("College of Computing and Informatics", 132)["cap_credit_hours"] == 60
    assert plan_tools.transfer_limit(None, None)["college_known"] is False


def test_transferred_credits_count_only_tr_with_a_bound_code():
    conn = Conn(**{"upper(btrim": [{"sum": 6}]})
    assert plan_tools.transferred_credits(conn, STUDENT_ID) == 6
    assert conn.queries[0][1] == {"sid": STUDENT_ID, "code": "TR"}


def test_best_attempt_order_matches_phase_2a():
    t = [{"Course_ID": "X", "Section_ID": "2", "Term": 202410, "Grade": "B"},
         {"Course_ID": "X", "Section_ID": "9", "Term": 202510, "Grade": "B"},
         {"Course_ID": "X", "Section_ID": "1", "Term": 202510, "Grade": "C+"},
         {"Course_ID": "X", "Section_ID": "5", "Term": 202610, "Grade": None}]
    best = request_data.find_course_in_transcript(t, "X")
    assert (best["grade"], best["term"], best["attempts"]) == ("B", 202510, 4)
    only_open = request_data.find_course_in_transcript([{"Course_ID": "X", "Section_ID": "5", "Term": 202610, "Grade": None}], "X")
    assert only_open["found"] and only_open["grade"] is None and only_open["passed"] is False
    assert request_data.find_course_in_transcript([], "X") == {"found": False, "grade": None, "passed": None, "term": None}


def test_known_hashes_keep_the_first_recorded_value():
    rows = [[{"syllabus_id": SID_OLD, "sha256": "a" * 64}], [{"syllabus_id": SID_OLD, "sha256": "b" * 64}], None]
    assert request_data.known_hashes(rows) == {SID_OLD: "a" * 64}
