from app.agents.raise_capacity_priority.deterministic.course_offerings import build_requested_course_offering_evidence

FALL_ONLY_COURSE = 1501322  # Prof. Soc. & Ethical Issues in CS: fall=true, spring=false, summer=false
SPRING_ONLY_COURSE = 1501246  # Obj. Oriented Design with Java: fall=false, spring=true, summer=false
ALL_SEMESTERS_COURSE = 1501215  # Data Structures: fall/spring/summer all true
MISSING_COURSE = 9999999


# 27. Course offered Fall only
def test_course_offered_fall_only():
    evidence = build_requested_course_offering_evidence(FALL_ONLY_COURSE, request_term=None)
    assert evidence.found_in_kb is True
    assert evidence.fall is True
    assert evidence.spring is False
    assert evidence.summer is False


# 28. Fall + Spring (use the all-semesters course, just check both true)
def test_course_offered_fall_and_spring():
    evidence = build_requested_course_offering_evidence(ALL_SEMESTERS_COURSE, request_term=None)
    assert evidence.fall is True
    assert evidence.spring is True


# 29. Summer available
def test_summer_available_true():
    evidence = build_requested_course_offering_evidence(ALL_SEMESTERS_COURSE, request_term=None)
    assert evidence.summer_available is True


def test_summer_available_false():
    evidence = build_requested_course_offering_evidence(FALL_ONLY_COURSE, request_term=None)
    assert evidence.summer_available is False


# 30. Course missing from KB
def test_course_missing_from_kb_is_explicit_not_false():
    evidence = build_requested_course_offering_evidence(MISSING_COURSE, request_term=202601)
    assert evidence.found_in_kb is False
    assert evidence.fall is None
    assert evidence.spring is None
    assert evidence.summer is None
    assert evidence.summer_available is None
    assert evidence.offered_semester_count is None
    assert evidence.offered_semesters == []


# 31. Offered-semester count
def test_offered_semester_count():
    evidence = build_requested_course_offering_evidence(ALL_SEMESTERS_COURSE, request_term=None)
    assert evidence.offered_semester_count == 3
    assert set(evidence.offered_semesters) == {"FALL", "SPRING", "SUMMER"}

    evidence_single = build_requested_course_offering_evidence(FALL_ONLY_COURSE, request_term=None)
    assert evidence_single.offered_semester_count == 1


# 32. Fall request + Spring course available
def test_next_semester_fall_request_spring_available():
    evidence = build_requested_course_offering_evidence(SPRING_ONLY_COURSE, request_term=202601)
    assert evidence.current_semester == "FALL"
    assert evidence.next_semester == "SPRING"
    assert evidence.offered_next_semester is True


# 33. Fall request + Spring unavailable
def test_next_semester_fall_request_spring_unavailable():
    evidence = build_requested_course_offering_evidence(FALL_ONLY_COURSE, request_term=202601)
    assert evidence.next_semester == "SPRING"
    assert evidence.offered_next_semester is False


# 34. Spring request + Summer available
def test_next_semester_spring_request_summer_available():
    evidence = build_requested_course_offering_evidence(ALL_SEMESTERS_COURSE, request_term=202602)
    assert evidence.current_semester == "SPRING"
    assert evidence.next_semester == "SUMMER"
    assert evidence.offered_next_semester is True


# 35. Summer request + Fall available
def test_next_semester_summer_request_fall_available():
    evidence = build_requested_course_offering_evidence(ALL_SEMESTERS_COURSE, request_term=202603)
    assert evidence.current_semester == "SUMMER"
    assert evidence.next_semester == "FALL"
    assert evidence.offered_next_semester is True


# 36. Unsupported term
def test_next_semester_unsupported_term_suffix():
    evidence = build_requested_course_offering_evidence(ALL_SEMESTERS_COURSE, request_term=202699)
    assert evidence.term_suffix_supported is False
    assert evidence.current_semester is None
    assert evidence.next_semester is None
    assert evidence.offered_next_semester is None


# 37. Course missing from KB (next-semester specific)
def test_next_semester_course_missing_from_kb_is_unresolved():
    evidence = build_requested_course_offering_evidence(MISSING_COURSE, request_term=202601)
    assert evidence.term_suffix_supported is True
    assert evidence.next_semester == "SPRING"
    assert evidence.offered_next_semester is None
