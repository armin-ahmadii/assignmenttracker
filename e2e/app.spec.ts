import { expect, test, type Locator, type Page } from '@playwright/test';

// The spec's reference clock: Fri 2026-09-25, 3:00 pm in Vancouver.
const NOW = new Date('2026-09-25T15:00:00-07:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Now', level: 1 })).toBeVisible();
});

const visible = (locator: Locator) => locator.filter({ visible: true }).first();

async function openQuickAdd(page: Page) {
  await visible(page.getByRole('button', { name: 'Add work' })).click();
  return page.getByRole('dialog', { name: 'Quick add' });
}

interface NewWork {
  name: string;
  date: string;
  time?: string;
  type?: string;
  /** Types a new course code instead of picking one. */
  newCourse?: string;
}

async function quickAdd(page: Page, work: NewWork) {
  const sheet = await openQuickAdd(page);
  await sheet.getByLabel('Name').fill(work.name);
  if (work.newCourse) {
    const course = sheet.getByLabel('Course', { exact: true });
    if ((await course.evaluate((el) => el.tagName)) === 'SELECT') await course.selectOption({ label: 'New course…' });
    await sheet.getByLabel('Course', { exact: true }).fill(work.newCourse);
  }
  if (work.type) await sheet.getByLabel('Type').selectOption(work.type);
  await sheet.getByLabel('Due date').fill(work.date);
  if (work.time) await sheet.getByLabel('Due time').fill(work.time);
  await sheet.getByLabel('Name').press('Enter');
  await expect(sheet).toBeHidden();
}

/** Wait until an item's saved copy in IndexedDB matches, so a reload can't race the write. */
async function waitForSaved(page: Page, name: string, field: string, value: unknown) {
  await page.waitForFunction(
    ({ name, field, value }) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open('due');
        open.onsuccess = () => {
          const request = open.result.transaction('items').objectStore('items').getAll();
          request.onsuccess = () => {
            const item = request.result.find((i: { name: string }) => i.name === name);
            open.result.close();
            resolve(Boolean(item) && item[field] === value);
          };
        };
      }),
    { name, field, value },
  );
}

function row(page: Page, name: string) {
  return visible(page.locator('.row-wrap').filter({ hasText: name }));
}

async function swipeRight(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 80, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, y, { steps: 4 });
  await page.mouse.move(box.x + 240, y, { steps: 6 });
  await page.mouse.up();
}

test('first run: capture an item in one sheet, with remembered course and defaults', async ({ page }) => {
  await expect(page.getByText('Nothing overdue or due in the next 7 days.')).toBeVisible();

  await quickAdd(page, { name: 'Lab 4 – Linked Lists', newCourse: 'cmpt 225', date: '2026-09-28' });

  const lab = row(page, 'Lab 4 – Linked Lists');
  await expect(lab).toContainText('CMPT 225');
  await expect(lab).toContainText('Assignment');
  await expect(lab.locator('.due-chip')).toHaveText('In 3d');
  await expect(lab.locator('.due-chip')).toHaveClass(/orange/);

  // The next capture defaults to the last course, Assignment, and 11:59 pm.
  const sheet = await openQuickAdd(page);
  await expect(sheet.getByLabel('Course', { exact: true })).toHaveValue(/.+/);
  await expect(sheet.getByLabel('Course', { exact: true }).locator('option:checked')).toHaveText('CMPT 225');
  await expect(sheet.getByLabel('Type')).toHaveValue('Assignment');
  await expect(sheet.getByLabel('Due time')).toHaveValue('23:59');
});

test('a date without a time is due at 11:59 pm', async ({ page }) => {
  await quickAdd(page, { name: 'Essay draft', newCourse: 'ENGL 112', date: '2026-09-28' });
  await row(page, 'Essay draft').locator('.row-open').click();
  await expect(page.getByRole('dialog')).toContainText('Due Mon, Sep 28 at 11:59 pm');
});

test('name, course and due are required', async ({ page }) => {
  const sheet = await openQuickAdd(page);
  await sheet.getByRole('button', { name: 'Add work' }).click();
  await expect(sheet.getByText('Name is required')).toBeVisible();
  await expect(sheet.getByText('Course is required')).toBeVisible();
  await expect(sheet.getByText('Due date is required')).toBeVisible();

  await sheet.getByLabel('Name').fill('Quiz 3');
  await sheet.getByLabel('Name').press('Enter');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Name is required')).toBeHidden();
});

