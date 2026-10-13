import { useState, type ReactNode } from 'react'
import type { EvaluationRun, TranscriptRow } from '../../services/raiseCapacityReview'
import { NOT_RECORDED, courseLabel, formatDateTime } from './format'

interface EvidencePanelProps {
  /** The result whose evidence is shown (its snapshot), or null before any. */
  run: EvaluationRun | null
  requestedCourseId: string | null
  transcript: TranscriptRow[]
  courseNames: Map<string, string>
}

type Tone = 'ok' | 'bad' | 'warn' | 'neutral'

function Pill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className="rv-pill" data-tone={tone}>
      {children}
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="req-fields__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

const list = (ids: number[] | null | undefined, names: Map<string, string>) =>
  (ids ?? []).map((id) => courseLabel(id, names)).join(', ')

function PrerequisiteCheck({ run, names }: { run: EvaluationRun; names: Map<string, string> }) {
  const p = run.evidence!.checks.prerequisite
  const [tone, label]: [Tone, string] = !p.verified
    ? ['warn', 'Not verified']
    : p.satisfied === true
      ? ['ok', 'Met']
      : p.satisfied === false
        ? ['bad', 'Not met']
        : ['warn', 'Unresolved']
  const groups = (p.required_prerequisite_groups ?? [])
    .map((group) => group.map((id) => courseLabel(id, names)).join(' and '))
    .join(' — or — ')

  return (
    <section className="rv-check" aria-labelledby="rv-check-prereq">
      <div className="rv-check__head">
        <h3 id="rv-check-prereq" className="rv-check__title">Prerequisite</h3>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <dl className="req-fields rv-check__fields">
        <Field label="UoS requirement">
          {p.raw_prerequisite_text ?? (p.verified ? 'None listed' : 'Could not be retrieved')}
          {p.is_pre_or_co ? ' (pre- or co-requisite)' : ''}
        </Field>
        {groups && <Field label="Required courses">{groups}</Field>}
        {(p.passed_courses ?? []).length > 0 && <Field label="Passed">{list(p.passed_courses, names)}</Field>}
        {(p.never_attempted ?? []).length > 0 && (
          <Field label="Never attempted">{list(p.never_attempted, names)}</Field>
        )}
        {(p.failed_or_incomplete_courses ?? []).length > 0 && (
          <Field label="Attempted without a passing grade">{list(p.failed_or_incomplete_courses, names)}</Field>
        )}
        {(p.unresolved_grade_courses ?? []).length > 0 && (
          <Field label="Grade outside the approved policy">{list(p.unresolved_grade_courses, names)}</Field>
        )}
        {(p.additional_text_conditions ?? []).length > 0 && (
          <Field label="Other conditions (not evaluated)">{p.additional_text_conditions!.join('; ')}</Field>
        )}
      </dl>
      {p.details && <p className="rv-check__details">{p.details}</p>}
      {p.source_url && (
        <p className="rv-check__source">
          Source:{' '}
          <a href={p.source_url} target="_blank" rel="noopener noreferrer">
            University of Sharjah Computer Science degree page
          </a>
          {p.source_scope ? <span className="rv-check__scope"> {p.source_scope}</span> : null}
        </p>
      )}
    </section>
  )
}

function CompletedHoursCheck({ run }: { run: EvaluationRun }) {
  const h = run.evidence!.checks.completed_hours
  const [tone, label]: [Tone, string] = !h.applicable
    ? ['neutral', 'No rule']
    : h.satisfied === true
      ? ['ok', 'Met']
      : h.satisfied === false
        ? ['bad', 'Not met']
        : ['warn', 'Unresolved']
  return (
    <section className="rv-check" aria-labelledby="rv-check-hours">
      <div className="rv-check__head">
        <h3 id="rv-check-hours" className="rv-check__title">Completed hours</h3>
        <Pill tone={tone}>{label}</Pill>
      </div>
      {h.applicable ? (
        <dl className="req-fields rv-check__fields">
          <Field label="Required">
            {h.required_hours ?? NOT_RECORDED} hours{h.required_standing ? ` (${h.required_standing})` : ''}
          </Field>
          <Field label="Student at evaluation">
            {h.student_completed_hours == null ? NOT_RECORDED : `${h.student_completed_hours} hours`}
          </Field>
        </dl>
      ) : (
        <p className="rv-check__details">
          No completed-hours rule is configured for this course. This is not a failure.
        </p>
      )}
      {h.details && <p className="rv-check__details">{h.details}</p>}
    </section>
  )
}

