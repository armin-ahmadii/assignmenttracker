import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ITEM_TYPES, type ItemType } from '../domain/types';
import { normalizeCode } from '../domain/factory';
import { codeTaken } from '../domain/rollover';
import { END_OF_DAY } from '../domain/time';
import { addCourse, addItem, lastCourseId } from '../data/actions';
import { useStore } from '../data/store';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { useClock } from '../ui/clock';
import { closeOverlay } from '../ui/nav';
import { activeCourses, useCurrentTerm } from '../ui/selectors';
import { showToast } from '../ui/toast';

const NEW_COURSE = '__new__';

type Errors = Partial<Record<'name' | 'course' | 'due', string>>;

/** Four fields — Name, Course, Type, Due — saved with one tap or Enter. */
export function QuickAdd({ parentId }: { parentId?: string }) {
  const snapshot = useStore();
  const { tz } = useClock();
  const term = useCurrentTerm();
  const courses = activeCourses(snapshot);
  const parent = parentId ? snapshot.itemsById.get(parentId) : undefined;

  const defaultCourse = useMemo(() => {
    if (parent) return parent.courseId;
    const last = lastCourseId();
    if (last && courses.some((c) => c.id === last)) return last;
    return courses[0]?.id ?? NEW_COURSE;
    // Only on open: the default shouldn't jump while typing.
  }, []);

  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState(defaultCourse);
  const [newCode, setNewCode] = useState('');
  const [type, setType] = useState<ItemType>(parent ? 'Project' : 'Assignment');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState(END_OF_DAY);
  const [errors, setErrors] = useState<Errors>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Takes focus from the hidden input focused during the tap, so iOS keeps the keyboard up.
    nameRef.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (!name.trim()) next.name = 'Name is required';
    if (courseId === NEW_COURSE) {
      if (!normalizeCode(newCode)) next.course = 'Course is required';
      else if (codeTaken(snapshot.courses, newCode, term)) next.course = `${normalizeCode(newCode)} already exists in ${term}`;
    } else if (!courseId) next.course = 'Course is required';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) next.due = 'Due date is required';
    setErrors(next);
    if (Object.keys(next).length) {
      const first = next.name ? 'qa-name' : next.course ? 'qa-course' : 'qa-due';
      document.getElementById(first)?.focus();
      return;
    }
    const course = courseId === NEW_COURSE ? addCourse({ code: newCode, term }) : snapshot.coursesById.get(courseId)!;
    addItem({ name, courseId: course.id, type, dueDate, dueTime: dueTime || END_OF_DAY, tz, parentId: parentId ?? null });
    closeOverlay();
    showToast({ message: parent ? `Added milestone to ${parent.name}` : `Added to ${course.code}` });
  };

  return (
    <Sheet title={parent ? 'Add milestone' : 'Quick add'} eyebrow={parent ? parent.name : 'New work'}>
      <form className="quick-add-form" onSubmit={submit} noValidate>
        <div className="fields">
          <label className="field field-wide">
            <span>Name</span>
            <input
              id="qa-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={parent ? 'Milestone name' : 'What needs doing?'}
              autoComplete="off"
              enterKeyHint="done"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'qa-name-error' : undefined}
            />
            {errors.name && <em id="qa-name-error">{errors.name}</em>}
          </label>
          {!parent && (
            <>
              {/* A div, not a label: the combo's button must not become part of the field's name. */}
              <div className="field">
                <label htmlFor="qa-course">Course</label>
                {courseId === NEW_COURSE ? (
                  <span className="field-combo">
                    <input
                      id="qa-course"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      placeholder="e.g. CMPT 276"
                      autoCapitalize="characters"
                      aria-invalid={Boolean(errors.course)}
                    />
                    {courses.length > 0 && (
                      <button type="button" className="combo-back" onClick={() => setCourseId(courses[0].id)} aria-label="Pick an existing course">
                        <Icon name="chevron" />
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="select-wrap">
                    <select id="qa-course" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-invalid={Boolean(errors.course)}>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                      <option value={NEW_COURSE}>New course…</option>
                    </select>
                    <Icon name="chevron" />
                  </span>
                )}
                {errors.course && <em>{errors.course}</em>}
              </div>
              <label className="field">
                <span>Type</span>
                <span className="select-wrap">
                  <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
                    {ITEM_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <Icon name="chevron" />
                </span>
              </label>
            </>
          )}
          <div className="field field-wide">
            <label htmlFor="qa-due">Due</label>
            <span className="field-control due-control" aria-invalid={Boolean(errors.due)}>
              <input id="qa-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" required />
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} aria-label="Due time" />
            </span>
            {errors.due && <em>{errors.due}</em>}
          </div>
        </div>
        <footer className="sheet-footer">
          <p>{parent ? `Goes in ${snapshot.coursesById.get(parent.courseId)?.code ?? 'the project’s course'}` : 'Course remembered · time defaults to 11:59 pm'}</p>
          <button type="submit" className="action save-button">
            {parent ? 'Add milestone' : 'Add work'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}
