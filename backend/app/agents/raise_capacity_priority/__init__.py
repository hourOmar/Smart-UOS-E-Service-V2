"""Raise Capacity Request Prioritization Agent.

Given a Raise Capacity request, Python collects the evidence (database records,
the official UoS Computer Science degree page, the local knowledge base) and
computes every factual value; Gemini then assigns HIGH, MEDIUM, LOW or
MANUAL_REVIEW under the prioritization policy. Technical failures are errors,
never a priority. The result is staff-only and never changes a request.

Ported from the standalone prototype (a separate repository; initial commit
d10fe30). Prioritization rules, prompt, knowledge files and evidence logic are
unchanged, except:
- it reads through the backend's own database role (db_client.py) instead of
  supabase-py with the service_role key;
- the student's ID is not sent to Gemini (the justification still is);
- the UoS page is cached for an hour;
- Gemini is called through app.core.gemini, with the same optional fallback
  models (only after a temporary 429/503 error).
"""

AGENT_NAME = "raise_capacity_priority"
AGENT_VERSION = "1.0.0"
