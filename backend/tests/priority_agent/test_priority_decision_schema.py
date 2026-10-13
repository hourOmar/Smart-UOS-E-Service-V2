import pytest
from pydantic import ValidationError

from app.agents.raise_capacity_priority.schemas.priority_decision import FactorExplanations, PriorityDecision


def _factor_explanations(**overrides):
    defaults = dict(
        graduation="g",
        degree_progress="d",
        course_requirement="c",
        course_availability="a",
        previous_attempts="p",
        prerequisite="pr",
        progression="prog",
    )
    defaults.update(overrides)
    return defaults


# 1-4. Each allowed priority accepted
@pytest.mark.parametrize("priority", ["HIGH", "MEDIUM", "LOW", "MANUAL_REVIEW"])
def test_allowed_priority_accepted(priority):
    decision = PriorityDecision(
        priority=priority,
        reasoning="Because of the evidence.",
        factor_explanations=FactorExplanations(**_factor_explanations()),
    )
    assert decision.priority == priority


# 5. Invalid priority rejected
def test_invalid_priority_rejected():
    with pytest.raises(ValidationError):
        PriorityDecision(
            priority="URGENT",
            reasoning="Because of the evidence.",
            factor_explanations=FactorExplanations(**_factor_explanations()),
        )


# 6. Missing reasoning rejected
def test_missing_reasoning_rejected():
    with pytest.raises(ValidationError):
        PriorityDecision(
            priority="HIGH",
            factor_explanations=FactorExplanations(**_factor_explanations()),
        )


def test_empty_reasoning_rejected():
    with pytest.raises(ValidationError):
        PriorityDecision(
            priority="HIGH",
            reasoning="",
            factor_explanations=FactorExplanations(**_factor_explanations()),
        )


# 7. Missing factor explanation rejected
def test_missing_factor_explanation_rejected():
    incomplete = _factor_explanations()
    del incomplete["progression"]
    with pytest.raises(ValidationError):
        FactorExplanations(**incomplete)


def test_empty_factor_explanation_rejected():
    with pytest.raises(ValidationError):
        FactorExplanations(**_factor_explanations(graduation=""))


def test_valid_response_json_parses_via_model_validate_json():
    import json

    payload = {
        "priority": "MEDIUM",
        "reasoning": "Because of the evidence.",
        "factor_explanations": _factor_explanations(),
        "key_evidence": ["Remaining credits: 33"],
    }
    decision = PriorityDecision.model_validate_json(json.dumps(payload))
    assert decision.priority == "MEDIUM"
    assert decision.key_evidence == ["Remaining credits: 33"]
