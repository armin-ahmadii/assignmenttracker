import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { useRowContext } from '../ui/selectors';
import { WorkRow } from '../ui/WorkRow';

/** Every item, including submitted work and courses that are turned off. */
export function SearchSheet() {
  const { items, coursesById } = useStore();
  const rowContext = useRowContext();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return items
      .filter((item) => {
        const course = coursesById.get(item.courseId);
        const haystack = [item.name, item.type, item.notes, item.status, course?.code, course?.term, item.whenWhere]
          .join(' ')
          .toLowerCase();
        return terms.every((t) => haystack.includes(t));
      })
      .sort((a, b) => {
        const open = Number(a.status === 'Submitted') - Number(b.status === 'Submitted');
        return open || Date.parse(a.due) - Date.parse(b.due);
      })
      .slice(0, 60);
  }, [items, coursesById, query]);

  return (
    <Sheet title="Search" size="large" className="search-sheet">
      <div className="search-box">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          autoFocus
          placeholder="Search names, courses, notes"
          aria-label="Search all work"
          enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {query.trim() === '' ? (
        <p className="empty-state small">Searches every item, including submitted work and past terms.</p>
      ) : results.length ? (
        <div className="work-list">
          {results.map((item, index) => (
            <WorkRow key={item.id} item={item} index={index} {...rowContext(item)} />
          ))}
        </div>
      ) : (
        <p className="empty-state small">No matches for “{query.trim()}”.</p>
      )}
    </Sheet>
  );
}
