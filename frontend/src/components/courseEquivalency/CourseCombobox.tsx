import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import { courseLabel, type CourseOption } from '../../utils/courseSubstitutionSubmission'
import { comboboxCourses, creditHoursLabel, nextActiveIndex } from '../../utils/courseCombobox'
import './CourseCombobox.css'

interface CourseComboboxProps {
  /** Unique prefix for element ids, e.g. 'cef-old'. */
  id: string
  label: string
  /** Optional line under the label; nothing is rendered without it. */
  hint?: string
  placeholder: string
  courses: CourseOption[]
  selectedId: string | null
  /** A course that cannot be chosen here (the other dropdown's choice). */
  excludedId?: string | null
  onSelect: (courseId: string) => void
  /** Shown once the student has tried to submit. */
  error: string | null
  disabled: boolean
  /** Marks the field as required (default); false for an optional filter. */
  required?: boolean
}

// A compact, searchable single-choice dropdown (ARIA combobox + listbox). The
// closed field shows the chosen course; typing filters by course ID or name.
// Arrow keys move through the list, Enter chooses, Escape or a click outside
// closes it. Moving focus or clicking elsewhere closes it, so only one
// dropdown is open at a time.
function CourseCombobox({
  id,
  label,
  hint,
  placeholder,
  courses,
  selectedId,
  excludedId,
  onSelect,
  error,
  disabled,
  required = true,
}: CourseComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const isOpen = open && !disabled
  const matches = comboboxCourses(courses, query, excludedId)
  const selected = courses.find((course) => course.id === selectedId) ?? null
  const activeCourse = isOpen && active >= 0 ? (matches[active] ?? null) : null
  const listId = `${id}-listbox`
  const optionId = (courseId: string) => `${id}-option-${courseId}`
  const selectedMeta = selected
    ? [selected.detail, creditHoursLabel(selected.creditHours)].filter(Boolean).join(' · ')
    : ''
  const describedBy = [hint ? `${id}-hint` : '', selectedMeta ? `${id}-selected` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ')

  const close = () => {
    setOpen(false)
    setQuery('')
    setActive(-1)
  }

  const openList = () => {
    if (disabled || isOpen) return
    const all = comboboxCourses(courses, '', excludedId)
    const at = selected ? all.findIndex((course) => course.id === selected.id) : -1
    setQuery('')
    setActive(at >= 0 ? at : all.length > 0 ? 0 : -1)
    setOpen(true)
  }

  const choose = (course: CourseOption) => {
    onSelect(course.id)
    close()
  }

  // A click or touch outside the field closes the list.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
        setActive(-1)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen])

  // Keep the highlighted option visible while moving with the keyboard.
  useEffect(() => {
    if (!isOpen || active < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, active])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        if (!isOpen) openList()
        else setActive((current) => nextActiveIndex(current, event.key, matches.length))
        break
      case 'Enter':
        // Never submits the form from here: Enter opens the list or chooses.
        event.preventDefault()
        if (!isOpen) openList()
        else if (activeCourse) choose(activeCourse)
        break
      case 'Escape':
        if (isOpen) {
          event.preventDefault()
          close()
        }
        break
      case 'Tab':
        if (isOpen) close()
        break
    }
  }

  // Focus moving to another control (e.g. the other dropdown) closes the list.
  // A null target (e.g. dragging the list's scrollbar) is handled by the
  // outside-click listener instead.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (isOpen && next && !rootRef.current?.contains(next)) close()
  }

  return (
    <div className="rc-field cec-combo" ref={rootRef} onBlur={handleBlur}>
      <label htmlFor={`${id}-input`} className="rc-field__label">
        {label}
        {required && (
          <>
            {' '}
            <span className="rc-field__required" aria-hidden="true">*</span>
            <span className="student-visually-hidden">(required)</span>
          </>
        )}
      </label>
      {hint && (
        <span id={`${id}-hint`} className="csf-picker__hint">
          {hint}
        </span>
      )}

      <div className="cec-combo__control" data-open={isOpen || undefined}>
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          className="rc-field__input cec-combo__input"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeCourse ? optionId(activeCourse.id) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={isOpen && selected ? courseLabel(selected) : placeholder}
          value={isOpen ? query : selected ? courseLabel(selected) : ''}
          onChange={(event) => {
            const text = event.target.value
            setQuery(text)
            setActive(comboboxCourses(courses, text, excludedId).length > 0 ? 0 : -1)
            setOpen(true)
          }}
          onClick={openList}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="cec-combo__toggle"
          tabIndex={-1}
          aria-label={isOpen ? `Close ${label.toLowerCase()} list` : `Open ${label.toLowerCase()} list`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (isOpen) {
              close()
            } else {
              inputRef.current?.focus()
              openList()
            }
          }}
          disabled={disabled}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {isOpen && (
          // Pressing inside the panel keeps focus in the search field.
          <div className="cec-combo__panel" onMouseDown={(event) => event.preventDefault()}>
            {matches.length === 0 ? (
              <p className="cec-combo__empty" role="status">
                No course matches “{query.trim()}”. Try another course ID or name.
              </p>
            ) : (
              <ul id={listId} ref={listRef} role="listbox" aria-label={label} className="cec-combo__list">
                {matches.map((course, index) => {
                  const hours = creditHoursLabel(course.creditHours)
                  return (
                    <li
                      key={course.id}
                      id={optionId(course.id)}
                      role="option"
                      aria-selected={course.id === selectedId}
                      data-index={index}
                      data-active={index === active || undefined}
                      className="cec-option"
                      onClick={() => choose(course)}
                      onMouseMove={() => {
                        if (index !== active) setActive(index)
                      }}
                    >
                      <span className="cec-option__main">
                        <span className="cec-option__id">{course.id}</span>
                        <span className="cec-option__name">{course.name ?? 'Name not recorded'}</span>
                      </span>
                      {(course.detail || hours) && (
                        <span className="cec-option__meta">
                          {course.detail && <span className="cec-option__detail">{course.detail}</span>}
                          {hours && <span className="cec-option__hours">{hours}</span>}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {selectedMeta && (
        <span id={`${id}-selected`} className="cec-combo__selected">
          {selectedMeta}
        </span>
      )}

      {error && (
        <span id={`${id}-error`} className="rc-error">
          <span aria-hidden="true">✕ </span>
          {error}
        </span>
      )}
    </div>
  )
}

export default CourseCombobox
