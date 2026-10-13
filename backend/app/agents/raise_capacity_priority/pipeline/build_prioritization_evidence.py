"""
Phase 5: assembles the final PrioritizationEvidencePackage for one
Raise Capacity request. This is an evidence-BUILDING layer, not a
decision layer — nothing here calls Gemini, computes a score, or
produces HIGH/MEDIUM/LOW.

Two functions, deliberately split:

- assemble_prioritization_evidence(...) is a pure function of data
  already retrieved (Phase 2 SupabaseEvidence, Phase 3 UoSCourseEvidence,
  Phase 4 DeterministicEvidence). No I/O, easy to unit test.
- build_prioritization_evidence(request_id, ...) is the orchestrator:
  it calls the existing Phase 2/3/4 retrieval and calculation functions
  (never reimplementing their logic) and passes the results to the pure
  assembler.

Design choice — the prioritization policy is NOT embedded in this
package. app/pipeline/prioritization_policy.py loads it separately.
Reasons:
  1. The original Phase 1 architecture describes Gemini receiving
     "evidence + prioritization policy" as two distinct inputs, not one
     merged object.
  2. The policy is static and student-independent; embedding a copy of
     it inside every per-student evidence package would be redundant
     and would blur "facts about this request" with "general decision
     policy" in the same JSON tree — exactly the mixing Phase 5 is
     meant to avoid.
  3. Keeping them separate makes it trivial to confirm the policy was
     never silently rewritten (it is loaded byte-for-byte from JSON,
     independent of any per-request evidence).

Error handling: a request that cannot be identified at all (unknown
Request_ID, wrong request type, missing Raise_Capacity/Student/Program/
Course/Section rows, or the UoS page being entirely unreachable/
unparseable) is a FATAL failure — the existing typed exceptions from
Phase 2/3 are allowed to propagate unmodified, not caught here.
Legitimately missing/unresolved academic evidence (null
Expected_Graduation_Term, a course missing from the offerings KB, a
UoS prerequisite conflict, ...) is NOT fatal — the package still
builds, with that evidence explicitly marked missing/unresolved/
conflicting in evidence_quality.
"""

from typing import Any, Optional

from ..deterministic.evidence import build_deterministic_evidence
from ..deterministic.prerequisite_evaluator import required_prerequisite_course_ids
from ..deterministic.term import calculate_terms_until_graduation, parse_term
from ..retrieval.evidence import get_supabase_evidence
from ..retrieval.prerequisite_history import get_takes_for_courses
from ..retrieval.uos_academic_info import get_uos_course_evidence
from ..schemas.deterministic import DeterministicEvidence
from ..schemas.evidence import SupabaseEvidence
from ..schemas.prioritization_evidence import (
    EvidenceQualitySummary,
    GraduationEvidence,
    PrioritizationEvidencePackage,
    RequestContext,
)
from ..schemas.uos import UoSCourseEvidence


def build_prioritization_evidence(
    request_id: str, client: Any
) -> PrioritizationEvidencePackage:
    # Ported: `client` is required (a read-only database client, see
    # ../db_client.py); there is no Supabase client default.
    supabase_evidence = get_supabase_evidence(request_id, client=client)
    uos_evidence = get_uos_course_evidence(supabase_evidence.raise_capacity.course_id)

    required_course_ids = required_prerequisite_course_ids(uos_evidence.prerequisites)
    prerequisite_takes_records = get_takes_for_courses(
        client, supabase_evidence.student.student_id, required_course_ids
    )

    deterministic_evidence = build_deterministic_evidence(
        supabase_evidence, uos_evidence, prerequisite_takes_records
    )

    return assemble_prioritization_evidence(supabase_evidence, uos_evidence, deterministic_evidence)


def assemble_prioritization_evidence(
    supabase_evidence: SupabaseEvidence,
    uos_evidence: UoSCourseEvidence,
    deterministic_evidence: DeterministicEvidence,
) -> PrioritizationEvidencePackage:
    request_context = _build_request_context(supabase_evidence)
    graduation = _build_graduation_evidence(supabase_evidence)
    evidence_quality = _build_evidence_quality(graduation, deterministic_evidence, uos_evidence)

    return PrioritizationEvidencePackage(
        request_context=request_context,
        graduation=graduation,
        degree_progress=deterministic_evidence.remaining_credits,
        requested_course_requirement=uos_evidence.category,
        course_availability=deterministic_evidence.requested_course_offering,
        previous_attempts=deterministic_evidence.previous_attempt_summary,
        prerequisite_completion=deterministic_evidence.prerequisite_completion,
        progression=deterministic_evidence.progression_evidence,
        evidence_quality=evidence_quality,
    )


