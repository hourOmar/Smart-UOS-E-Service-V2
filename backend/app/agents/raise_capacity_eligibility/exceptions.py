class AgentError(Exception):
    """An error the agent raises deliberately; its message is safe to show to staff."""


class RequestNotFoundError(AgentError):
    pass


class NotRaiseCapacityRequestError(AgentError):
    pass


class StudentNotFoundError(AgentError):
    pass


class CourseNotFoundError(AgentError):
    pass


class SectionNotFoundError(AgentError):
    pass


class SectionCourseMismatchError(AgentError):
    pass


class KnowledgeBaseError(AgentError):
    pass


class PrerequisiteSourceUnavailableError(AgentError):
    """The UoS page could not be fetched or parsed. Converted into verified=False
    evidence, never allowed to abort the evaluation."""
