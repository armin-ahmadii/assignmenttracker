import { useState, type ReactNode } from 'react';
import { EFFORTS, ITEM_TYPES, STATUSES, type ChecklistEntry, type ItemType, type WorkItem } from '../domain/types';
import { checklistProgress, sortByDue } from '../domain/computed';
import { checklistLabel, newId } from '../domain/factory';
import { dayKey, END_OF_DAY, formatDay, formatTime, timeKey, zonedToUtc } from '../domain/time';
import { deleteItem, updateItem } from '../data/actions';
import { useStore } from '../data/store';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { useClock } from '../ui/clock';
import { confirmAction } from '../ui/confirm';
import { closeOverlay, openOverlay } from '../ui/nav';
import { activeCourses } from '../ui/selectors';
import { changeStatus, showToast } from '../ui/toast';
import { DueChip, StatusChip, typeLabel } from '../ui/WorkRow';

export function ItemDetail({ id }: { id: string }) {
  const { itemsById } = useStore();
  const item = itemsById.get(id);
  if (!item) {
    return (
      <Sheet title="Item">
        <p className="empty-state small">This item no longer exists.</p>
      </Sheet>
    );
  }
  return <ItemDetailBody key={item.id} item={item} />;
}

/** Only web links: anything without http(s) is treated as a bare address. */
function normalizeUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^(?:[a-z][a-z0-9+.-]*:\/\/|(?:javascript|data|vbscript|file):)/i, '')}`;
}

function ItemDetailBody({ item }: { item: WorkItem }) {
  const snapshot = useStore();
  const { tz } = useClock();
  const course = snapshot.coursesById.get(item.courseId);
  const parent = item.parentId ? snapshot.itemsById.get(item.parentId) : undefined;
  const isMilestone = Boolean(item.parentId);
  const milestones = !isMilestone && item.type === 'Project' ? sortByDue(snapshot.items.filter((i) => i.parentId === item.id)) : [];
  const courseOptions = activeCourses(snapshot);
  if (course && !courseOptions.includes(course)) courseOptions.push(course);

  const [name, setName] = useState(item.name);
  const set = (patch: Partial<WorkItem>) => updateItem(item.id, patch);

  const dueDate = dayKey(item.due, tz);
  const dueTime = timeKey(item.due, tz);
  const setDue = (date: string, time: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    // A Do date after Due would hide the item from Now while it's due, so keep it no later than Due.
    const doDate = item.doDate && item.doDate > date ? date : item.doDate;
    set({ due: zonedToUtc(date, time || END_OF_DAY, tz).toISOString(), dueTz: tz, doDate });
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete “${item.name}”?`,
      body: milestones.length
        ? `Its ${milestones.length} ${milestones.length === 1 ? 'milestone' : 'milestones'} will be deleted too. This can't be undone.`
        : "This can't be undone.",
    });
    if (!ok) return;
    deleteItem(item.id);
    closeOverlay();
    showToast({ message: `Deleted “${item.name}”` });
  };

  const header = (
    <div className="detail-title">
      <p className="eyebrow">
        {course?.code ?? 'No course'} · {typeLabel(item, parent)}
      </p>
      <input
        className="title-input"
        value={name}
        aria-label="Name"
        onChange={(e) => {
          setName(e.target.value);
          if (e.target.value.trim()) set({ name: e.target.value.trim() });
        }}
        onBlur={() => !name.trim() && setName(item.name)}
      />
    </div>
  );

  return (
    <Sheet title={item.name} header={header} size="large" className="detail">
      {parent && (
        <p className="part-of">
          Milestone of{' '}
          <button type="button" className="link-button" onClick={() => openOverlay({ kind: 'item', id: parent.id })}>
            {parent.name}
          </button>
        </p>
      )}

      <div className="status-control" role="radiogroup" aria-label="Status">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={item.status === status}
            data-status={status}
            onClick={() => changeStatus(item, status)}
          >
            {status}
          </button>
        ))}
      </div>

      <p className="due-line">
        <DueChip item={item} />
        <span>
          Due {formatDay(item.due, tz, 'EEE, MMM d')} at {formatTime(item.due, tz)}
        </span>
      </p>

      <div className="fields detail-fields">
        <Field label="Course">
          <span className="select-wrap">
            <select value={item.courseId} disabled={isMilestone} onChange={(e) => set({ courseId: e.target.value })}>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                  {c.active ? '' : ` (${c.term})`}
                </option>
              ))}
            </select>
            <Icon name="chevron" />
          </span>
        </Field>
        {!isMilestone && (
          <Field label="Type">
            <span className="select-wrap">
              <select value={item.type} onChange={(e) => set({ type: e.target.value as ItemType })}>
                {ITEM_TYPES.map((t) => (
                  <option key={t} disabled={t !== 'Project' && milestones.length > 0}>
                    {t}
                  </option>
                ))}
              </select>
              <Icon name="chevron" />
            </span>
          </Field>
        )}
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(e) => setDue(e.target.value, dueTime)} required />
        </Field>
        <Field label="Due time">
          <input type="time" value={dueTime} onChange={(e) => setDue(dueDate, e.target.value)} />
        </Field>
        <Field label="Do date" hint="When you plan to work on it">
          <input
            type="date"
            value={item.doDate ?? ''}
            max={dueDate}
            onChange={(e) => set({ doDate: e.target.value ? (e.target.value > dueDate ? dueDate : e.target.value) : null })}
          />
        </Field>
        <Field label="Weight">
          <NumberInput value={item.weight} onCommit={(weight) => set({ weight })} suffix="% of grade" label="Weight, percent of final grade" />
        </Field>
        <Field label="Effort" group>
          <div className="segmented" role="radiogroup" aria-label="Effort">
            {EFFORTS.map((e) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={item.effort === e}
                onClick={() => set({ effort: item.effort === e ? null : e })}
              >
                {e}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Link">
          <span className="field-combo">
            <TextInput
              type="url"
              value={item.link ?? ''}
              placeholder="Assignment page"
              onCommit={(text) => set({ link: normalizeUrl(text) })}
            />
            {item.link && (
              <a className="combo-back" href={item.link} target="_blank" rel="noreferrer" aria-label="Open link">
                <Icon name="external" />
              </a>
            )}
          </span>
        </Field>
      </div>

      {item.type === 'Assignment' && !isMilestone && (
        <details className="fold" open={Boolean(item.requirements)}>
          <summary>Requirements</summary>
          <textarea
            value={item.requirements}
            placeholder="Paste the spec here"
            rows={4}
            onChange={(e) => set({ requirements: e.target.value })}
          />
        </details>
      )}

      {item.type === 'Exam' && (
        <Field label="When / where" wide>
          <TextInput value={item.whenWhere} placeholder="e.g. Oct 14, 7 pm · AQ 3150" onCommit={(whenWhere) => set({ whenWhere })} />
        </Field>
      )}

      {item.type === 'Project' && !isMilestone && (
        <section className="detail-section">
          <h3>
            Milestones <span>{milestones.filter((m) => m.status === 'Submitted').length}/{milestones.length}</span>
          </h3>
          {milestones.length > 0 && (
            <ul className="mini-list">
              {milestones.map((m) => (
                <li key={m.id}>
                  <StatusChip item={m} />
                  <button type="button" className="mini-open" onClick={() => openOverlay({ kind: 'item', id: m.id })}>
                    <span>{m.name}</span>
                    <small>{formatDay(m.due, tz, 'MMM d')}</small>
                  </button>
                  <DueChip item={m} />
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="add-line" onClick={() => openOverlay({ kind: 'add', parentId: item.id })}>
            <Icon name="plus" /> Add milestone
          </button>
        </section>
      )}

      {(item.type !== 'Project' || isMilestone || item.checklist.length > 0) && (
        <Checklist
          label={isMilestone ? 'Checklist' : checklistLabel(item.type)}
          entries={item.checklist}
          placeholder={item.type === 'Exam' ? 'Add a topic' : 'Add a step'}
          onChange={(checklist) => set({ checklist })}
        />
      )}

      {item.type === 'Exam' && (
        <section className="detail-section">
          <h3>Practice material</h3>
          {item.links.length > 0 && (
            <ul className="link-list">
              {item.links.map((link) => (
                <li key={link.id}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.label || link.url}
                  </a>
                  <button
                    type="button"
                    className="icon-button action"
                    aria-label={`Remove ${link.label || link.url}`}
                    onClick={() => set({ links: item.links.filter((l) => l.id !== link.id) })}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <AddLine
            placeholder="Paste a link"
            type="url"
            onAdd={(text) => {
              const url = normalizeUrl(text);
              if (!url) return;
              let label = url;
              try {
                const parsed = new URL(url);
                label = parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
              } catch {
                // keep the raw text
              }
              set({ links: [...item.links, { id: newId(), url, label }] });
            }}
          />
        </section>
      )}

      <Field label="Notes" wide>
        <textarea value={item.notes} rows={3} placeholder="Anything worth remembering" onChange={(e) => set({ notes: e.target.value })} />
      </Field>

      <div className="detail-footer">
        <button type="button" className="action danger-link" onClick={remove}>
          <Icon name="trash" /> Delete
        </button>
      </div>
    </Sheet>
  );
}

/** `group` renders a div: a <label> would forward clicks on its caption to the first button inside. */
function Field({ label, hint, wide, group, children }: { label: string; hint?: string; wide?: boolean; group?: boolean; children: ReactNode }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={`field ${wide ? 'field-wide' : ''}`}>
      <span>
        {label}
        {hint && <small> · {hint}</small>}
      </span>
      {children}
    </Tag>
  );
}

/** Text input that saves on blur or Enter rather than every keystroke. */
function TextInput({
  value,
  onCommit,
  placeholder,
  type = 'text',
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft != null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      type={type}
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NumberInput({
  value,
  onCommit,
  suffix,
  label,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  suffix: string;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft == null) return;
    const text = draft.trim();
    const n = Number(text);
    if (text === '') onCommit(null);
    else if (Number.isFinite(n) && n >= 0 && n <= 100) onCommit(n);
    else {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(null);
  };
  return (
    <span className="field-control suffix-control" aria-invalid={invalid}>
      <input
        inputMode="decimal"
        value={draft ?? (value == null ? '' : String(value))}
        placeholder="—"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span>{suffix}</span>
    </span>
  );
}

function Checklist({
  label,
  entries,
  placeholder,
  onChange,
}: {
  label: string;
  entries: ChecklistEntry[];
  placeholder: string;
  onChange: (entries: ChecklistEntry[]) => void;
}) {
  const progress = checklistProgress({ checklist: entries });
  const patch = (id: string, change: Partial<ChecklistEntry>) => onChange(entries.map((e) => (e.id === id ? { ...e, ...change } : e)));
  return (
    <section className="detail-section">
      <h3>
        {label} {progress.total > 0 && <span>{progress.done}/{progress.total}</span>}
      </h3>
      {entries.length > 0 && (
        <ul className="checklist">
          {entries.map((entry) => (
            <li key={entry.id} data-done={entry.done || undefined}>
              <label className="check">
                <input type="checkbox" checked={entry.done} onChange={(e) => patch(entry.id, { done: e.target.checked })} />
                <span className="check-box" aria-hidden="true">
                  <Icon name="check" />
                </span>
              </label>
              <ChecklistText value={entry.text} onCommit={(text) => (text ? patch(entry.id, { text }) : onChange(entries.filter((e) => e.id !== entry.id)))} />
              <button
                type="button"
                className="icon-button action remove"
                aria-label={`Remove ${entry.text}`}
                onClick={() => onChange(entries.filter((e) => e.id !== entry.id))}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddLine placeholder={placeholder} onAdd={(text) => onChange([...entries, { id: newId(), text, done: false }])} />
    </section>
  );
}

function ChecklistText({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="check-text"
      value={draft ?? value}
      aria-label="Checklist item"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null && draft.trim() !== value) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function AddLine({ placeholder, onAdd, type = 'text' }: { placeholder: string; onAdd: (text: string) => void; type?: string }) {
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <div className="add-line">
      <Icon name="plus" />
      <input
        type={type}
        value={text}
        placeholder={placeholder}
        enterKeyHint="done"
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
