"""
Supabase retrieval for the Program table (Step 4 of the retrieval flow).

Student.Program_ID can legitimately be null — in that case there is no
program to fetch, and this returns None rather than treating it as an
error. If Program_ID is set but points at no row, that is a real data
problem and raises ProgramNotFoundError.
"""

from typing import Any, Optional

from ..retrieval._query import select_rows
from ..retrieval.errors import ProgramNotFoundError
from ..schemas.program import ProgramInfo

_COLUMNS = "Program_ID, Program_Name, College_Name"


def get_program(client: Any, program_id: Optional[int]) -> Optional[ProgramInfo]:
    if program_id is None:
        return None

    rows = select_rows(client, "Program", _COLUMNS, {"Program_ID": program_id})
    if not rows:
        raise ProgramNotFoundError(
            f"Student.Program_ID={program_id!r} does not match any Program row."
        )

    row = rows[0]
    return ProgramInfo(
        program_id=row["Program_ID"],
        program_name=row["Program_Name"],
        college_name=row["College_Name"],
    )
