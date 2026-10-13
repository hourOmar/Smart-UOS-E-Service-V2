"""Raise Capacity Academic Eligibility Evaluation Agent.

Given a Raise Capacity request, Python collects verified evidence (prerequisite,
completed hours, capacity) and Gemini applies fixed decision rules to recommend
APPROVE, REJECT or MANUAL_REVIEW. The recommendation is advisory: it never changes
a request.

Ported from the standalone prototype (a separate repository, not part of this
project; initial commit 83242a0) with its rules unchanged, except:
- completed-hours lookup normalizes Course_ID (text in the database, integer in the
  knowledge base), so configured rules are actually applied;
- missing completed hours are unresolved evidence (MANUAL_REVIEW), not a crash;
- the UoS prerequisite page cache expires;
- the student's identity is not sent to Gemini;
- the Computer Science-only prerequisite source is stated in the evidence.
"""

AGENT_NAME = "raise_capacity_eligibility"
AGENT_VERSION = "1.0.0"
