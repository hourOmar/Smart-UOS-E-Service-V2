"""Program Change Eligibility Agent.

Given a Program Change request, Python reads the request, finds the requested
program's official study plan (Gemini reads the UoS page), computes CGPA and
applicable credit hours deterministically, and Gemini writes the academic
assessment ending in APPROVE, REJECT or REQUIRES_REVIEW. The recommendation is
advisory: it never changes a request.

Ported from Shaikha's standalone agent (a separate repository; commit a4dbfe3).
Unchanged: the prompts in evidence.py and eligibility_agent.py, and the files
in data/. Changes:
- eligibility_agent.extract_recommendation tolerates Markdown, a
  "Recommendation:" label, letter case, a final full stop and "REQUIRES
  REVIEW", and fails on contradictory or unsupported values (1.2.0; the
  three values are unchanged; to be synchronized);
- eligibility_checks.is_completed_grade treats a missing or blank grade (NULL
  in Takes: course in progress) as not completed instead of raising (1.0.1;
  to be synchronized with the standalone repository);
- eligibility_checks defines MIN_CGPA (2.0) and MIN_APPLICABLE_HOURS (15),
  both inclusive, and run_basic_checks also returns min_cgpa,
  min_applicable_hours and applicable_hours_eligible (1.1.0; the prompt reads
  only its original keys, so its text is unchanged; to be synchronized);
- request_data.py replaces database.py: the request is read directly through
  the backend's own database role (app.core.database), in the same JSON shape
  the Supabase RPC get_program_change_request returned; the RPC is not used;
- llm_client.py keeps the same models, order and fallback rule, but calls
  Gemini through app.core.gemini (shared client, sanitized errors, logging
  instead of print);
- imports are package-relative.

Phase 1 only: no run history, API route or frontend yet, and the backend role
cannot read Program_Change until its grant is installed (see request_data.py).
"""

AGENT_NAME = "program_change_eligibility"
AGENT_VERSION = "1.2.0"
