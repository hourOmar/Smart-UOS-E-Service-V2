from app.agents.raise_capacity_priority.retrieval.prerequisite_history import get_takes_for_courses
from priority_agent.fakes import FakeSupabaseClient


def test_get_takes_for_courses_returns_matching_records():
    client = FakeSupabaseClient(
        {
            "Takes": [
                {"Student_ID": "S1", "Course_ID": 1501116, "Grade": "A", "Section_ID": "1", "Term": 202501},
                {"Student_ID": "S1", "Course_ID": 1501211, "Grade": "B", "Section_ID": "2", "Term": 202502},
                {"Student_ID": "S1", "Course_ID": 1501215, "Grade": "C", "Section_ID": "3", "Term": 202601},
                {"Student_ID": "S2", "Course_ID": 1501116, "Grade": "A", "Section_ID": "1", "Term": 202501},
            ]
        }
    )

    records = get_takes_for_courses(client, "S1", {1501116, 1501211})

    ids = {r.course_id for r in records}
    assert ids == {1501116, 1501211}
    assert all(r.grade in ("A", "B") for r in records)


def test_get_takes_for_courses_empty_course_ids_returns_empty_without_querying():
    client = FakeSupabaseClient({"Takes": [{"Student_ID": "S1", "Course_ID": 1, "Grade": "A", "Section_ID": "1", "Term": 202501}]})
    assert get_takes_for_courses(client, "S1", set()) == []
