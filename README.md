# Due

An assignment tracker for one university student. It's an installable web app (PWA) that answers three questions within five seconds of opening, on a phone or a laptop:

- **What's overdue?**
- **What's due soon?**
- **What should I work on right now?**

It also makes adding new work fast: tap **+**, type a name, pick a date, press Enter.

The visual design follows the "Due" Figma Make file (Inter, neutral ink/wash tokens, pill tabs, the Now list and Courses panel).

## Screens

| Tab | What it shows |
| --- | --- |
| **Now** (opens here) | Everything overdue or with a focus date (Do date, else Due) in the next 7 days, most urgent first. Phone: a Courses strip underneath. Laptop: a Courses panel on the right. |
| **Board** | The same items in Not started / In progress / Submitted columns. Drag cards (long-press on a phone), or tap the status. |
| **Calendar** | A month grid with a count per day, by Due date. Tap a day to list it. Submitted work stays, greyed out. |
| **By course** | Open items per course, by Due, with a link to the course site. |
| **Exams** | Quizzes and exams not yet submitted, with topic progress. |
| **Done** | Submitted work by term and course, with inline grades and each course's grade so far. |

Search (🔍) and Settings (⚙) are in the top bar on every screen. Settings holds only three things: account, export (JSON or CSV), and theme.

**Status is the only routine edit.** Swipe a row right, or tap its status dot, to move it forward (Not started → In progress → Submitted). Every change shows a 5-second **Undo**. Submitted items leave the active screens once that window closes. They're never deleted automatically; they stay in Done and search.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

With no Supabase settings the app runs **local-only**. There's no sign-in, and everything is stored in the browser's IndexedDB. That's enough to try it, or to use it on one device.

### Tests

```bash
npm test             # unit tests: every case from the spec, plus sync/merge logic
npm run test:e2e     # Playwright, against the production build (laptop + phone)
npm run typecheck
```

The spec's test table lives in `src/domain/computed.test.ts`. It runs against a fixed clock (Fri 2026-09-25, 3:00 pm) and in several time zones. The end-to-end suite pins the browser clock to the same moment. It covers quick add, required fields, swipe and undo, board drag, milestones, rollover, recurring labs, export, dark mode, and reopening offline. The first time, run `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium.

## Sync across devices (Supabase)

1. Create a Supabase project.
2. In the SQL editor, run `supabase/migrations/20260925000000_init.sql`. It creates the three tables, row-level security (each user sees only their own rows) and a last-write-wins trigger.
3. **Authentication → Providers**: enable **Google** (it needs a Google OAuth client) and **Email**.
4. **Authentication → Email templates → Magic link**: include `{{ .Token }}` so the email also carries a 6-digit code. On iOS, a home-screen app doesn't share storage with Safari, so typing the code into the app is the reliable way to sign in there.
5. **Authentication → URL configuration**: set the Site URL to where you deploy, and add it to the redirect URLs.
6. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

Sign in once and you stay signed in. The session persists, and a stored session is trusted immediately, so the app opens offline.

## Deploy and install

`npm run build` produces a static site in `dist/`. Any static host works (Vercel, Netlify, Cloudflare Pages), as long as it serves HTTPS, which service workers require. Set the two `VITE_SUPABASE_*` variables in the host's build settings.

On the phone, open the site, then choose **Add to Home Screen** (iOS: Share menu; Android: the browser menu or install prompt). The icon opens straight to Now.

## How it works

```
src/
  domain/      pure logic, no React or storage
    computed.ts   Due in, Urgency, Focus date, Now membership, course stats
    factory.ts    new items/courses/rules, per-type templates
    recurring.ts  weekly rules → items 7 days before due
    rollover.ts   New term planning
    export.ts     JSON / CSV
  data/        local-first storage and sync
    store.ts      in-memory snapshot backed by IndexedDB + an outbox of pending changes
    sync.ts       push outbox → Supabase, pull changes since a cursor, merge
    auth.ts       Google / email sign-in, device ↔ account binding
    actions.ts    the operations the UI calls
  ui/          shared UI pieces (rows, sheets, toast/undo, navigation, theme)
  views/       one file per screen or sheet
```

- **Local-first.** Every read comes from memory, and every write lands in IndexedDB first. Nothing waits on the network, so adding an item or changing a status works in a lecture hall with no signal. Each change is queued in an outbox (one entry per record). The sync engine pushes the outbox and then pulls newer rows. It runs 1.5 s after a change, when the app regains focus or connection, and every minute.
- **Conflicts.** Last write wins, by each record's `updated_at`, both on the device and in a Postgres trigger. Deletes are tombstones (`deleted_at`) so they reach other devices. Item ids are generated on the device. Recurring occurrences get ids derived from their rule, so two offline devices creating the same lab converge on one row.
- **Time.** Due is stored as a UTC instant plus the zone it was entered in, and displayed in the device's zone. A date with no time means 11:59 pm local. `dueIn(item, now, tz)` and `urgency(item, now)` are pure, and the whole app shares one clock that ticks on each minute boundary.
- **Startup.** The service worker precaches the app shell and fonts, and the Supabase client loads lazily after first paint. From the service worker, offline, at 4× CPU throttling, the Now list renders in about 0.4–0.7 s.

### Interpretations of the spec

- **Now window.** "Focus date within the next 7 days" includes today through today + 7, and also a Do date that has already passed on an unsubmitted item. The Do date input can't be set after the Due date, so a Do date can never hide something that's due this week.
- **Milestones** are work items with a `parent` project. They take the project's course, show a "Milestone" badge, and appear in lists as "Project › Milestone". Only top-level projects can have them. Deleting a project, after confirmation, deletes its milestones too.
- **Recurring rules** number occurrences from the start date ("Lab {n}"). A rule added mid-term skips occurrences already past due instead of back-filling them. Turning a course back on doesn't back-fill labs it missed while it was off.
- **Current term** is the term of the most recently added active course. The New term sheet suggests the next one (Fall → Spring → Summer → Fall).
- **CSV export** writes one file per table (items, courses, and recurring rules if there are any). The JSON export holds everything in one file.
