import { useMemo, useState, type FormEvent } from 'react';
import { nextTermName } from '../domain/terms';
import { parseCodes, planRollover } from '../domain/rollover';
import { startTerm } from '../data/actions';
import { useStore } from '../data/store';
import { Sheet } from '../ui/Sheet';
import { closeAllOverlays } from '../ui/nav';
import { useCurrentTerm } from '../ui/selectors';
import { showToast } from '../ui/toast';

/** Type the term and its course codes; last term's courses come pre-selected to turn off. */
export function NewTermSheet() {
  const { courses } = useStore();
  const current = useCurrentTerm();
  const [term, setTerm] = useState(() => nextTermName(current));
  const [codes, setCodes] = useState('');
  const [keepOn, setKeepOn] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const plan = useMemo(() => planRollover(courses, term, codes, new Date()), [courses, term, codes]);
  const count = parseCodes(codes).length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!term.trim()) return setError('Name the term, e.g. Spring 2027');
    if (!count) return setError('Add at least one course code');
    const turnOff = new Set(plan.previous.filter((c) => !keepOn.has(c.id)).map((c) => c.id));
    startTerm(plan, turnOff);
    closeAllOverlays();
    showToast({
      message: `${plan.term} started with ${count} ${count === 1 ? 'course' : 'courses'}${turnOff.size ? ` · ${turnOff.size} turned off` : ''}`,
    });
  };

  return (
    <Sheet title="New term" eyebrow="Courses">
      <form onSubmit={submit} noValidate>
        <div className="fields">
          <label className="field field-wide">
            <span>Term name</span>
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="e.g. Spring 2027" />
          </label>
          <label className="field field-wide">
            <span>Course codes, one per line</span>
            <textarea
              value={codes}
              onChange={(e) => setCodes(e.target.value)}
              rows={5}
              placeholder={'CMPT 300\nMATH 240\nSTAT 270'}
              autoCapitalize="characters"
              autoFocus
            />
          </label>
        </div>

        {plan.previous.length > 0 && (
          <section className="detail-section">
            <h3>Last term's courses</h3>
            <p className="settings-note">Turned-off courses leave the active screens and their recurring labs stop. Their work stays in Done and search.</p>
            <ul className="manage-list">
              {plan.previous.map((course) => {
                const off = !keepOn.has(course.id);
                return (
                  <li key={course.id}>
                    <span className="manage-open">
                      <strong>{course.code}</strong>
                      <small>{course.term}</small>
                    </span>
                    <label className="toggle-chip" data-on={off || undefined}>
                      <input
                        type="checkbox"
                        checked={off}
                        onChange={(e) => {
                          const next = new Set(keepOn);
                          if (e.target.checked) next.delete(course.id);
                          else next.add(course.id);
                          setKeepOn(next);
                        }}
                      />
                      Turn off
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {error && <p className="form-error">{error}</p>}
        <footer className="sheet-footer">
          <p>
            {count ? `${plan.create.length + plan.reactivate.length} new` : 'No courses yet'}
            {plan.previous.length ? ` · ${plan.previous.length - keepOn.size} to turn off` : ''}
          </p>
          <button type="submit" className="action save-button">
            Start {term.trim() || 'term'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}
