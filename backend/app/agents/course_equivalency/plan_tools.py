"""Study plan, program and transfer-credit rules for the Course Equivalency constraints.

The DECISION logic is unchanged from the standalone tools/plan_tools.py: resolve_study_plan
(approved / pending / rejected Program Change handling, notes and results), transfer_limit
(60 credit hours; 70 when the college name contains "engineering", "health" or "pharmacy";
never more than half of the study plan; the knowledge-base values) and the Program Change
classification. When something cannot be found the result is None (unverified, routed to
manual review), never a pass or a fail.

Only the DATA SOURCE changed (approved Phase 4 decisions):
- study-plan membership: public."Program_Study_Plan_Course" for the program
  (Program_ID + Program_Name), ANY plan version -- currentness is not checked; a program
  without plan rows is "not verified", as the standalone treated a missing plan;
- the study-plan total: public."Program_Study_Plan_Total" (official CS 123 / CPE 132), the
  smallest total if a program ever has several versions (the stricter limit);
- the college: public."Program"."College_Name" of the program;
- Program Changes: public."Program_Change" with the request status, as the standalone read them;
- transferred credits: Takes rows graded TR, with the catalog credit hours.
All queries are fixed SQL with bound parameters, run as smart_uos_backend inside
request_data's single read-only transaction.
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .policy import load_equivalency_policy, load_grade_policy

PLAN_COURSES_SQL = text(
    'SELECT DISTINCT "Course_ID" FROM public."Program_Study_Plan_Course" '
    'WHERE "Program_ID" = :pid AND "Program_Name" = :pname'
)
PLAN_TOTAL_SQL = text(
    'SELECT min("Total_Credit_Hours") FROM public."Program_Study_Plan_Total" '
    'WHERE "Program_ID" = :pid AND "Program_Name" = :pname'
)
COLLEGE_SQL = text(
    'SELECT "College_Name" FROM public."Program" WHERE "Program_ID" = :pid AND "Program_Name" = :pname'
)
COLLEGE_BY_ID_SQL = text(
    'SELECT "College_Name" FROM public."Program" WHERE "Program_ID" = :pid ORDER BY "Program_Name" LIMIT 1'
)
PROGRAM_CHANGE_SQL = text(
    'SELECT pc."Request_ID", pc."Current_Program_ID", pc."Current_Program_Name", pc."New_Program_ID", '
    'pc."New_Program_Name", r."Current_Status" AS "_status", r."Request_Date" AS "_date" '
    'FROM public."Program_Change" pc JOIN public."Request" r ON r."Request_ID" = pc."Request_ID" '
    'WHERE r."Student_ID" = :sid ORDER BY r."Request_Date" DESC, r."Request_ID" DESC'
)
TRANSFERRED_SQL = text(
    'SELECT coalesce(sum(c."Credit_Hours"), 0) FROM public."Takes" t '
    'LEFT JOIN public."Course" c ON c."Course_ID" = t."Course_ID" '
    'WHERE t."Student_ID" = :sid AND upper(btrim(t."Grade")) = :code'
)


class PlanLookup:
    """Study-plan courses of a program, read once per program within one transaction."""

    def __init__(self, conn: Connection):
        self.conn = conn
        self._plans: dict[tuple[str, str], set[str] | None] = {}

    def courses(self, program_id, program_name) -> set[str] | None:
        """The program's plan courses (any version), or None when no plan is loaded."""
        if program_id is None or program_name is None:
            return None
        key = (str(program_id), str(program_name))
        if key not in self._plans:
            rows = self.conn.execute(PLAN_COURSES_SQL, {"pid": key[0], "pname": key[1]}).scalars().all()
            self._plans[key] = {str(r) for r in rows} or None
        return self._plans[key]


def course_in_study_plan(lookup, program_id, course_id, program_name: str | None = None) -> dict:
    out = {"in_plan": None, "table": None, "note": None}
    plan = lookup.courses(program_id, program_name)
    if plan is None:
        out["note"] = "No study plan is loaded for this program, so this was not verified."
        return out
    out.update(in_plan=str(course_id) in plan, table="Program_Study_Plan_Course")
    return out


