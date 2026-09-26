import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Two devices, one database. The database is faked here with the same rules as
 * the Postgres functions in supabase/migrations: one key, last write wins,
 * pulls ordered by a server-side change clock.
 */
class FakeDatabase {
  key: string | null = null;
  tables: Record<string, Map<string, Record<string, unknown>>> = {
    courses: new Map(),
    work_items: new Map(),
    recurring_rules: new Map(),
  };
  private tick = 0;

  handle(fn: string, args: Record<string, unknown>): { status: number; body: unknown } {
    const authorised = this.key != null && args.key === this.key;
    const denied = { status: 403, body: { code: '28000', message: 'invalid sync key' } };
    switch (fn) {
      case 'due_claim':
        if (this.key) return { status: 200, body: false };
        this.key = args.key as string;
        return { status: 200, body: true };
      case 'due_check':
        return { status: 200, body: authorised };
      case 'due_push': {
        if (!authorised) return denied;
        const table = this.tables[args.tbl as string];
        for (const row of args.rows as Record<string, unknown>[]) {
          const existing = table.get(row.id as string);
          if (existing && (row.updated_at as string) < (existing.updated_at as string)) continue;
          table.set(row.id as string, { ...row, server_updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++this.tick)).toISOString() });
        }
        return { status: 200, body: (args.rows as unknown[]).length };
      }
      case 'due_pull': {
        if (!authorised) return denied;
        const since = args.since as string | null;
        const rows = [...this.tables[args.tbl as string].values()]
          .filter((r) => !since || (r.server_updated_at as string) > since)
          .sort((a, b) => (a.server_updated_at as string).localeCompare(b.server_updated_at as string));
        return { status: 200, body: rows };
      }
    }
    return { status: 404, body: { message: 'no such function' } };
  }

  async attach(context: BrowserContext) {
    await context.route('https://db.due.test/rest/v1/rpc/*', async (route) => {
      const fn = new URL(route.request().url()).pathname.split('/').pop()!;
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const { status, body } = this.handle(fn, route.request().postDataJSON());
      await route.fulfill({ status, body: JSON.stringify(body), headers: { ...cors, 'content-type': 'application/json' } });
    });
  }
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const visible = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();

async function quickAdd(page: Page, name: string, course: string, date: string) {
  await page.getByRole('button', { name: 'Add work' }).filter({ visible: true }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Quick add' });
  await sheet.getByLabel('Name').fill(name);
  const courseField = sheet.getByLabel('Course', { exact: true });
  if ((await courseField.evaluate((el) => el.tagName)) === 'SELECT') await courseField.selectOption({ label: 'New course…' });
  await sheet.getByLabel('Course', { exact: true }).fill(course);
  await sheet.getByLabel('Due date').fill(date);
  await sheet.getByLabel('Name').press('Enter');
  await expect(sheet).toBeHidden();
}

async function openSettings(page: Page) {
  await visible(page, 'Settings').click();
  return page.getByRole('dialog', { name: 'Settings' });
}

/** Local writes sync 1.5 s after the last change; "Sync now" makes it immediate. */
async function syncNow(page: Page) {
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Sync now' }).click();
  await expect(settings.getByText(/All changes synced/)).toBeVisible();
  await page.keyboard.press('Escape');
}

test.use({ serviceWorkers: 'block' });

test('pair a phone with the laptop: no accounts, one key', async ({ browser }) => {
  const db = new FakeDatabase();
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await db.attach(laptop);
  await db.attach(phone);
  const lap = await laptop.newPage();
  const ph = await phone.newPage();

  // The laptop has been used alone for a while, then turns on sync.
  await lap.goto('/');
  await quickAdd(lap, 'Lab 4 – Linked Lists', 'CMPT 225', '2026-09-28');
  let settings = await openSettings(lap);
  await expect(settings.getByText('This device only')).toBeVisible();
  await settings.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(settings.getByText(/All changes synced/)).toBeVisible();
  expect(db.tables.work_items.size).toBe(1);
  expect(db.tables.courses.size).toBe(1);

  await settings.getByRole('button', { name: 'Add another device' }).click();
  const key = (await settings.locator('.sync-key').textContent())!;
  expect(key).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
  await expect(settings.locator('.qr svg')).toBeVisible();
  await lap.keyboard.press('Escape');

  // The phone opens the link once and has the laptop's work.
  await ph.goto(`/#connect=${key}`);
  await expect(ph.locator('.toast')).toContainText('Connected');
  await expect(ph).toHaveURL(/#\/now$/);
  const row = ph.locator('.row-wrap', { hasText: 'Lab 4 – Linked Lists' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('CMPT 225');

  // A status change on the phone reaches the laptop.
  await row.locator('.status-chip').click();
  await expect(row.locator('.status-chip')).toHaveAttribute('data-status', 'In progress');
  await syncNow(ph);
  await syncNow(lap);
  await expect(lap.locator('.row-wrap', { hasText: 'Lab 4 – Linked Lists' }).locator('.status-chip')).toHaveAttribute(
    'data-status',
    'In progress',
  );

  // Work added on the phone offline arrives once it's back online.
  await phone.setOffline(true);
  await quickAdd(ph, 'Quiz 3', 'MATH 232', '2026-09-30');
  settings = await openSettings(ph);
  await expect(settings.getByText(/Offline\. 2 changes will sync/)).toBeVisible();
  await ph.keyboard.press('Escape');
  await phone.setOffline(false);
  await expect.poll(() => db.tables.work_items.size, { timeout: 10_000 }).toBe(2);
  await syncNow(lap);
  await expect(lap.locator('.row-wrap', { hasText: 'Quiz 3' })).toBeVisible();

  // The key survives a restart: no pairing again.
  await ph.reload();
  settings = await openSettings(ph);
  await expect(settings.getByText('Syncing with your database')).toBeVisible();

  await laptop.close();
  await phone.close();
});

test('a third device can paste the key; a wrong key or a second "Turn on" is refused', async ({ browser }) => {
  const db = new FakeDatabase();
  db.key = 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await db.attach(context);
  const page = await context.newPage();
  await page.goto('/');

  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(settings.getByText('Sync is already on for another device')).toBeVisible();

  const field = settings.getByLabel(/Paste its sync key or link/);
  await field.fill('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ');
  await settings.getByRole('button', { name: 'Connect' }).click();
  await expect(settings.getByText("That key doesn't match")).toBeVisible();

  await field.fill('nope');
  await settings.getByRole('button', { name: 'Connect' }).click();
  await expect(settings.getByText("That doesn't look like a sync key")).toBeVisible();

  // Pasting the whole link works too, typed sloppily or not.
  await field.fill('https://due.example/#connect=aaaaa-bbbbb-ccccc-ddddd-eeeee');
  await settings.getByRole('button', { name: 'Connect' }).click();
  await expect(settings.getByText('Syncing with your database')).toBeVisible();
  await context.close();
});
