// The searchable course dropdowns of the Course Equivalency form: search and
// keyboard helpers, and (static checks of the source) the ARIA combobox
// wiring, open/close behaviour, placeholders and unchanged data sources.
// Run: npm test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { comboboxCourses, creditHoursLabel, nextActiveIndex } from '../src/utils/courseCombobox.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const COMBO = source('../src/components/courseEquivalency/CourseCombobox.tsx')
const CSS = source('../src/components/courseEquivalency/CourseCombobox.css')
const PAGE = source('../src/pages/CourseEquivalencyForm.tsx')
const CS_PAGE = source('../src/pages/CourseSubstitutionForm.tsx')

const COURSES = [
  { id: '1501215', name: 'Data Structures', creditHours: 3, detail: 'Best grade F · Term 202410' },
  { id: '1440131', name: 'Calculus I', creditHours: 3, detail: 'Best grade C+ · Term 202310' },
  { id: '1502326', name: 'Digital Logic', creditHours: 4, detail: 'Required course' },
]

test('search matches course ID or name, case-insensitively; every course when empty', () => {
  assert.deepEqual(comboboxCourses(COURSES, '').map((c) => c.id), ['1501215', '1440131', '1502326'])
  assert.deepEqual(comboboxCourses(COURSES, '  data ').map((c) => c.id), ['1501215'])
  assert.deepEqual(comboboxCourses(COURSES, '1440').map((c) => c.id), ['1440131'])
  assert.deepEqual(comboboxCourses(COURSES, 'LOGIC').map((c) => c.id), ['1502326'])
  assert.deepEqual(comboboxCourses(COURSES, 'no such course'), [])
})

test('the other dropdown\'s choice is not offered; nothing else is filtered (F included)', () => {
  assert.deepEqual(comboboxCourses(COURSES, '', '1440131').map((c) => c.id), ['1501215', '1502326'])
  assert.deepEqual(comboboxCourses(COURSES, '', null).length, 3)
})

test('arrow keys move the highlight and wrap; Home and End jump; an empty list has none', () => {
  assert.equal(nextActiveIndex(-1, 'ArrowDown', 3), 0)
  assert.equal(nextActiveIndex(0, 'ArrowDown', 3), 1)
  assert.equal(nextActiveIndex(2, 'ArrowDown', 3), 0)
  assert.equal(nextActiveIndex(0, 'ArrowUp', 3), 2)
  assert.equal(nextActiveIndex(-1, 'ArrowUp', 3), 2)
  assert.equal(nextActiveIndex(2, 'ArrowUp', 3), 1)
  assert.equal(nextActiveIndex(1, 'Home', 3), 0)
  assert.equal(nextActiveIndex(1, 'End', 3), 2)
  assert.equal(nextActiveIndex(5, 'x', 3), 2)
  assert.equal(nextActiveIndex(0, 'ArrowDown', 0), -1)
})

test('credit hours are spelled out', () => {
  assert.equal(creditHoursLabel(3), '3 credit hours')
  assert.equal(creditHoursLabel(1), '1 credit hour')
  assert.equal(creditHoursLabel(null), null)
})

test('the field is an ARIA combobox that controls a listbox of options', () => {
  assert.match(COMBO, /role="combobox"/)
  assert.match(COMBO, /aria-expanded=\{isOpen\}/)
  assert.match(COMBO, /aria-controls=\{listId\}/)
  assert.match(COMBO, /aria-autocomplete="list"/)
  assert.match(COMBO, /aria-activedescendant=\{activeCourse \? optionId\(activeCourse\.id\) : undefined\}/)
  assert.match(COMBO, /role="listbox"/)
  assert.match(COMBO, /role="option"\s+aria-selected=\{course\.id === selectedId\}/)
  assert.match(COMBO, /<label htmlFor=\{`\$\{id\}-input`\} className="rc-field__label">/)
})

test('keyboard: arrows move, Enter chooses (never submits the form), Escape and Tab close', () => {
  assert.match(COMBO, /case 'ArrowDown':\s+case 'ArrowUp':\s+event\.preventDefault\(\)/)
  assert.match(COMBO, /case 'Enter':[\s\S]*?event\.preventDefault\(\)\s+if \(!isOpen\) openList\(\)\s+else if \(activeCourse\) choose\(activeCourse\)/)
  assert.match(COMBO, /case 'Escape':\s+if \(isOpen\) \{\s+event\.preventDefault\(\)\s+close\(\)/)
  assert.match(COMBO, /case 'Tab':\s+if \(isOpen\) close\(\)/)
})

test('one open at a time: closes on choosing, on a click outside, and when focus leaves', () => {
  assert.match(COMBO, /const choose = \(course: CourseOption\) => \{\s+onSelect\(course\.id\)\s+close\(\)/)
  assert.match(COMBO, /document\.addEventListener\('pointerdown', onPointerDown\)/)
  assert.match(COMBO, /if \(!rootRef\.current\?\.contains\(event\.target as Node\)\)/)
  assert.match(COMBO, /if \(isOpen && next && !rootRef\.current\?\.contains\(next\)\) close\(\)/)
  // Disabled while submitting: the list cannot stay open.
  assert.match(COMBO, /const isOpen = open && !disabled/)
})

test('the closed field shows the chosen course; options show ID, name, detail and credit hours', () => {
  assert.match(COMBO, /value=\{isOpen \? query : selected \? courseLabel\(selected\) : ''\}/)
  assert.match(COMBO, /<span className="cec-option__id">\{course\.id\}<\/span>/)
  assert.match(COMBO, /<span className="cec-option__name">\{course\.name \?\? 'Name not recorded'\}<\/span>/)
  assert.match(COMBO, /No course matches “\{query\.trim\(\)\}”\. Try another course ID or name\./)
})

test('the options panel has a maximum height and scrolls inside', () => {
  assert.match(CSS, /\.cec-combo__list \{[^}]*max-height: min\(320px, 50vh\);[^}]*overflow-y: auto;/)
  assert.match(CSS, /\.cec-combo__panel \{[^}]*position: absolute;/)
})

test('the form uses the dropdowns with the requested placeholders and the same data and rules', () => {
  assert.match(PAGE, /import CourseCombobox from '\.\.\/components\/courseEquivalency\/CourseCombobox'/)
  assert.doesNotMatch(PAGE, /CoursePicker/)
  assert.match(PAGE, /placeholder="Search or select a completed course"\s+courses=\{oldOptions\}\s+selectedId=\{oldCourseId\}\s+onSelect=\{chooseOld\}/)
  assert.match(PAGE, /placeholder="Search or select an equivalent course"\s+courses=\{newOptions\}\s+selectedId=\{newCourseId\}\s+excludedId=\{oldCourseId\}\s+onSelect=\{chooseNew\}/)
  assert.match(PAGE, /error=\{attempted \? \(errors\.oldCourse \?\? null\) : null\}\s+disabled=\{submitting\}/)
  assert.match(PAGE, /error=\{attempted \? \(errors\.newCourse \?\? null\) : null\}\s+disabled=\{submitting\}/)
})

test('Course Substitution reuses the same dropdown component (no copy)', () => {
  assert.match(CS_PAGE, /import CourseCombobox from '\.\.\/components\/courseEquivalency\/CourseCombobox'/)
  assert.doesNotMatch(CS_PAGE, /CoursePicker/)
})
