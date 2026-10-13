"""
The complete Request Prioritization Agent: request_id in, validated result out.

    request_id
        -> build_prioritization_evidence(request_id, client)  (read-only transaction)
        -> load_prioritization_policy()
        -> get_priority_decision(evidence, policy)            (no transaction open)
        -> FinalAgentResult

Python assigns no priority anywhere in this file; the value returned is exactly
what Gemini decided.
"""

from dataclasses import dataclass

from app.core.database import read_only

from .db_client import DatabaseClient
from .pipeline.build_prioritization_evidence import build_prioritization_evidence
from .pipeline.get_priority_decision import get_priority_decision
from .pipeline.prioritization_policy import load_prioritization_policy
from .schemas.prioritization_evidence import PrioritizationEvidencePackage
from .schemas.priority_decision import FinalAgentResult


@dataclass(frozen=True)
class AgentOutcome:
    result: FinalAgentResult
    evidence: PrioritizationEvidencePackage
    model: str


def collect_evidence(request_id: str) -> PrioritizationEvidencePackage:
    with read_only() as conn:
        return build_prioritization_evidence(request_id, DatabaseClient(conn))


def prioritize_raise_capacity_request(request_id: str) -> AgentOutcome:
    evidence = collect_evidence(request_id)
    policy = load_prioritization_policy()
    decision, model = get_priority_decision(evidence, policy, context=f"request {request_id}")

    result = FinalAgentResult(
        request_id=request_id,
        priority=decision.priority,
        reasoning=decision.reasoning,
        factor_explanations=decision.factor_explanations,
        key_evidence=decision.key_evidence,
    )
    return AgentOutcome(result=result, evidence=evidence, model=model)