test('swipe or tap the chip to move status forward, with a 5-second undo', async ({ page }) => {
  await quickAdd(page, { name: 'Problem set 5', newCourse: 'MATH 232', date: '2026-09-25' });
  const ps = row(page, 'Problem set 5');
  await expect(ps.locator('.due-chip')).toHaveText('Today 11:59 pm');

  await swipeRight(page, ps);
  await expect(ps.locator('.status-chip')).toHaveAttribute('data-status', 'In progress');
  const toast = page.locator('.toast');
  await expect(toast).toContainText('In progress');

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(ps.locator('.status-chip')).toHaveAttribute('data-status', 'Not started');

  // Tap the chip twice: In progress, then Submitted.
  await ps.locator('.status-chip').click();
  await ps.locator('.status-chip').click();
  await expect(toast).toContainText('Submitted');
  // It stays (greyed) while the undo is available, then leaves the Now list.
  await expect(ps).toHaveAttribute('data-status', 'Submitted');
  await page.clock.fastForward(5100);
  await expect(toast).toBeHidden();
  await expect(page.getByText('Nothing overdue or due in the next 7 days.')).toBeVisible();

  // Never deleted: it's in Done, where the grade can be entered in the row.
  await visible(page.getByRole('button', { name: 'Done', exact: true })).click();
  const done = row(page, 'Problem set 5');
  await done.getByLabel(/Grade for Problem set 5/).fill('88');
  await done.getByLabel(/Grade for Problem set 5/).press('Enter');
  await waitForSaved(page, 'Problem set 5', 'grade', 88);
  await page.reload();
  await expect(row(page, 'Problem set 5').getByLabel(/Grade for Problem set 5/)).toHaveValue('88');
});

test('deleting asks for confirmation', async ({ page }) => {
  await quickAdd(page, { name: 'Reading 3', newCourse: 'ENGL 112', date: '2026-09-27', type: 'Reading' });
  await row(page, 'Reading 3').locator('.row-open').click();
  const detail = page.getByRole('dialog', { name: 'Reading 3' });
  await detail.getByRole('button', { name: 'Delete' }).click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Delete “Reading 3”?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(detail).toBeVisible();

  await detail.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.row-wrap', { hasText: 'Reading 3' })).toHaveCount(0);
});

test('Now is sorted by urgency', async ({ page }) => {
  await quickAdd(page, { name: 'Big project', newCourse: 'CMPT 276', date: '2026-09-29', time: '15:00' });
  await quickAdd(page, { name: 'Tiny quiz', date: '2026-09-25', time: '21:00', type: 'Quiz' });
  await quickAdd(page, { name: 'Late lab', date: '2026-09-24', time: '23:59', type: 'Lab' });
  const names = page.locator('.work-list').filter({ visible: true }).first().locator('.work-name');
  await expect(names).toHaveText(['Late lab', 'Tiny quiz', 'Big project']);
  await expect(row(page, 'Late lab').locator('.due-chip')).toHaveText('Overdue 16h');
});

test('board: drag a card onto Submitted', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse drag; phones use long-press or the status chip');
  await quickAdd(page, { name: 'Lab 5', newCourse: 'CMPT 225', date: '2026-09-30', type: 'Lab' });
  await page.getByRole('button', { name: 'Board', exact: true }).first().click();

  const card = page.locator('.board-card', { hasText: 'Lab 5' });
  const target = page.locator('[data-column="Submitted"]');
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.toast')).toContainText('Submitted');
  await expect(target.locator('.board-card', { hasText: 'Lab 5' })).toBeVisible();
  await page.clock.fastForward(5100);
  await expect(page.locator('.board-card', { hasText: 'Lab 5' })).toHaveCount(0);
});

test('project milestones show as their own rows', async ({ page }) => {
  await quickAdd(page, { name: 'Term project', newCourse: 'CMPT 276', date: '2026-10-20', type: 'Project' });
  await visible(page.getByRole('button', { name: 'By course', exact: true })).click();
  await row(page, 'Term project').locator('.row-open').click();
  await page.getByRole('button', { name: 'Add milestone' }).click();

  const sheet = page.getByRole('dialog', { name: 'Add milestone' });
  await sheet.getByLabel('Name').fill('API integration');
  await sheet.getByLabel('Due date').fill('2026-09-27');
  await sheet.getByLabel('Name').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Term project' })).toContainText('API integration');

  await page.keyboard.press('Escape');
  await visible(page.getByRole('button', { name: 'Now', exact: true })).click();
  const milestone = row(page, 'API integration');
  await expect(milestone).toContainText('Term project › API integration');
  await expect(milestone).toContainText('CMPT 276');
  await expect(milestone).toContainText('Milestone');
});

