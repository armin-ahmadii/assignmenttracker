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

In dev mode the app runs **local-only**: everything is stored in the browser's IndexedDB. Production builds can sync your devices through Supabase (see below).

### Tests

```bash
npm test             # unit tests: every case from the spec, plus sync/merge logic
npm run test:e2e     # Playwright, against the production build (laptop + phone)
npm run typecheck
```

The spec's test table lives in `src/domain/computed.test.ts`. It runs against a fixed clock (Fri 2026-09-25, 3:00 pm) and in several time zones. The end-to-end suite pins the browser clock to the same moment. It covers quick add, required fields, swipe and undo, board drag, milestones, rollover, recurring labs, export, dark mode, and reopening offline. `e2e/sync.spec.ts` pairs a laptop and a phone (two browsers) through a faked database that follows the same rules as the real functions. The first time, run `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium.

## Sync between your devices

There are no accounts and no sign-in. Your work lives in the Supabase project **Due** (`zwcporulazqyqdnmdloy`, us-west-1). Each of your devices holds one private **sync key**, and the database stores only its hash.

- **First device:** Settings → Sync → **Turn on sync**. This makes the key and registers it; the database accepts exactly one key.
- **Each other device:** open the connect link once (scan the QR code under **Add another device**, or copy the link), or paste the key into Settings → Sync. On iPhone, open Due from the Home Screen and paste it there, because Home Screen apps don't share storage with Safari.
- The key is remembered, so you never enter it again on that device. Anyone with the key can see and change your work, so keep it to your own devices.
- To start over with a new key, delete the row in `private.sync_keys` (Supabase dashboard → Table editor, or SQL) and turn sync on again.

How it's protected: the tables accept no direct API access at all (row-level security with no policies, and no table privileges for the API roles). The app talks to four functions, `due_claim`, `due_check`, `due_push` and `due_pull`, and each checks the key before touching anything. See `supabase/migrations/`.

`.env.production` holds the project URL and publishable key, which are public by design, so production builds sync with no extra setup. `npm run dev` stays local-only unless you add a `.env.local` with the same two values.

## Deploy and install

`npm run build` produces a static site in `dist/`. Any static host works (Vercel, Netlify, Cloudflare Pages), as long as it serves HTTPS, which service workers require. The Supabase settings come from `.env.production`, so the host needs no extra configuration.

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
    sync.ts       push outbox → database, pull changes since a cursor, merge
    syncKey.ts    the device's private sync key (generate, normalise, connect links)
    syncSetup.ts  turn on sync, connect a device, disconnect
    remote.ts     fetch wrapper for the database functions
    actions.ts    the operations the UI calls
  ui/          shared UI pieces (rows, sheets, toast/undo, navigation, theme)
  views/       one file per screen or sheet
```

- **Local-first.** Every read comes from memory, and every write lands in IndexedDB first. Nothing waits on the network, so adding an item or changing a status works in a lecture hall with no signal. Each change is queued in an outbox (one entry per record). The sync engine pushes the outbox and then pulls newer rows through the `due_*` functions, using plain `fetch` with no SDK. It runs 1.5 s after a change, when the app regains focus or connection, and every minute.
- **Conflicts.** Last write wins, by each record's `updated_at`, both on the device and in a Postgres trigger. Deletes are tombstones (`deleted_at`) so they reach other devices. Item ids are generated on the device. Recurring occurrences get ids derived from their rule, so two offline devices creating the same lab converge on one row.
- **Time.** Due is stored as a UTC instant plus the zone it was entered in, and displayed in the device's zone. A date with no time means 11:59 pm local. `dueIn(item, now, tz)` and `urgency(item, now)` are pure, and the whole app shares one clock that ticks on each minute boundary.
- **Startup.** The service worker precaches the app shell and fonts, and sync starts only after first paint. From the service worker, offline, at 4× CPU throttling, the Now list renders in about 0.4–0.7 s.

### Interpretations of the spec

- **Now window.** "Focus date within the next 7 days" includes today through today + 7, and also a Do date that has already passed on an unsubmitted item. The Do date input can't be set after the Due date, so a Do date can never hide something that's due this week.
- **Milestones** are work items with a `parent` project. They take the project's course, show a "Milestone" badge, and appear in lists as "Project › Milestone". Only top-level projects can have them. Deleting a project, after confirmation, deletes its milestones too.
- **Recurring rules** number occurrences from the start date ("Lab {n}"). A rule added mid-term skips occurrences already past due instead of back-filling them. Turning a course back on doesn't back-fill labs it missed while it was off.
- **Current term** is the term of the most recently added active course. The New term sheet suggests the next one (Fall → Spring → Summer → Fall).
- **CSV export** writes one file per table (items, courses, and recurring rules if there are any). The JSON export holds everything in one file.
