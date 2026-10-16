const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Yekaterinburg' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const state = () => page.evaluate(async () => (await import('./js/workout-db.js')).readAll());
  try {
    await page.goto('http://127.0.0.1:8765/');
    await page.waitForFunction(() => document.querySelector('#recordsOverview').children.length > 0);
    await page.locator('#sectionProgressionButton').click();
    await page.locator('[data-prog=create]').click();
    await page.locator('[name=name]').fill('Подготовка рук');
    await page.locator('[data-prog=weeks-preset][data-weeks="52"]').click();
    await page.locator('[name=targetDate]').fill('2027-10-03');
    await page.getByRole('button', { name: 'Далее', exact: true }).click();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.name), 'right-mode');
    await page.locator('[name=right-mode]').selectOption('pair');
    assert.equal(await page.locator('[name=right-base]').evaluate(el => el.required), false);
    assert.equal(await page.locator('[data-base-field=right-pair]').isVisible(), true);
    await page.locator('[name=right-pair]').selectOption('10-12');
    await page.locator('[name=left-base]').fill('80');
    await page.locator('[name=right-confirmed]').check();
    await page.locator('[name=left-confirmed]').check();
    await page.getByRole('button', { name: 'Далее', exact: true }).click();
    assert.equal(await page.locator('.period-item').count(), 4);
    assert.equal(await page.locator('.prog-week').count(), 52);
    await page.locator('#progressionDialog .prog-week').last().evaluate(el => { el.open = true; });
    assert.ok(await page.locator('#progressionDialog').innerText().then(t => t.includes('добав') || t.includes('предел')));
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('#progressionDialog').evaluate(el => el.scrollWidth <= el.clientWidth));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.QA_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'macrocycle-preview.png') });
    }
    await page.getByRole('button', { name: 'Запустить программу', exact: true }).click();
    await page.locator('#progressionDialog').waitFor({ state: 'hidden' });
    let data = await state();
    assert.equal(data.progressions[0].slots.length, 156);
    assert.equal(data.progressions[0].config.arms.right.base, 120.4);
    assert.equal(data.progressions[0].config.arms.left.base, 80);
    const original = data.progressions[0].slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms }));
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-prog=start]').click();
    await page.locator('#sessionActualReps').waitFor();
    await page.locator('#sessionActualReps').fill('7');
    await page.locator('#sessionActualReps').dispatchEvent('change');
    await page.reload();
    await page.locator('#sectionTrainingButton').click();
    await page.locator('#sessionActualReps').waitFor();
    assert.equal(await page.locator('#sessionActualReps').inputValue(), '7');
    let first = true;
    while (await page.locator('#sessionActualReps').count()) {
      if (first) { await page.locator('#sessionActualReps').fill('0'); first = false; }
      const before=await page.locator('#sessionProgress').innerText();
      await page.locator('#completeSet').click();
      await page.waitForFunction(before=>document.querySelector('#sessionProgress').textContent!==before,before);
      if (await page.locator('#restDialog').isVisible()) await page.locator('#restDialog [data-action=skip-rest]').click();
    }
    await page.locator('#finishTraining').click();
    await page.waitForFunction(async () => (await (await import('./js/workout-db.js')).readAll()).workouts.length === 1);
    data = await state();
    assert.equal(data.progressions[0].slots[0].status, 'completed'); // Warmup shortfall is outside the working-set credit.
    assert.deepEqual(data.progressions[0].slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms })), original);
    await page.locator('#sectionProgressionButton').click();
    await page.locator('[data-prog=skip]').click();
    data = await state();
    assert.equal(data.progressions[0].slots[1].status, 'skipped');
    assert.deepEqual(data.progressions[0].slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms })), original);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok(await page.evaluate(async () => (await caches.keys()).includes('hvat-static-v11')));
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#recordsOverview').children.length > 0);
    await page.locator('#sectionProgressionButton').click();
    await page.locator('#progressionRoot h1').waitFor();
    assert.deepEqual((await state()).progressions[0].slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms })), original);
    await context.setOffline(false);
    if (process.env.QA_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'macrocycle-mobile.png'), fullPage: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'macrocycle-mobile-top.png') });
    }
    assert.deepEqual(errors, []);
    console.log('PASS three-step wizard, independent bases, 52-week preview, 4 widths, reload/draft repetitions, fixed workout/skip, v11 offline');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