test('semester rollover: new courses on, last term off, old work still searchable', async ({ page }) => {
  await quickAdd(page, { name: 'Old lab', newCourse: 'CMPT 225', date: '2026-09-28', type: 'Lab' });

  await visible(page.getByRole('button', { name: 'Manage' })).click();
  await page.getByRole('dialog', { name: 'Courses' }).getByRole('button', { name: 'New term' }).click();
  const sheet = page.getByRole('dialog', { name: 'New term' });
  await expect(sheet.getByLabel('Term name')).toHaveValue('Spring 2027');
  await sheet.getByLabel('Course codes, one per line').fill('CMPT 300\nstat 270');
  await expect(sheet.getByText('CMPT 225')).toBeVisible();
  await expect(sheet.getByRole('checkbox', { name: 'Turn off' })).toBeChecked();
  await sheet.getByRole('button', { name: 'Start Spring 2027' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Nothing overdue or due in the next 7 days.')).toBeVisible();
  const courses = visible(page.locator('.courses-panel, .mobile-courses'));
  await expect(courses).toContainText('CMPT 300');
  await expect(courses).toContainText('STAT 270');
  await expect(courses).not.toContainText('CMPT 225');

  await visible(page.getByRole('button', { name: 'Search' })).click();
  await page.getByRole('searchbox').fill('old lab');
  await expect(page.getByRole('dialog', { name: 'Search' })).toContainText('Old lab');
});

test('recurring labs appear 7 days before they are due', async ({ page }) => {
  await visible(page.getByRole('button', { name: 'Manage' })).click();
  await page.getByRole('dialog', { name: 'Courses' }).getByRole('button', { name: 'Add course' }).click();
  const editor = page.getByRole('dialog', { name: 'Add course' });
  await editor.getByLabel('Code').fill('CMPT 225');
  await editor.getByRole('button', { name: 'Add course', exact: true }).click();

  const course = page.getByRole('dialog', { name: 'CMPT 225' });
  await course.getByRole('button', { name: 'Add recurring rule' }).click();
  await course.getByLabel('Due every').selectOption('Thursday');
  await course.getByLabel('Starting').fill('2026-09-01');
  await course.getByRole('button', { name: 'Save rule' }).click();
  await expect(course).toContainText('Thursdays at 11:59 pm');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Labs 1–4 were already past; Lab 5 (Thu Oct 1) is inside its 7-day window.
  const lab5 = row(page, 'Lab 5');
  await expect(lab5).toContainText('Lab');
  await expect(lab5.locator('.due-chip')).toHaveText('In 6d');
  await expect(page.locator('.row-wrap', { hasText: 'Lab 4' })).toHaveCount(0);
  await expect(page.locator('.row-wrap', { hasText: 'Lab 6' })).toHaveCount(0);

  // A week later Lab 6 shows up on its own.
  await page.clock.fastForward(7 * 24 * 60 * 60 * 1000);
  await expect(row(page, 'Lab 6')).toBeVisible();
});

test('works offline: opens without a connection and keeps new work', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Now', level: 1 })).toBeVisible();
  await expect(page.locator('.offline-pill')).toBeVisible();

  await quickAdd(page, { name: 'Written in the lecture hall', newCourse: 'MATH 232', date: '2026-09-26' });
  await expect(row(page, 'Written in the lecture hall')).toBeVisible();
  await waitForSaved(page, 'Written in the lecture hall', 'status', 'Not started');
  await page.reload();
  await expect(row(page, 'Written in the lecture hall')).toBeVisible();
});

test('dark mode follows the system', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(21, 21, 21)');
  await context.close();
});

test('exams view lists quizzes and exams with topic progress', async ({ page }) => {
  await quickAdd(page, { name: 'Midterm 1', newCourse: 'MATH 232', date: '2026-10-02', time: '19:00', type: 'Exam' });
  await visible(page.getByRole('button', { name: 'Exams', exact: true })).click();
  await row(page, 'Midterm 1').locator('.row-open').click();
  const detail = page.getByRole('dialog', { name: 'Midterm 1' });
  for (const topic of ['Eigenvalues', 'Determinants', 'Rank']) {
    await detail.getByLabel('Add a topic').fill(topic);
    await detail.getByLabel('Add a topic').press('Enter');
  }
  await detail.locator('.check').first().click();
  await page.keyboard.press('Escape');
  await expect(row(page, 'Midterm 1')).toContainText('Fri, Oct 2, 7:00 pm');
  await expect(row(page, 'Midterm 1')).toContainText('Topics 1/3');
});

test('export contains all data as JSON and CSV', async ({ page }) => {
  await quickAdd(page, { name: 'Lab 4, "linked" lists', newCourse: 'CMPT 225', date: '2026-09-28', type: 'Lab' });
  await visible(page.getByRole('button', { name: 'Settings' })).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });

  const [json] = await Promise.all([page.waitForEvent('download'), settings.getByRole('button', { name: 'Download JSON' }).click()]);
  const data = JSON.parse(await streamText(await json.createReadStream()));
  expect(data.courses.map((c: { code: string }) => c.code)).toEqual(['CMPT 225']);
  expect(data.items[0]).toMatchObject({ name: 'Lab 4, "linked" lists', type: 'Lab', status: 'Not started' });
  expect(data.items[0].checklist.map((c: { text: string }) => c.text)).toEqual(['Pre-lab', 'In lab', 'Write-up']);

  const downloads: string[] = [];
  page.on('download', async (d) => downloads.push(`${d.suggestedFilename()}\n${await streamText(await d.createReadStream())}`));
  await settings.getByRole('button', { name: 'Download CSV' }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const items = downloads.find((d) => d.startsWith('due-items'))!;
  expect(items).toContain('"Lab 4, ""linked"" lists",CMPT 225,Fall 2026,Lab');
  expect(downloads.find((d) => d.startsWith('due-courses'))).toContain('CMPT 225,Fall 2026,true');
});

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
