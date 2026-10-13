"""
Project-level exceptions for the UoS retrieval layer.

These are for STRUCTURAL failures only — the page could not be reached,
or an expected top-level section (Degree Requirements, Study Plan) is
entirely missing so nothing in it can be parsed. Per-item uncertainty
(a specific course not found, total credits not found, conflicting
prerequisite text) is represented as explicit fields on the returned
evidence models instead of an exception, because that uncertainty is
itself useful evidence for a later phase, not a pipeline failure.
"""


class UoSRetrievalError(Exception):
    """Base class for all UoS retrieval-layer errors."""


class UoSPageStructureError(UoSRetrievalError):
    """An expected top-level section of the page (e.g. Degree
    Requirements, Study Plan) could not be located — the page structure
    has likely changed since this parser was written."""
