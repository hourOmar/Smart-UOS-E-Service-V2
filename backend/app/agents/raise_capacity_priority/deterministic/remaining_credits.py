"""
remaining_credits = total_required_credits - completed_hours

Both inputs can be missing (nullable Completed_Hours; unverified UoS
total), in which case the result is UNRESOLVED rather than defaulting to
0. If completed hours exceed the total required, the (negative) value is
preserved and flagged ANOMALY rather than clamped to zero — clamping
would silently hide a data problem worth reviewing.
"""

from typing import Optional

from ..schemas.deterministic import RemainingCreditsEvidence


def calculate_remaining_credits(
    completed_hours: Optional[int], total_required_credits: Optional[int]
) -> RemainingCreditsEvidence:
    if completed_hours is None or total_required_credits is None:
        missing = []
        if completed_hours is None:
            missing.append("Student.Completed_Hours")
        if total_required_credits is None:
            missing.append("verified UoS total_required_credits")
        return RemainingCreditsEvidence(
            completed_hours=completed_hours,
            total_required_credits=total_required_credits,
            remaining_credits=None,
            status="UNRESOLVED",
            note=f"Missing input(s): {', '.join(missing)}.",
        )

    remaining = total_required_credits - completed_hours

    if remaining < 0:
        return RemainingCreditsEvidence(
            completed_hours=completed_hours,
            total_required_credits=total_required_credits,
            remaining_credits=remaining,
            status="ANOMALY",
            note=(
                "Completed_Hours exceeds total_required_credits; the "
                "negative value is preserved rather than clamped to zero "
                "so this can be reviewed."
            ),
        )

    return RemainingCreditsEvidence(
        completed_hours=completed_hours,
        total_required_credits=total_required_credits,
        remaining_credits=remaining,
        status="OK",
        note=None,
    )
