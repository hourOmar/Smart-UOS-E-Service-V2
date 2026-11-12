"""Errors of the Course Substitution agent.

Request-level errors (raised before any check or Gemini call, and before
anything is stored): RequestNotFoundError, NotCourseSubstitutionRequestError,
CourseSubstitutionDetailsMissingError.

Data errors (about the request's own records; failure_kind 'data'):
EmptyRequestIdError, StudentNotFoundError, CourseNotFoundError.

Technical errors come from app.core (GeminiUnavailableError,
DatabaseUnavailableError) plus InvalidEligibilityResultError. Messages never
contain student data.
"""


class CourseSubstitutionAgentError(Exception):
    """Base class for errors raised deliberately by this agent."""


class EmptyRequestIdError(CourseSubstitutionAgentError):
    """The request ID is empty (the standalone ValueError)."""


class RequestNotFoundError(CourseSubstitutionAgentError):
    """No Request row has this ID."""


class NotCourseSubstitutionRequestError(CourseSubstitutionAgentError):
    """The request exists but is not a Course Substitution request."""


class CourseSubstitutionDetailsMissingError(CourseSubstitutionAgentError):
    """A Course Substitution request with no Course_Substitution row: the
    'details missing' state. Nothing can be evaluated, so no evaluation runs."""


class StudentNotFoundError(CourseSubstitutionAgentError):
    """The request's Student_ID has no Student row."""


class CourseNotFoundError(CourseSubstitutionAgentError):
    """The original or proposed course has no Course row."""


class InvalidEligibilityResultError(CourseSubstitutionAgentError):
    """The rejection step's input is not a usable eligibility result
    (the standalone tools/rejection_input_tools error)."""


class RunInProgressError(CourseSubstitutionAgentError):
    """A rerun was requested while another run for the request is still running."""


class RerunNotAllowedError(CourseSubstitutionAgentError):
    """A rerun was requested for a request that is no longer In Progress."""