def _build_request_context(supabase_evidence: SupabaseEvidence) -> RequestContext:
    return RequestContext(
        request_id=supabase_evidence.request.request_id,
        student_id=supabase_evidence.student.student_id,
        request_term=supabase_evidence.raise_capacity.term,
        course_id=supabase_evidence.raise_capacity.course_id,
        course_name=supabase_evidence.course.course_name,
        section_id=supabase_evidence.raise_capacity.section_id,
        reason=supabase_evidence.raise_capacity.reason,
    )


def _build_graduation_evidence(supabase_evidence: SupabaseEvidence) -> GraduationEvidence:
    request_term = supabase_evidence.raise_capacity.term
    expected = supabase_evidence.student.expected_graduation_term
    same_as_expected = request_term == expected if expected is not None else None

    including_summer: Optional[int] = None
    excluding_summer: Optional[int] = None
    if expected is not None:
        distances = calculate_terms_until_graduation(request_term, expected)
        if distances is not None:
            including_summer, excluding_summer = distances

    return GraduationEvidence(
        request_term=request_term,
        expected_graduation_term=expected,
        same_as_expected_graduation_term=same_as_expected,
        terms_until_graduation_including_summer=including_summer,
        terms_until_graduation_excluding_summer=excluding_summer,
    )


def _build_evidence_quality(
    graduation: GraduationEvidence,
    deterministic_evidence: DeterministicEvidence,
    uos_evidence: UoSCourseEvidence,
) -> EvidenceQualitySummary:
    issues: list[str] = []
    has_missing = False
    has_conflicting = False

    if graduation.expected_graduation_term is None:
        has_missing = True
        issues.append("Student's Expected_Graduation_Term is missing.")
    elif graduation.terms_until_graduation_including_summer is None:
        if parse_term(graduation.request_term) is None:
            has_missing = True
            issues.append(
                "Could not calculate terms until graduation: request Term "
                f"{graduation.request_term} has an unsupported semester suffix."
            )
        elif parse_term(graduation.expected_graduation_term) is None:
            has_missing = True
            issues.append(
                "Could not calculate terms until graduation: "
                f"Expected_Graduation_Term {graduation.expected_graduation_term} "
                "has an unsupported semester suffix."
            )
        else:
            has_conflicting = True
            issues.append(
                f"Expected_Graduation_Term ({graduation.expected_graduation_term}) "
                f"is chronologically before the request term "
                f"({graduation.request_term}); terms-until-graduation could not "
                "be calculated."
            )

    remaining = deterministic_evidence.remaining_credits
    if remaining.status == "UNRESOLVED":
        has_missing = True
        issues.append(f"Remaining credits could not be calculated: {remaining.note}")
    elif remaining.status == "ANOMALY":
        has_conflicting = True
        issues.append(f"Remaining-credits calculation is anomalous: {remaining.note}")

    if not uos_evidence.category.found:
        has_missing = True
        issues.append(
            "Requested course was not found in the official UoS Degree "
            "Requirements categories."
        )

    offering = deterministic_evidence.requested_course_offering
    if not offering.found_in_kb:
        has_missing = True
        issues.append(
            "Requested course was not found in the local course-offerings "
            "knowledge base."
        )
    if not offering.term_suffix_supported:
        has_missing = True
        issues.append(
            "Request Term suffix is not a supported semester code (01/02/03); "
            "next-semester evidence is unresolved."
        )

    prereq = deterministic_evidence.prerequisite_completion
    if prereq.status == "UNRESOLVED":
        has_missing = True
        issues.append(f"Prerequisite completion could not be determined: {prereq.reason}")
    elif prereq.status == "CONFLICT":
        has_conflicting = True
        issues.append(
            "Official UoS prerequisite sources conflict: "
            f"{prereq.uos_conflict_reason or prereq.reason}"
        )

    progression = deterministic_evidence.progression_evidence
    if progression.dependent_courses_missing_from_offerings_kb > 0:
        has_missing = True
        issues.append(
            f"{progression.dependent_courses_missing_from_offerings_kb} dependent "
            "course(s) are missing from the local course-offerings knowledge base."
        )

    return EvidenceQualitySummary(
        has_missing_evidence=has_missing,
        has_conflicting_evidence=has_conflicting,
        issues=issues,
    )
