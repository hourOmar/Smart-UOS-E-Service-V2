"""
Project-level exceptions for the Supabase retrieval layer.

These give the rest of the pipeline a clear, typed signal when required
evidence cannot be retrieved, instead of letting a raw postgrest/Supabase
exception (or a silently wrong None) propagate. Missing evidence must
raise, not turn into a guessed priority-relevant default.
"""


class RetrievalError(Exception):
    """Base class for all Supabase retrieval-layer errors."""


class RequestNotFoundError(RetrievalError):
    """No Request row exists for the given Request_ID."""


class InvalidRequestTypeError(RetrievalError):
    """The Request exists but is not a Raise Capacity request."""


class RaiseCapacityRecordNotFoundError(RetrievalError):
    """No Raise_Capacity row exists for the given Request_ID."""


class StudentNotFoundError(RetrievalError):
    """No Student row exists for the request's Student_ID."""


class ProgramNotFoundError(RetrievalError):
    """Student.Program_ID is set but no matching Program row exists."""


class CourseNotFoundError(RetrievalError):
    """No Course row exists for the requested Course_ID."""


class SectionMismatchError(RetrievalError):
    """
    No Section row exists for the requested Section_ID, or it exists but
    its Course_ID/Term do not match the Raise_Capacity record.
    """
