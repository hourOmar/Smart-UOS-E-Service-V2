"""Output safeguard for the Incomplete Exam agents (agent 1.2.0).

Applied by workflow.py to Gemini-GENERATED TEXT only -- never to the
recommendation, the verified checks, the evidence, the prompts or the rules:

1. Agent 5 (staff-facing reasoning and per-check explanations), right after
   Gemini answers and BEFORE Agent 6 receives them:
   - identity: the student's known name and ID (and any UoS student number or
     e-mail address) are replaced ("the student", "[student ID]", "[email]");
   - document-verification wording: in sentences about a document, claims the
     agents cannot support (verified / authenticated / official / approved,
     documents that "confirm" or "prove") are rewritten neutrally ("supporting
     proof", "was reviewed", "states"); "matches the claim" (Gemini's own
     reading) becomes "appears consistent with the claim". A sentence about
     what the database verified (enrolment, Takes, submission window) is never
     rewritten.
2. Agent 6 (student-facing suggested reasons), after its own validation and
   BEFORE storage: a suggestion that still names the student, carries an ID or
   e-mail address, or claims (not negated) that a document was verified or
   authenticated is dropped -- like Agent 6's own unsupported-number rule. If
   none remain, Agent 6's own template reasons (built only from the verified
   keywords) are used. The staff-facing conflict note is cleaned like Agent 5.

Name parts are replaced only when unambiguous: at least 3 characters, not an
ordinary word, academic or policy term or name particle, and written as a
proper noun (capitalised or upper case). The full name is always replaced.
Only counts of the changes are recorded; the original text is not kept.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .rejection_explanation import _template_reasons

SAFEGUARD_VERSION = 1

STUDENT = "the student"
STUDENT_ID = "[student ID]"
EMAIL = "[email]"

_UOS_ID = re.compile(r"\bU\d{7,9}\b")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")

# Name particles and words that are also ordinary words, academic or policy
# terms: never replaced on their own (the full name still is).
_PARTICLES = {"al", "el", "bin", "bint", "ibn", "abu", "abd", "van", "von", "der", "den", "del", "della", "da",
              "de", "di", "du", "la", "le", "mac", "mc", "st"}
_ORDINARY = {
    # common English words that are also given names or surnames
    "hope", "grace", "faith", "joy", "may", "june", "april", "august", "will", "mark", "bill", "rose", "amber",
    "dawn", "summer", "winter", "rich", "sunny", "victory", "angel", "honey", "sky", "star", "king", "queen",
    "young", "long", "short", "white", "black", "brown", "green", "gray", "grey", "bell", "page", "hall", "hill",
    "wood", "stone", "field", "lane", "rice", "price", "cash", "case", "law", "lord", "major", "noble", "frank",
    "earnest", "ernest", "patience", "prudence", "chance", "ray", "sun", "moon", "day", "night", "light",
    "best", "good", "fair", "free", "love", "dear", "true", "said", "rule", "first", "last", "early",
    "small", "little", "big", "great", "new", "old", "north", "south", "east", "west", "reason", "proof",
    # academic and Incomplete Exam terms
    "exam", "final", "midterm", "course", "section", "term", "student", "grade", "credit", "request", "policy",
    "medical", "report", "certificate", "police", "accident", "travel", "emergency", "document", "documents",
    "health", "authority", "hospital", "clinic", "doctor", "university", "college", "sharjah", "dubai", "uae",
    "approve", "reject", "manual", "review", "valid", "invalid", "enrollment", "enrolment", "schedule",
}


def _policy_words() -> set[str]:
    """Every word of the (unchanged) knowledge files: never treated as a name part."""
    base = Path(__file__).resolve().parent / "knowledge_base"
    words: set[str] = set()
    for name in ("incomplete_exam_policy.json", "rejection_keywords.json"):
        text = json.dumps(json.loads((base / name).read_text("utf-8")))
        words.update(w.casefold() for w in re.findall(r"[^\W\d_]+", text))
    return words


_KNOWN_WORDS = _ORDINARY | _PARTICLES | _policy_words()

# -- document-verification wording -------------------------------------------------

_DOC_NOUN = (r"document|documents|documentation|certificate|certificates|report|reports|letter|letters|"
             r"proof|proofs|evidence|file|files|attachment|attachments|itinerary|itineraries|screenshot|"
             r"screenshots|note|notes|statement|statements|confirmation|booking|pdf|pdfs")
_DOC_SENTENCE = re.compile(rf"(?i)\b(?:{_DOC_NOUN}|attached|uploaded|facility|hospital|clinic)\b")
# Sentences about what the database / deterministic checks verified are kept.
_DATABASE_SENTENCE = re.compile(r"(?i)\benrol|\btakes\b|\bsubmission window\b|\bworking days?\b|\bdatabase\b")

_CLAIM_ADJ = (r"(?:independently\s+|officially\s+|fully\s+)?"
              r"(?:verified|authenticated|validated|certified|official|genuine|authentic|approved)")
# What a claim adjective must qualify to be removed: a document, health, police
# or travel word, or a capitalised name ("Dubai Health Authority").
_QUALIFIED = (rf"(?=[A-Z]|(?i:(?:{_DOC_NOUN}|medical|healthcare|health|police|traffic|travel|flight|hospital|"
              r"clinic|facility|issuing|government)\b))")

_REWRITES: list[tuple[re.Pattern, object]] = [
    # "verified proof" / "authenticated evidence" -> "supporting proof"
    (re.compile(rf"(?i)\b{_CLAIM_ADJ}\s+(proof|evidence|documentation)\b"), lambda m: f"supporting {m.group(1)}"),
    # "is/are verified|authenticated|validated" -> "was/were reviewed" (before the adjective rule)
    (re.compile(r"(?i)\b(is|are|was|were|has been|have been)\s+(?:independently\s+|fully\s+)?"
                r"(?:verified|authenticated|validated)\b"),
     lambda m: "were reviewed" if m.group(1).lower() in ("are", "were", "have been") else "was reviewed"),
    # "is/are genuine|authentic" -> "appears/appear genuine" (a hedged reading)
    (re.compile(r"(?i)\b(is|are)\s+(genuine|authentic)\b"),
     lambda m: f"{'appear' if m.group(1).lower() == 'are' else 'appears'} {m.group(2)}"),
    # "a/an authenticated medical report" -> "a medical report" (article re-chosen)
    (re.compile(rf"\b([Aa]n?)\s+(?i:{_CLAIM_ADJ})\s+{_QUALIFIED}(\w+)"),
     lambda m: f"{_article(m.group(1), m.group(2))} {m.group(2)}"),
    # remaining qualifying claim adjectives: "the official Medical Certificate"
    (re.compile(rf"(?i:\b{_CLAIM_ADJ})\s+{_QUALIFIED}"), ""),
    # "verifiably" -> removed
    (re.compile(r"(?i)\bverifiably\s+"), ""),
    # a document that "confirms/proves/verifies/establishes" -> "states"
    (re.compile(rf"(?i)\b({_DOC_NOUN}|it|they|which)\s+(confirm|prove|verify|establish|validate)(s?)\b"),
     lambda m: f"{m.group(1)} state{m.group(3)}"),
    (re.compile(rf"(?i)\b({_DOC_NOUN}|it|they|which)\s+(confirmed|proved|verified|established|validated)\b"),
     lambda m: f"{m.group(1)} stated"),
    # "match(es) the claim" -> "appear(s) consistent with the claim" (Gemini's own reading)
    (re.compile(r"(?i)\b(match|matches|corroborate|corroborates)\s+the\s+(claim|stated reason|reason)\b"),
     lambda m: f"{'appears' if m.group(1).lower().endswith('s') else 'appear'} consistent with the {m.group(2)}"),
]

# A claim Agent 6 (student-facing) may not make; negated forms ("could not be
# verified") are allowed.
_CLAIM_WORD = re.compile(r"(?i)\b(verified|authenticated|validated|authentic|genuine|certified|official|officially)\b")
_NEGATION = re.compile(r"(?i)^(not|cannot|can't|couldn't|unable|no|never|without)$|n't$")


def _article(original: str, following: str) -> str:
    article = "an" if following[:1].lower() in "aeiou" else "a"
    return article.capitalize() if original[:1].isupper() else article


def _capitalise_sentence_starts(text: str) -> str:
    return re.sub(r"(^|[.!?:]\s+)the student\b", lambda m: m.group(1) + "The student", text)


@dataclass
class SafeguardReport:
    identity_replacements: int = 0
    verification_rewrites: int = 0
    suggestions_dropped: int = 0
    dropped_reasons: list[str] = field(default_factory=list)   # why, never the text

    def as_dict(self) -> dict:
        return {"version": SAFEGUARD_VERSION, "identity_replacements": self.identity_replacements,
                "verification_rewrites": self.verification_rewrites,
                "suggestions_dropped": self.suggestions_dropped, "dropped_reasons": list(self.dropped_reasons)}


class OutputSafeguard:
    def __init__(self, student_name: str | None, student_id: str | None):
        self.report = SafeguardReport()
        self._id = (student_id or "").strip()
        name = " ".join((student_name or "").split())
        forms = self.part_forms(name)
        self._full_name = self._full_name_pattern(name, ambiguous_only=not forms) if name else None
        self._parts = [re.compile(rf"(?<!\w){re.escape(form)}(?!\w)") for form in forms]

    @staticmethod
    def _full_name_pattern(name: str, ambiguous_only: bool) -> re.Pattern:
        """The whole name, any spacing. Case-insensitive when it has an
        unambiguous part; a name made only of ordinary words ("Mark Will")
        matches only in proper-noun form, so "the mark will" is kept."""
        parts = name.split(" ")
        if not ambiguous_only:
            return re.compile(r"(?i)(?<!\w)" + r"\s+".join(re.escape(p) for p in parts) + r"(?!\w)")
        title = r"\s+".join(re.escape(p[:1].upper() + p[1:].lower()) for p in parts)
        upper = r"\s+".join(re.escape(p.upper()) for p in parts)
        return re.compile(rf"(?<!\w)(?:{title}|{upper})(?!\w)")

    @staticmethod
    def part_forms(name: str) -> list[str]:
        """Proper-noun forms of the unambiguous name parts (longest first)."""
        forms: set[str] = set()
        for part in name.split(" "):
            core = part.strip("-'’.,")
            if len(core) < 3 or core.casefold() in _KNOWN_WORDS or not any(ch.isalpha() for ch in core):
                continue
            if core[:1].lower() != core[:1].upper():          # cased script (e.g. Latin)
                forms.update({core[:1].upper() + core[1:].lower(), core.upper(), core})
            else:                                             # uncased script (e.g. Arabic)
                forms.add(core)
        return sorted(forms, key=lambda form: (-len(form), form))

    # -- identity ------------------------------------------------------------------

    def _sub(self, pattern: re.Pattern, replacement: str, text: str) -> str:
        new, n = pattern.subn(replacement, text)
        self.report.identity_replacements += n
        return new

    def _id_pattern(self) -> re.Pattern | None:
        return re.compile(rf"(?<!\w){re.escape(self._id)}(?!\w)") if self._id else None

    def redact_identity(self, text: str) -> str:
        id_pattern = self._id_pattern()
        if id_pattern is not None:
            text = self._sub(id_pattern, STUDENT_ID, text)
        text = self._sub(_UOS_ID, STUDENT_ID, text)
        text = self._sub(_EMAIL, EMAIL, text)
        if self._full_name is not None:
            text = self._sub(self._full_name, STUDENT, text)
        for part in self._parts:
            text = self._sub(part, STUDENT, text)
        text = re.sub(r"(?i)\bthe student(?:\s+the student)+\b", STUDENT, text)   # parts of one name
        return _capitalise_sentence_starts(text)

    def contains_identity(self, text: str) -> bool:
        id_pattern = self._id_pattern()
        if id_pattern is not None and id_pattern.search(text):
            return True
        if _UOS_ID.search(text) or _EMAIL.search(text):
            return True
        if self._full_name is not None and self._full_name.search(text):
            return True
        return any(part.search(text) for part in self._parts)

    # -- document-verification wording ------------------------------------------------

    def neutralise_verification(self, text: str) -> str:
        out = []
        for sentence in _SENTENCE.split(text):
            if _DOC_SENTENCE.search(sentence) and not _DATABASE_SENTENCE.search(sentence):
                for pattern, replacement in _REWRITES:
                    sentence, n = pattern.subn(replacement, sentence)
                    self.report.verification_rewrites += n
                sentence = re.sub(r"[ \t]{2,}", " ", sentence)
            out.append(sentence)
        return " ".join(out)

    def clean_text(self, text):
        if not isinstance(text, str) or not text:
            return text
        return self.neutralise_verification(self.redact_identity(text))

    def claims_verification(self, text: str) -> bool:
        for sentence in _SENTENCE.split(text):
            for match in _CLAIM_WORD.finditer(sentence):
                before = sentence[:match.start()].split()[-4:]
                if not any(_NEGATION.search(word.strip(",;:")) for word in before):
                    return True
        return False

    # -- the two agents ----------------------------------------------------------------

    def clean_agent5(self, agent5: dict) -> dict:
        """Agent 5's result with its generated text cleaned; the recommendation,
        evidence and status fields are returned unchanged."""
        checks = agent5.get("checks") or {}
        return {**agent5, "reasoning": self.clean_text(agent5.get("reasoning")),
                "checks": {key: self.clean_text(value) for key, value in checks.items()}}

    def check_agent6(self, agent6: dict) -> dict:
        """Agent 6's result with unsafe suggestions dropped (its own template
        fallback if none remain) and its staff-facing conflict note cleaned."""
        if agent6.get("status") == "not_applicable":
            return agent6
        original = agent6.get("suggested_reasons") or []
        kept = []
        for suggestion in original:
            text = suggestion.get("text", "") if isinstance(suggestion, dict) else ""
            if self.contains_identity(text):
                self.report.dropped_reasons.append("identity")
            elif self.claims_verification(text):
                self.report.dropped_reasons.append("verification_claim")
            else:
                kept.append(suggestion)
                continue
            self.report.suggestions_dropped += 1
        result = {**agent6, "suggested_reasons": kept,
                  "conflict_note": self.clean_text(agent6.get("conflict_note") or "")}
        if original and not kept:
            templates = _template_reasons(agent6.get("deterministic_keywords") or [])
            result["suggested_reasons"] = templates
            result["status"] = "fallback" if templates else "needs_manual_explanation"
            result["gemini_error"] = agent6.get("gemini_error") or "No suggested reason passed the output safeguard."
        return result
