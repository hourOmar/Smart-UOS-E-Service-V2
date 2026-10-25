class RequestNotFoundError(Exception):
    """No Request row has this ID."""


class NotProgramChangeRequestError(Exception):
    """The request exists but is not a Program Change request."""


class RunInProgressError(Exception):
    """A rerun was requested while another run for the request is still running."""


class RerunNotAllowedError(Exception):
    """A rerun was requested for a request that is no longer In Progress."""
