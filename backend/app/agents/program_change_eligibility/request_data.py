"""Program Change request data, read directly by the backend.

Replaces the standalone agent's database.py, which called the Supabase RPC
public.get_program_change_request with the anon key. This module never calls
that RPC: it runs the same json_build_object query itself, as the backend's
own role, in a read-only transaction (app.core.database.read_only), so the
agent receives exactly the JSON object the RPC returned:

    request_id, request_type, current_status,
    current_program {program_id, program_name},
    new_program     {program_id, program_name},
    reason,
    student         {cgpa, completed_hours},
    transcript      [{course_id, course_name, credit_hours, grade, term}, ...]
                    ordered by term, then course_id

Programs are matched on their composite key (Program_ID AND Program_Name),
and only 'Program Change' requests are returned, as in the RPC body of
2026-10-23 (the composite program key fix, agent commit a4dbfe3). Anything
else -- an unknown ID, another request type, missing Program_Change or
Program rows -- is None, as the RPC returned NULL.

The value is built and serialized by PostgreSQL and parsed here with
json.loads, as supabase-py parses the RPC reply, so numbers, nulls and
ordering are identical.

Database access this needs (Phase 2, not installed yet): SELECT on
Program_Change (Request_ID, Current_Program_ID, Current_Program_Name,
New_Program_ID, New_Program_Name, Reason) plus a backend read policy. The
other columns are already granted by eligibility/01_install.sql: Request
(Request_ID, Request_Type, Current_Status, Student_ID), Student (Student_ID,
CGPA, Completed_Hours), Program (Program_ID, Program_Name), Takes
(Student_ID, Course_ID, Grade, Term), Course (Course_ID, Course_Name,
Credit_Hours).
"""

import json

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.database import read_only

PROGRAM_CHANGE_REQUEST_SQL = text(
    """
    SELECT json_build_object(
        'request_id', r."Request_ID",
        'request_type', r."Request_Type",
        'current_status', r."Current_Status",
        'current_program', json_build_object(
            'program_id', current_program."Program_ID",
            'program_name', current_program."Program_Name"
        ),
        'new_program', json_build_object(
            'program_id', new_program."Program_ID",
            'program_name', new_program."Program_Name"
        ),
        'reason', pc."Reason",
        'student', json_build_object(
            'cgpa', s."CGPA",
            'completed_hours', s."Completed_Hours"
        ),
        'transcript', COALESCE(
            (
                SELECT json_agg(
                    json_build_object(
                        'course_id', c."Course_ID",
                        'course_name', c."Course_Name",
                        'credit_hours', c."Credit_Hours",
                        'grade', t."Grade",
                        'term', t."Term"
                    )
                    ORDER BY t."Term", c."Course_ID"
                )
                FROM public."Takes" t
                JOIN public."Course" c ON c."Course_ID" = t."Course_ID"
                WHERE t."Student_ID" = s."Student_ID"
            ),
            '[]'::json
        )
    )::text
    FROM public."Request" r
    JOIN public."Program_Change" pc ON pc."Request_ID" = r."Request_ID"
    JOIN public."Student" s ON s."Student_ID" = r."Student_ID"
    JOIN public."Program" current_program
        ON current_program."Program_ID" = pc."Current_Program_ID"
       AND current_program."Program_Name" = pc."Current_Program_Name"
    JOIN public."Program" new_program
        ON new_program."Program_ID" = pc."New_Program_ID"
       AND new_program."Program_Name" = pc."New_Program_Name"
    WHERE r."Request_ID" = :request_id
      AND r."Request_Type" = 'Program Change'
    """
)


def fetch_program_change_request(conn: Connection, request_id: str) -> dict | None:
    """The request as the RPC returned it, or None. Like the RPC's SELECT INTO,
    the first matching row is used."""
    row = conn.execute(PROGRAM_CHANGE_REQUEST_SQL, {"request_id": request_id}).first()
    if row is None or row[0] is None:
        return None
    return json.loads(row[0])


def get_program_change_request(request_id):
    """Same name, argument and result as the standalone
    database.get_program_change_request, read in its own read-only
    transaction (closed before any Gemini call)."""
    with read_only() as conn:
        return fetch_program_change_request(conn, request_id)