function CapacityCheck({ run }: { run: EvaluationRun }) {
  const c = run.evidence!.checks.capacity
  return (
    <section className="rv-check" aria-labelledby="rv-check-capacity">
      <div className="rv-check__head">
        <h3 id="rv-check-capacity" className="rv-check__title">Section capacity</h3>
        <Pill tone={c.satisfied ? 'ok' : 'bad'}>{c.satisfied ? 'Space available' : 'No space'}</Pill>
      </div>
      <dl className="req-fields rv-check__fields rv-capacity">
        <Field label="Enrolled">{String(c.current_capacity)}</Field>
        <Field label="Total capacity">{String(c.total_capacity)}</Field>
        <Field label="Additional capacity">{String(c.additional_capacity)}</Field>
        <Field label="Maximum allowed">{String(c.maximum_allowed_capacity)}</Field>
        <Field label="Remaining raise capacity">{String(c.remaining_raise_capacity)}</Field>
      </dl>
    </section>
  )
}

function relevantIds(run: EvaluationRun | null, requestedCourseId: string | null) {
  const ids = new Set<string>(requestedCourseId ? [requestedCourseId] : [])
  for (const group of run?.evidence?.checks.prerequisite.required_prerequisite_groups ?? []) {
    for (const id of group) ids.add(String(id))
  }
  return ids
}

function EvidencePanel({ run, requestedCourseId, transcript, courseNames }: EvidencePanelProps) {
  const [showAll, setShowAll] = useState(false)
  const hasEvidence = Boolean(run?.evidence?.checks)
  const relevant = relevantIds(run, requestedCourseId)
  const rows = showAll ? transcript : transcript.filter((row) => relevant.has(row.courseId))
  const snapshotTime = formatDateTime(run?.evidence?.collected_at ?? run?.evaluated_at)

  return (
    <section className="req-panel rv-panel" aria-labelledby="rv-evidence-title">
      <h2 id="rv-evidence-title" className="req-panel__title">
        Academic evidence
      </h2>
      <div className="req-panel__body">
        {hasEvidence ? (
          <>
            <p className="rv-snapshot">
              <span className="rv-snapshot__tag">Snapshot</span>
              Recorded by the eligibility check{snapshotTime ? ` on ${snapshotTime}` : ''}. It does not
              change when records change; re-run the check to refresh it.
            </p>
            <div className="rv-checks">
              <PrerequisiteCheck run={run!} names={courseNames} />
              <CompletedHoursCheck run={run!} />
              <CapacityCheck run={run!} />
            </div>
          </>
        ) : (
          <p className="rv-muted">The prerequisite, completed-hours and capacity checks appear here after the eligibility check.</p>
        )}

        <div className="rv-transcript">
          <div className="rv-transcript__head">
            <h3 className="rv-check__title">
              {showAll ? 'Full transcript' : 'Relevant transcript'}
              <span className="rv-live-tag">Current records</span>
            </h3>
            {transcript.length > 0 && (
              <button type="button" className="rv-link-button" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show relevant courses only' : `Show full transcript (${transcript.length})`}
              </button>
            )}
          </div>
          <p className="rv-muted">
            {hasEvidence
              ? 'The requested course and its prerequisite courses, as recorded now (not part of the snapshot).'
              : 'The requested course, as recorded now. Prerequisite courses are added after the eligibility check.'}
          </p>
          {rows.length > 0 ? (
            <div className="adm-table-wrap">
              <table className="adm-table rv-table">
                <thead>
                  <tr>
                    <th scope="col">Course</th>
                    <th scope="col">Term</th>
                    <th scope="col">Section</th>
                    <th scope="col">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.courseId}-${row.term}-${row.sectionId}`}>
                      <td>{courseLabel(row.courseId, row.courseName ? new Map([[row.courseId, row.courseName]]) : courseNames)}</td>
                      <td className="adm-table__date">{row.term ?? NOT_RECORDED}</td>
                      <td>{row.sectionId ?? NOT_RECORDED}</td>
                      <td>{row.grade ?? 'No grade (in progress)'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rv-muted">
              {transcript.length === 0
                ? 'The student has no transcript records.'
                : 'The student has no records for these courses.'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

export default EvidencePanel
