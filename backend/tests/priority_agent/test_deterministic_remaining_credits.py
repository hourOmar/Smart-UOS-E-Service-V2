from app.agents.raise_capacity_priority.deterministic.remaining_credits import calculate_remaining_credits


def test_normal_subtraction():
    evidence = calculate_remaining_credits(completed_hours=90, total_required_credits=123)
    assert evidence.remaining_credits == 33
    assert evidence.status == "OK"


def test_missing_completed_hours_is_unresolved():
    evidence = calculate_remaining_credits(completed_hours=None, total_required_credits=123)
    assert evidence.remaining_credits is None
    assert evidence.status == "UNRESOLVED"


def test_missing_total_required_credits_is_unresolved():
    evidence = calculate_remaining_credits(completed_hours=90, total_required_credits=None)
    assert evidence.remaining_credits is None
    assert evidence.status == "UNRESOLVED"


def test_completed_hours_exceeding_total_is_anomaly_not_clamped():
    evidence = calculate_remaining_credits(completed_hours=130, total_required_credits=123)
    assert evidence.remaining_credits == -7
    assert evidence.status == "ANOMALY"
