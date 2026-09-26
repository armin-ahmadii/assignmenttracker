import { useMemo, useState, type FormEvent } from 'react';
import { ITEM_TYPES, type Course, type ItemType } from '../domain/types';
import { normalizeCode } from '../domain/factory';
import { WEEKDAYS, occurrenceDay } from '../domain/recurring';
import { codeTaken } from '../domain/rollover';
import { allTerms, compareTermsDesc } from '../domain/terms';
import { dayKey, END_OF_DAY, formatDayKey, formatTime, weekdayOfKey, zonedToUtc } from '../domain/time';
import { addCourse, addRule, deleteCourse, deleteRule, updateCourse } from '../data/actions';
import { useStore } from '../data/store';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { useClock } from '../ui/clock';
import { confirmAction } from '../ui/confirm';
import { closeOverlay, openOverlay, replaceOverlay } from '../ui/nav';
import { compareCourses, useCourseStats, useCurrentTerm } from '../ui/selectors';
import { showToast } from '../ui/toast';

/** Courses → every term, on/off switches, and the way into New term. */
export function CoursesSheet() {
  const { courses } = useStore();
  const stats = useCourseStats();
  const current = useCurrentTerm();

  const terms = useMemo(() => {
    const names = allTerms(courses).sort((a, b) => (a === current ? -1 : b === current ? 1 : compareTermsDesc(a, b)));
    return names.map((term) => ({ term, courses: courses.filter((c) => c.term === term).sort(compareCourses) }));
  }, [courses, current]);

  return (
    <Sheet title="Courses" eyebrow="Manage" size="large">
      <div className="sheet-actions">
        <button type="button" className="action save-button" onClick={() => openOverlay({ kind: 'new-term' })}>
          New term
        </button>
        <button type="button" className="action secondary-button" onClick={() => openOverlay({ kind: 'course', id: null })}>
          <Icon name="plus" /> Add course
        </button>
      </div>
      {!terms.length && <p className="empty-state small">No courses yet. Add one, or start a new term with all of them at once.</p>}
      {terms.map(({ term, courses: list }) => (
        <section className="settings-group" key={term}>
          <h3>{term}</h3>
          <ul className="manage-list">
            {list.map((course) => (
              <li key={course.id} data-off={!course.active || undefined}>
                <button type="button" className="manage-open" onClick={() => openOverlay({ kind: 'course', id: course.id })}>
                  <strong>{course.code}</strong>
                  <small>
                    {stats.get(course.id)?.open ?? 0} open{course.active ? '' : ' · hidden from active screens'}
                  </small>
                </button>
                <Switch
                  checked={course.active}
                  label={`${course.code} active`}
                  onChange={(active) => updateCourse(course.id, { active })}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" />
    </label>
  );
}

/** Add or edit one course, including its recurring labs. */
export function CourseEditor({ id }: { id: string | null }) {
  const snapshot = useStore();
  const current = useCurrentTerm();
  const course = id ? snapshot.coursesById.get(id) : undefined;
  const [code, setCode] = useState(course?.code ?? '');
  const [term, setTerm] = useState(course?.term ?? current);
  const [site, setSite] = useState(course?.site ?? '');
  const [error, setError] = useState('');
  const terms = allTerms(snapshot.courses);

  if (id && !course) {
    return (
      <Sheet title="Course">
        <p className="empty-state small">This course no longer exists.</p>
      </Sheet>
    );
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeCode(code);
    if (!normalized) return setError('Code is required');
    if (!term.trim()) return setError('Term is required');
    if (codeTaken(snapshot.courses, normalized, term, course?.id)) return setError(`${normalized} already exists in ${term.trim()}`);
    const siteUrl = site.trim() ? (/^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${site.trim()}`) : null;
    if (course) {
      updateCourse(course.id, { code: normalized, term: term.trim(), site: siteUrl });
      closeOverlay();
    } else {
      const created = addCourse({ code: normalized, term, site: siteUrl });
      showToast({ message: `Added ${created.code}` });
      // Stay on the new course so a recurring lab can be added straight away.
      replaceOverlay({ kind: 'course', id: created.id });
    }
  };

  const remove = async () => {
    if (!course) return;
    const ok = await confirmAction({ title: `Delete ${course.code}?`, body: "It has no work items, so nothing else is affected. This can't be undone." });
    if (!ok) return;
    deleteCourse(course.id);
    closeOverlay();
  };

  const hasItems = course ? snapshot.items.some((i) => i.courseId === course.id) : false;

  return (
    <Sheet title={course ? course.code : 'Add course'} eyebrow={course ? course.term : 'Courses'}>
      <form onSubmit={save} noValidate>
        <div className="fields">
          <label className="field">
            <span>Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CMPT 276" autoCapitalize="characters" autoFocus={!course} />
          </label>
          <label className="field">
            <span>Term</span>
            <input value={term} onChange={(e) => setTerm(e.target.value)} list="term-options" placeholder="e.g. Fall 2026" />
            <datalist id="term-options">
              {terms.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="field field-wide">
            <span>Course site</span>
            <input type="url" value={site} onChange={(e) => setSite(e.target.value)} placeholder="Canvas or course page link" />
          </label>
          {course && (
            <div className="field field-wide switch-field">
              <span>
                Active
                <small> · Off hides it everywhere except Done and search</small>
              </span>
              <Switch checked={course.active} label="Active" onChange={(active) => updateCourse(course.id, { active })} />
            </div>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="sheet-footer">
          {course && !hasItems ? (
            <button type="button" className="action danger-link" onClick={remove}>
              <Icon name="trash" /> Delete course
            </button>
          ) : (
            <p>{course ? 'Turn a course off instead of deleting it; its work stays in Done.' : 'Only the code is needed.'}</p>
          )}
          <button type="submit" className="action save-button">
            {course ? 'Save' : 'Add course'}
          </button>
        </footer>
      </form>
      {course && <RecurringRules course={course} />}
    </Sheet>
  );
}

function RecurringRules({ course }: { course: Course }) {
  const { rules } = useStore();
  const { now, tz } = useClock();
  const today = dayKey(now, tz);
  const mine = rules.filter((r) => r.courseId === course.id);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ItemType>('Lab');
  const [pattern, setPattern] = useState('Lab {n}');
  const [weekday, setWeekday] = useState(() => weekdayOfKey(today));
  const [dueTime, setDueTime] = useState(END_OF_DAY);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!pattern.trim() || !startDate) return;
    addRule({
      courseId: course.id,
      type,
      namePattern: pattern.trim(),
      weekday,
      dueTime: dueTime || END_OF_DAY,
      startDate,
      endDate: endDate || null,
      tz,
    });
    setAdding(false);
    showToast({ message: `Recurring ${type.toLowerCase()}s set up for ${course.code}` });
  };

  const describe = (r: (typeof mine)[number]) => {
    const time = formatTime(zonedToUtc(today, r.dueTime, r.tz), r.tz);
    const ended = r.endDate && today > r.endDate;
    const state = !course.active ? 'Stopped: course is off' : ended ? 'Ended' : `Next: ${formatDayKey(occurrenceDay(r, r.nextN), 'MMM d')}`;
    return `${WEEKDAYS[r.weekday]}s at ${time} · ${state}`;
  };

  return (
    <section className="detail-section rules">
      <h3>Recurring labs</h3>
      <p className="settings-note">Each one appears 7 days before it's due, as an ordinary item.</p>
      {mine.length > 0 && (
        <ul className="manage-list">
          {mine.map((r) => (
            <li key={r.id}>
              <span className="manage-open">
                <strong>{r.namePattern}</strong>
                <small>{describe(r)}</small>
              </span>
              <button
                type="button"
                className="action icon-button"
                aria-label={`Delete rule ${r.namePattern}`}
                onClick={async () => {
                  const ok = await confirmAction({
                    title: `Stop “${r.namePattern}”?`,
                    body: 'Items it already created stay. No new ones will be made.',
                    confirmLabel: 'Delete rule',
                  });
                  if (ok) deleteRule(r.id);
                }}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form className="fields rule-form" onSubmit={add}>
          <label className="field">
            <span>Type</span>
            <span className="select-wrap">
              <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
                {ITEM_TYPES.filter((t) => t !== 'Project').map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <Icon name="chevron" />
            </span>
          </label>
          <label className="field">
            <span>Name pattern</span>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Lab {n}" />
          </label>
          <label className="field">
            <span>Due every</span>
            <span className="select-wrap">
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
              <Icon name="chevron" />
            </span>
          </label>
          <label className="field">
            <span>At</span>
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </label>
          <label className="field">
            <span>Starting</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Ending (optional)</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <div className="field-wide rule-actions">
            <button type="button" className="action secondary-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="action save-button">
              Save rule
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="add-line" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add recurring rule
        </button>
      )}
    </section>
  );
}
