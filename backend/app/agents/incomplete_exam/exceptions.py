"""Errors of the Incomplete Exam agents.

Request-level errors (raised before anything is stored or any Storage or
Gemini call): RequestNotFoundError, NotIncompleteExamRequestError,
IncompleteExamDetailsMissingError.

Data errors (about the request's own records; failure_kind 'data'):
StudentNotFoundError and the ProofDataError family.

Technical errors come from app.core (GeminiUnavailableError, StorageError,
DatabaseUnavailableError) plus InvalidRecommendationError. Messages never
contain student data, tokens or file contents.
"""


class IncompleteExamAgentError(Exception):
    """Base class for errors raised deliberately by these agents."""


class RequestNotFoundError(IncompleteExamAgentError):
    """No Request row has this ID."""


class NotIncompleteExamRequestError(IncompleteExamAgentError):
    """The request exists but is not an Incomplete Exam request."""


class IncompleteExamDetailsMissingError(IncompleteExamAgentError):
    """An Incomplete Exam request with no Incomplete_Exam row: the 'details
    missing' state. Nothing can be evaluated, so no evaluation runs."""


class StudentNotFoundError(IncompleteExamAgentError):
    """The request's Student_ID has no Student row."""


class ProofDataError(IncompleteExamAgentError):
    """The request's proof documents cannot be used as recorded."""


class ProofPathError(ProofDataError):
    """A stored proof path is not <Request_ID>/<file> for this request."""


class ProofFileMissingError(ProofDataError):
    """A listed proof file is not in Storage (or not visible to staff)."""


class ProofTooLargeError(ProofDataError):
    """The proof documents together exceed the total size Gemini can receive."""


class InvalidAgent5ResultError(IncompleteExamAgentError):
    """Agent 6 (rejection explanation): the input is not a usable Agent 5 result."""


class InvalidRecommendationError(IncompleteExamAgentError):
    """Gemini returned a recommendation outside APPROVE / REJECT / MANUAL_REVIEW."""


class RunInProgressError(IncompleteExamAgentError):
    """A rerun was requested while another run for the request is still running."""


class RerunNotAllowedError(IncompleteExamAgentError):
    """A rerun was requested for a request that is no longer In Progress."""
