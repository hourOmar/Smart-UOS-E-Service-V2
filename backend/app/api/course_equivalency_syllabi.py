"""Staff-only API for Course Equivalency syllabi (Phase 3B).

GET  /api/staff/course-equivalency/{request_id}/syllabi
     The current version and history of the old-course and new-course syllabus,
     and whether both are present (readiness). Read-only; starts nothing.
POST /api/staff/course-equivalency/{request_id}/syllabi/{side}     side = old | new
     multipart/form-data with exactly one file field "file" and an optional text
     field "replaces" (the Syllabus_ID the staff member is replacing, or "none"
     when there was no current version): refused with 409 if the current
     version changed meanwhile (checked atomically with registration).

Every route verifies the Supabase session and the Authorized_Staff link
(require_staff / require_staff_session) BEFORE any data is read. The upload
route is asynchronous only so that the session is verified before the request
body is read; the body is then limited (Content-Length required, <= 10 MB plus
multipart overhead, one file, no other fields than "replaces"). The staff ID
always comes from the verified session, never from the request. The caller's
access token is used only for the Storage upload, as that staff member; it is
never stored, logged or returned. Error responses are
{"detail": {"code": ..., "message": ...}} with a safe message.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import UploadFile

from app.core.auth import StaffIdentity, StaffSession, require_staff, require_staff_session
from app.course_equivalency import syllabus_service as service
from app.course_equivalency.syllabus_files import MAX_FILE_BYTES
from app.course_equivalency.syllabus_service import SyllabusServiceError

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/staff/course-equivalency", tags=["course-equivalency-syllabi"])

RequestId = Path(pattern=r"^STUD_EQVO_ECTU_[0-9]{6}$", max_length=21)
Side = Path(pattern=r"^(old|new)$")

# The file plus a generous allowance for the multipart envelope and the "replaces" field.
MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024
_ALLOWED_FIELDS = frozenset({"file", "replaces"})
_INVALID_FORM = "The upload form is invalid: send exactly one file in the field 'file'."


def _http(code: int, error: str, message: str) -> HTTPException:
    return HTTPException(code, {"code": error, "message": message})


def _from_service(exc: SyllabusServiceError) -> HTTPException:
    return _http(exc.status, exc.code, exc.message)


def _unavailable(exc: SQLAlchemyError) -> HTTPException:
    log.warning("Course Equivalency syllabi could not be read or registered (%s)", type(exc).__name__)
    return _http(503, "database_unavailable", "The database could not be reached. Try again shortly.")


@router.get("/{request_id}/syllabi")
def get_syllabi(request_id: str = RequestId, _staff: StaffIdentity = Depends(require_staff)) -> dict:
    try:
        return service.get_syllabi(request_id)
    except SyllabusServiceError as exc:
        raise _from_service(exc) from None
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from None


@router.post("/{request_id}/syllabi/{side}")
async def upload_syllabus(
    request: Request,
    request_id: str = RequestId,
    side: str = Side,
    session: StaffSession = Depends(require_staff_session),
) -> dict:
    declared = request.headers.get("content-length")
    if declared is None or not declared.strip().isdigit():
        raise _http(411, "length_required", "The upload size must be declared.")
    if int(declared) > MAX_BODY_BYTES:
        raise _http(413, "file_too_large", "The file is larger than 10 MB.")
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise _http(415, "invalid_form", "Send the file as multipart/form-data.")

    try:
        form = await request.form(max_files=1, max_fields=1, max_part_size=1024)
    except HTTPException as exc:
        raise _http(400, "invalid_form", _INVALID_FORM) from exc
    try:
        if set(form.keys()) - _ALLOWED_FIELDS or len(form.getlist("file")) > 1:
            raise _http(400, "invalid_form", _INVALID_FORM)
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise _http(422, "file_missing", "Choose a PDF or Word (.docx) file.")
        replaces = form.get("replaces")
        if replaces is not None and not isinstance(replaces, str):
            raise _http(400, "invalid_form", "'replaces' must be a text field.")
        data = await upload.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise _http(413, "file_too_large", "The file is larger than 10 MB.")
        try:
            return await run_in_threadpool(
                service.upload_syllabus, request_id=request_id, side=side, file_name=upload.filename,
                data=data, session=session, replaces=replaces)
        except SyllabusServiceError as exc:
            raise _from_service(exc) from None
        except SQLAlchemyError as exc:
            raise _unavailable(exc) from None
    finally:
        await form.close()
