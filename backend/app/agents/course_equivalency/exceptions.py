"""Errors of the Course Equivalency agents.

Request-level (raised before anything is stored, or any Storage / Gemini call):
RequestNotFoundError, NotCourseEquivalencyRequestError,
CourseEquivalencyDetailsMissingError, SyllabiMissingError.

Data errors (about the request's own records; failure_kind 'data'):
StudentNotFoundError, CourseNotFoundError and the SyllabusDataError family.

Technical errors come from app.core (GeminiUnavailableError, StorageError,
DatabaseUnavailableError) plus KnowledgeBaseError. Messages never contain
student data, tokens or file contents.
"""


class CourseEquivalencyAgentError(Exception):
    """Base class for errors raised deliberately by these agents."""


class RequestNotFoundError(CourseEquivalencyAgentError):
    """No Request row has this ID."""


class NotCourseEquivalencyRequestError(CourseEquivalencyAgentError):
    """The request exists but is not a Course Equivalency request."""


class CourseEquivalencyDetailsMissingError(CourseEquivalencyAgentError):
    """A Course Equivalency request without its Course_Equivalency row."""


class SyllabiMissingError(CourseEquivalencyAgentError):
    """The old-course or new-course syllabus is not registered (or its file is gone)."""


class StudentNotFoundError(CourseEquivalencyAgentError):
    """The request's Student_ID has no Student row."""


class CourseNotFoundError(CourseEquivalencyAgentError):
    """The requested (new) course is not in the Course catalog."""


class KnowledgeBaseError(CourseEquivalencyAgentError):
    """A knowledge-base file is missing or malformed."""


class DocumentReadError(CourseEquivalencyAgentError):
    """A syllabus has no readable text (the standalone treats it as 'not readable', not as a failure)."""


class SyllabusDataError(CourseEquivalencyAgentError):
    """A registered syllabus cannot be used as recorded."""


class SyllabusFileMissingError(SyllabusDataError):
    """A registered syllabus file is not in Storage (or not visible to staff)."""


class SyllabusIntegrityError(SyllabusDataError):
    """The downloaded file differs from its registration (size, SHA-256 or type)."""


class SyllabusInvalidError(SyllabusDataError):
    """The downloaded file fails the content checks (not a valid PDF / DOCX)."""


class RunInProgressError(CourseEquivalencyAgentError):
    """A rerun was requested while another run for the request is still running."""


class RerunNotAllowedError(CourseEquivalencyAgentError):
    """A rerun was requested for a request that is no longer In Progress."""
