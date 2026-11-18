import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { NOT_RECORDED } from '../review/format'
import { groupTranscript, type TranscriptEntry } from '../../utils/studentProfile'
import '../shared/DataTable.css'
import './TranscriptTerms.css'

interface TranscriptTermsProps {
  /** The student's Takes rows, as loaded (services/adminStudentProfile.ts). */
  entries: readonly TranscriptEntry[]
  /** Shown when no course is recorded. */
  emptyMessage: string
  /** Each term block's heading; "Term 202601" when not given. */
  termTitle?: (term: number) => ReactNode
  /** An extra class on each table (e.g. a narrower minimum width). */
  tableClassName?: string
}

const defaultTermTitle = (term: number) => `Term ${term}`

// The transcript's term blocks: every Takes row grouped by term (newest
// first), with the repeated-course tag and missing values marked. Read-only.
// Shared by the admin Student Profile and the student's My Profile; each page
// keeps its own panel, loading and error handling around it.
function TranscriptTerms({ entries, emptyMessage, termTitle = defaultTermTitle, tableClassName }: TranscriptTermsProps) {
  const terms = useMemo(() => groupTranscript(entries), [entries])

  if (terms.length === 0) return <p className="rv-muted sp-empty">{emptyMessage}</p>

  return (
    <>
      {terms.map(({ term, courses }) => (
        <section key={term} className="sp-term" aria-labelledby={`sp-term-${term}`}>
          <h3 id={`sp-term-${term}`} className="sp-term__title">
            {termTitle(term)}
            <span className="sp-term__count">
              {courses.length} {courses.length === 1 ? 'course' : 'courses'}
            </span>
          </h3>
          <div className="adm-table-wrap">
            <table className={tableClassName ? `adm-table sp-table ${tableClassName}` : 'adm-table sp-table'}>
              <thead>
                <tr>
                  <th scope="col">Course code</th>
                  <th scope="col">Course name</th>
                  <th scope="col" className="sp-num">
                    Credit hours
                  </th>
                  <th scope="col">Section</th>
                  <th scope="col">Grade</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c, index) => (
                  <tr key={`${c.courseId}-${c.sectionId ?? ''}-${index}`}>
                    <td className="adm-mono sp-code">
                      {c.courseId}
                      {c.repeated && (
                        <span className="sp-tag" title="Taken in more than one term">
                          Repeated
                        </span>
                      )}
                    </td>
                    <td>{c.courseName ?? <span className="rv-missing">{NOT_RECORDED}</span>}</td>
                    <td className="sp-num">{c.creditHours ?? <span className="rv-missing">—</span>}</td>
                    <td className="adm-mono">{c.sectionId ?? '—'}</td>
                    <td>
                      {c.grade ? (
                        <span className="sp-grade">{c.grade}</span>
                      ) : (
                        <span className="rv-missing">No grade recorded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  )
}

export default TranscriptTerms