def get_program_info(conn: Connection, program_id, program_name: str | None = None) -> dict:
    """Program college (if it can be found) and the total credits of the study plan."""
    info = {"program_id": program_id, "college": None, "plan_total_credits": None, "plan_table": None}
    if program_id is None:
        return info
    if program_name is not None:
        info["college"] = conn.execute(COLLEGE_SQL, {"pid": str(program_id), "pname": program_name}).scalar()
        total = conn.execute(PLAN_TOTAL_SQL, {"pid": str(program_id), "pname": program_name}).scalar()
        if total:
            info["plan_total_credits"] = int(total)
            info["plan_table"] = "Program_Study_Plan_Total"
    else:
        info["college"] = conn.execute(COLLEGE_BY_ID_SQL, {"pid": str(program_id)}).scalar()
    return info


def transferred_credits(conn: Connection, student_id: str) -> int:
    """Credit hours already transferred (grade TR) in the student's transcript."""
    code = load_grade_policy()["transfer_grade_code"].upper()
    return int(conn.execute(TRANSFERRED_SQL, {"sid": student_id, "code": code}).scalar() or 0)


def transfer_limit(college: str | None, plan_total_credits: int | None) -> dict:
    lim = load_equivalency_policy()["constraints"]["transfer_credit_limits"]
    extended = bool(college) and any(k in college.lower() for k in lim["extended_college_keywords"])
    cap = lim["extended_max_credit_hours"] if extended else lim["default_max_credit_hours"]
    half = int(plan_total_credits * lim["max_fraction_of_study_plan"]) if plan_total_credits else None
    return {"college": college, "college_known": college is not None, "cap_credit_hours": min(cap, half) if half else cap,
            "college_cap": cap, "half_of_plan": half, "community_college_note": lim["community_college_note"]}


_DONE = {"completed", "approved"}
_OPEN = {"in progress", "pending", "pending review"}
_REJECTED = {"rejected", "declined"}


def classify_program_changes(rows: list[dict]) -> dict:
    """{"completed", "pending", "rejected"}: the newest Program Change of each kind (rows newest first)."""
    out = {"completed": None, "pending": None, "rejected": None}
    for row in rows:
        status = str(row.get("_status") or "").strip().lower()
        entry = {"new_program_id": row.get("New_Program_ID"), "new_program_name": row.get("New_Program_Name"),
                 "current_program_name": row.get("Current_Program_Name"), "status": row.get("_status")}
        if status in _DONE and out["completed"] is None:
            out["completed"] = entry
        elif status in _OPEN and out["pending"] is None:
            out["pending"] = entry
        elif status in _REJECTED and out["rejected"] is None:
            out["rejected"] = entry
    return out


def get_program_change_context(conn: Connection, student_id: str) -> dict:
    rows = [dict(r) for r in conn.execute(PROGRAM_CHANGE_SQL, {"sid": student_id}).mappings().all()]
    return classify_program_changes(rows)


def resolve_study_plan(lookup, student: dict, new_course_id, program_change: dict | None) -> tuple[dict, dict]:
    """Checks the requested course against the right program's study plan (unchanged logic).

    - an approved program change: the plan of the new program is used;
    - a pending program change: if the course is only in the new program's plan, the check is
      unverified (None) because the change has not been approved yet;
    - a rejected program change: the student stays in the current program; if the course belongs
      to the plan of the program that was refused, that is stated in the note;
    - otherwise the student's current program is used.
    A program change is only attached to the result when it matters for this course.
    Returns (study plan result, program used for the lookups)."""
    pc = program_change or {}
    done, pending, rejected = pc.get("completed"), pc.get("pending"), pc.get("rejected")
    program = {"program_id": student.get("program_id"), "program_name": student.get("program_name")}
    if done:
        program = {"program_id": done["new_program_id"], "program_name": done["new_program_name"] or program["program_name"]}
    plan = course_in_study_plan(lookup, program["program_id"], new_course_id, program["program_name"])
    plan["program_checked"] = program["program_name"]
    plan["program_change"] = {**done, "result": "approved"} if done else None
    if plan["in_plan"] is False and not done:
        if pending and course_in_study_plan(lookup, pending["new_program_id"], new_course_id, pending["new_program_name"])["in_plan"] is True:
            plan["in_plan"] = None
            plan["program_change"] = {**pending, "result": "pending"}
            plan["note"] = (f"The course is in the {pending['new_program_name']} plan, but the student's program change "
                            "to that program has not been approved yet.")
        elif rejected and course_in_study_plan(lookup, rejected["new_program_id"], new_course_id, rejected["new_program_name"])["in_plan"] is True:
            plan["program_change"] = {**rejected, "result": "rejected"}
            plan["note"] = (f"The course is in the {rejected['new_program_name']} plan, but the student's program change "
                            f"to that program was rejected, so the student remains in {program['program_name']}.")
    return plan, program
