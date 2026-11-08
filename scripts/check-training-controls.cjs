const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Yekaterinburg' });
  await context.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value(pattern) {
      window.__vibrations.push(pattern); return true;
    } });
    window.__testHidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__testHidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__testHidden ? 'hidden' : 'visible' });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const state = () => page.evaluate(async () => (await import('./js/workout-db.js')).readAll());
  const loaded = () => page.waitForFunction(() => document.querySelector('#recordsOverview').children.length > 0);
  const focused = () => page.evaluate(() => document.activeElement.id);
  const vibrations = () => page.evaluate(() => window.__vibrations);
  const clearVibrations = () => page.evaluate(() => { window.__vibrations = []; });
  const rest = page.locator('#restDialog'), finish = page.locator('#finishSessionDialog');
  async function openTraining() {
    if (await page.locator('#trainingSession').isVisible()) return;
    await page.locator('#sectionTrainingButton').click();
  }
  async function sessionAction(id) {
    if (!(await page.locator('#sessionActionsDialog').isVisible())) await page.locator('#openSessionActions').click();
    await page.locator(`#${id}`).click();
  }
  async function waitUntil(check, label) {
    const timeout = Date.now() + 10000;
    while (!(await check())) { assert.ok(Date.now() < timeout, `Timed out: ${label}`); await delay(40); }
  }
  async function screenshot(name) {
    if (!process.env.QA_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, name + '.png'), fullPage: false });
  }
  async function assertNext() {
    const active = (await state()).active;
    const next = ['right', 'left'].flatMap(arm => active.sets[arm].map(set => ({ arm, set }))).find(item => item.set.status === 'pending');
    assert.ok(next);
    assert.equal(await page.locator('#restNext').innerText(), `${next.arm === 'right' ? 'Правая' : 'Левая'} рука · ${next.set.kg.toFixed(1)} кг × ${next.set.reps}`);
    assert.match((await page.locator('#restSprings').innerText()).replace(/\s+/g, ' '), new RegExp(`I\\s*${next.set.i}\\s*/\\s*II\\s*${next.set.j}`));
    assert.match(await page.locator('#restSprings').getAttribute('aria-label'), new RegExp(`Пружина I.*${next.set.i}.*Пружина II.*${next.set.j}`, 'i'));
  }
  async function complete() {
    const active = (await state()).active;
    const current = [...active.sets.right, ...active.sets.left].find(set => set.status === 'pending');
    await page.locator('#completeSet').click();
    await waitUntil(async () => [...(await state()).active.sets.right, ...(await state()).active.sets.left].find(set => set.id === current.id).status === 'done', 'set saved');
  }
  async function assertRestFinished() {
    await rest.waitFor({ state: 'hidden' });
    await waitUntil(async () => (await state()).active.restUntil === null, 'rest saved');
    assert.equal(await page.locator('#completeSet').isEnabled(), true);
    assert.equal(await focused(), 'completeSet');
  }
  async function resumeCompleted() {
    await page.locator('#backToTraining').click(); await page.locator('[data-action=resume]').click();
    await finish.waitFor({ state: 'visible' });
  }
  async function clearTemplatePrompt() {
    if (await page.locator('#updateTemplateDialog').isVisible()) await page.locator('#keepTemplate').click();
  }
  async function failNextWrite() {
    await page.evaluate(() => {
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === 'readwrite') {
          IDBDatabase.prototype.transaction = originalTransaction;
          throw new DOMException('Test storage failure', 'QuotaExceededError');
        }
        return originalTransaction.apply(this, args);
      };
    });
  }
  try {
    await page.goto(process.env.HVAT_URL || 'http://127.0.0.1:8766/'); await loaded();
    await page.evaluate(async () => {
      const db = await import('./js/workout-db.js'), m = await import('./js/workout-model.js');
      const sets = { right: [m.makeSet(m.PAIRS[10], 5), m.makeSet(m.PAIRS[15], 6)], left: [m.makeSet(m.PAIRS[25], 7)] };
      await db.put('templates', { id: 'timer-template', name: 'Отдых', sets, restSec: 65, createdAt: '2026-09-30', updatedAt: '2026-09-30' });
      await db.setMeta('settings', { sound: false });
    });
    await page.reload(); await loaded(); await openTraining();
    await page.locator('[data-action=start-template][data-id=timer-template]').click();
    await page.locator('#sessionActualReps').fill('5'); await complete();
    await rest.waitFor({ state: 'visible' }); await assertNext();
    assert.equal(await page.locator('#sessionQuality').count(), 0);
    assert.ok(await rest.evaluate(el => Math.abs(el.getBoundingClientRect().width - innerWidth) < 1 && Math.abs(el.getBoundingClientRect().height - innerHeight) < 1));
    const original = (await state()).active.restUntil;
    await rest.locator('[data-action=subtract-rest]').click();
    await waitUntil(async () => (await state()).active.restUntil === original - 30000, 'subtract saved');
    await rest.locator('[data-action=add-rest]').evaluate(button => { button.click(); button.click(); button.click(); });
    await waitUntil(async () => (await state()).active.restUntil === original + 60000, 'rapid adjustments saved');
    await rest.locator('[data-action=add-rest]').focus();
    const before = await rest.locator('[data-rest-time]').innerText();
    await page.waitForFunction(text => document.querySelector('#restDialog [data-rest-time]').textContent !== text, before);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'add-rest');
    await rest.locator('[data-action=skip-rest]').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'collapse-rest');
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'skip-rest');
    await screenshot('rest-fullscreen');
    await rest.locator('[data-action=collapse-rest]').click(); await page.locator('#restPanel').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'expand-rest');
    await page.locator('[data-action=expand-rest]').click(); await page.keyboard.press('Escape');
    await page.locator('#restPanel').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'expand-rest');
    const beforeRapidDraft = Number(await page.locator('#sessionActualReps').inputValue());
    await page.evaluate(() => {
      for (let i = 0; i < 6; i++) document.querySelector('#increaseSessionReps').click();
      document.querySelector('[data-action=expand-rest]').click();
      document.querySelector('#restDialog [data-action=add-rest]').click();
    });
    await waitUntil(async () => {
      const active = (await state()).active;
      return active.restUntil === original + 90000 && active.sets.right[1].draftReps === beforeRapidDraft + 6;
    }, 'rapid draft increments and timer adjustment both saved');
    await page.reload(); await loaded();
    await openTraining(); await rest.waitFor({ state: 'visible' }); await assertNext();
    assert.equal((await state()).active.restUntil, original + 90000);
    assert.equal(await page.locator('#sessionActualReps').inputValue(), String(beforeRapidDraft + 6));
    await rest.locator('[data-action=subtract-rest]').evaluate(button => { for (let i = 0; i < 6; i++) button.click(); });
    await assertRestFinished(); assert.deepEqual(await vibrations(), [], 'shortening to zero must not signal');
    await complete(); await rest.waitFor({ state: 'visible' }); await assertNext();
    await rest.locator('[data-action=skip-rest]').click(); await assertRestFinished();
    assert.deepEqual(await vibrations(), [], 'skipping rest must not signal');
    await failNextWrite(); await page.locator('#completeSet').click();
    await waitUntil(async () => (await page.locator('#trainingMessage').innerText()).includes('Не удалось сохранить подход'), 'last set save error');
    assert.equal(await finish.isVisible(), false, 'failed last set must not open completion');
    assert.equal((await state()).active.sets.left[0].status, 'pending');
    assert.equal(await page.locator('#sessionActualReps').isVisible(), true);
    await complete(); await finish.waitFor({ state: 'visible' });
    assert.equal((await state()).workouts.length, 0, 'last set must not automatically finish the workout');
    assert.equal((await state()).active.restUntil, null); assert.equal(await rest.isVisible(), false);
    assert.match(await finish.innerText(), /Подходы закончились/);
    assert.doesNotMatch(await page.locator('#finishSessionSummary').innerText(), /частич/i);
    const buttons = finish.locator('button');
    await buttons.last().focus(); await page.keyboard.press('Tab');
    assert.equal(await focused(), await buttons.first().getAttribute('id'));
    await page.keyboard.press('Shift+Tab'); assert.equal(await focused(), await buttons.last().getAttribute('id'));
    await screenshot('finish-session'); await page.setViewportSize({ width: 320, height: 640 });
    assert.ok(await finish.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width <= innerWidth));
    for (const button of await buttons.all()) assert.ok(await button.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    await screenshot('finish-session-320'); await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#returnToSession').click(); await finish.waitFor({ state: 'hidden' });
    assert.equal(await focused(), 'sessionHero'); await delay(350); assert.equal(await finish.isVisible(), false);
    await sessionAction('undoSet'); await page.locator('#sessionActualReps').waitFor({ state: 'visible' });
    await complete(); await finish.waitFor({ state: 'visible' }); await page.keyboard.press('Escape');
    assert.equal(await focused(), 'sessionHero'); await resumeCompleted(); await page.reload(); await loaded();
    await openTraining(); await finish.waitFor({ state: 'visible' });

    // Fail one write without changing app code or damaging the active workout.
    await failNextWrite();
    await page.locator('#confirmFinishSession').click();
    await waitUntil(async () => !!(await page.locator('#finishSessionError').innerText()), 'save error displayed');
    assert.equal(await finish.isVisible(), true); assert.equal(await page.locator('#confirmFinishSession').isEnabled(), true);
    assert.equal((await state()).workouts.length, 0); assert.ok((await state()).active);
    await page.locator('#confirmFinishSession').evaluate(button => { button.click(); button.click(); });
    await waitUntil(async () => !(await state()).active, 'workout saved'); await finish.waitFor({ state: 'hidden' });
    assert.equal((await state()).workouts.length, 1, 'double confirmation saves exactly once');
    await page.locator('#updateTemplateDialog').waitFor({ state: 'visible' }); await clearTemplatePrompt();

    // Date is fixed, but native intervals still run and can expose duplicate signals.
    await page.clock.setFixedTime(new Date());
    await page.locator('[data-action=start-template][data-id=timer-template]').click();
    await complete(); await rest.waitFor({ state: 'visible' }); await clearVibrations();
    const deadline = (await state()).active.restUntil;
    for (const second of [5, 4, 3, 2, 1, 0]) {
      await page.clock.setFixedTime(new Date(deadline - second * 1000));
      if (second) await waitUntil(async () => (await rest.locator('[data-rest-time]').innerText()) === `00:0${second}`, `countdown ${second}`);
      const expected = second >= 4 ? [] : second === 3 ? [55] : second === 2 ? [55, 55] : second === 1 ? [55, 55, 55] : [55, 55, 55, 240];
      await waitUntil(async () => JSON.stringify(await vibrations()) === JSON.stringify(expected), `vibrations at ${second}`);
      await delay(350); assert.deepEqual(await vibrations(), expected, `no duplicate vibration at ${second}`);
    }
    await assertRestFinished(); await complete(); await rest.waitFor({ state: 'visible' }); await assertNext();
    await rest.locator('[data-action=collapse-rest]').click(); await page.locator('#sessionActualReps').focus();
    await page.clock.setFixedTime(new Date((await state()).active.restUntil));
    await waitUntil(async () => (await state()).active.restUntil === null, 'collapsed rest expired');
    assert.equal(await focused(), 'sessionActualReps', 'collapsed rest does not steal chosen focus');
    await sessionAction('undoSet'); await complete(); await rest.waitFor({ state: 'visible' }); await clearVibrations();
    const hiddenDeadline = (await state()).active.restUntil;
    await page.evaluate(() => { window.__testHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.setFixedTime(new Date(hiddenDeadline + 5000));
    await waitUntil(async () => (await state()).active.restUntil === null, 'hidden rest expired');
    await page.evaluate(() => { window.__testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await delay(350); assert.deepEqual(await vibrations(), [], 'background signals are never replayed');
    await sessionAction('undoSet'); await complete(); await rest.waitFor({ state: 'visible' });
    await clearVibrations();
    await page.evaluate(deadline => {
      const readNow = Date.now;
      window.__testHidden = true; document.dispatchEvent(new Event('visibilitychange'));
      // The deadline passes while timers are throttled; visibilitychange is the first render.
      Date.now = () => deadline + 5000;
      window.__testHidden = false; document.dispatchEvent(new Event('visibilitychange'));
      Date.now = readNow;
    }, (await state()).active.restUntil);
    await waitUntil(async () => (await state()).active.restUntil === null, 'foreground expired rest cleared');
    assert.deepEqual(await vibrations(), [], 'foreground render must not replay the go signal');
    await page.evaluate(async () => {
      const db = await import('./js/workout-db.js');
      await db.setRestUntil((await db.readAll()).active.id, Date.now() - 1000);
    });
    await page.reload(); await loaded();
    await waitUntil(async () => (await state()).active.restUntil === null, 'restored expired rest cleared');
    assert.deepEqual(await vibrations(), [], 'restoring an expired deadline must not replay the go signal');
    await openTraining();
    await sessionAction('undoSet'); await complete(); await rest.waitFor({ state: 'visible' });
    await rest.locator('[data-action=collapse-rest]').click();
    await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok(await page.evaluate(async () => (await caches.keys()).includes('hvat-static-v20')));
    const beforeOffline = await state(); await context.setOffline(true); await page.reload(); await loaded();
    assert.deepEqual((await state()).manualRecords, beforeOffline.manualRecords);
    assert.deepEqual((await state()).active, beforeOffline.active); await context.setOffline(false);
    await openTraining(); await rest.waitFor({ state: 'visible' }); await assertNext();
    await rest.locator('[data-action=skip-rest]').click(); await sessionAction('cancelTraining');
    await waitUntil(async () => !(await state()).active, 'test workout cancelled');

    await page.evaluate(async () => {
      const db = await import('./js/workout-db.js'), m = await import('./js/workout-model.js');
      await db.put('templates', { id: 'skip-template', name: 'Пропуски', sets: m.createPlan(), restSec: 0, createdAt: '2026-09-30', updatedAt: '2026-09-30' });
    });
    await page.reload(); await loaded(); await openTraining();
    for (const allSkipped of [false, true]) {
      await page.locator('[data-action=start-template][data-id=skip-template]').click();
      if (allSkipped) await sessionAction('skipSet'); else await page.locator('#completeSet').click();
      await waitUntil(async () => (await state()).active.sets.right[0].status !== 'pending', 'first set saved');
      await sessionAction('skipSet'); await finish.waitFor({ state: 'visible' });
      assert.match(await page.locator('#finishSessionSummary').innerText(), /частич/i);
      const workoutId = (await state()).active.id; await page.locator('#confirmFinishSession').click();
      await waitUntil(async () => !(await state()).active, 'partial workout saved');
      assert.equal((await state()).workouts.find(workout => workout.id === workoutId).partial, true);
      await clearTemplatePrompt();
    }
    assert.deepEqual(errors, []);
    console.log('PASS rest fullscreen/focus/keyboard/rapid adjustments+draft increments/reload/springs/3-2-1-go/no duplicates/silent mode/background/skip; completion modal/return/Escape/undo/resume/reload/storage retry/double confirm/partial/all skipped/320px; v20 offline reload');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
