const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Yekaterinburg' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const state = () => page.evaluate(async () => (await import('./js/workout-db.js')).readAll());
  const loaded = async () => page.waitForFunction(() => document.querySelector('#recordsOverview').children.length > 0);
  const screenshotDir = process.env.QA_SCREENSHOT_DIR;
  async function screenshot(name) {
    if (!screenshotDir) return;
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, name + '.png'), fullPage: name !== 'rest-fullscreen' });
  }
  try {
    await page.goto('http://127.0.0.1:8765/');
    await loaded();
    await page.evaluate(async () => {
      const db = await import('./js/workout-db.js'), m = await import('./js/workout-model.js');
      const sets = m.createPlan();
      sets.right.push(m.makeSet(m.PAIRS[15], 5));
      await db.put('templates', { id: 'timer-template', name: 'Отдых', sets, restSec: 65, createdAt: '2026-09-30', updatedAt: '2026-09-30' });
      await db.setMeta('settings', { sound: false });
    });
    await page.reload(); await loaded();
    await page.locator('#sectionTrainingButton').click();
    await page.locator('[data-action=start-template]').click();
    await page.locator('#sessionActualReps').fill('5');
    await page.locator('#completeSet').click();
    const rest = page.locator('#restDialog');
    await rest.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sessionQuality').count(), 0);
    assert.ok(await rest.evaluate(el => Math.abs(el.getBoundingClientRect().width - innerWidth) < 1 && Math.abs(el.getBoundingClientRect().height - innerHeight) < 1));
    const original = (await state()).active.restUntil;
    await rest.locator('[data-action=subtract-rest]').click();
    await page.waitForFunction(async deadline => (await (await import('./js/workout-db.js')).readAll()).active.restUntil === deadline - 30000, original);
    // Multiple taps must preserve every adjustment, including their saved deadline.
    await rest.locator('[data-action=add-rest]').evaluate(button => { button.click(); button.click(); button.click(); });
    await page.waitForFunction(async deadline => (await (await import('./js/workout-db.js')).readAll()).active.restUntil === deadline + 60000, original);
    await rest.locator('[data-action=add-rest]').focus();
    const before = await rest.locator('[data-rest-time]').innerText();
    await page.waitForFunction(text => document.querySelector('#restDialog [data-rest-time]').textContent !== text, before);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'add-rest');
    await rest.locator('[data-action=skip-rest]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action),'collapse-rest');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action),'skip-rest');
    await screenshot('rest-fullscreen');
    await rest.locator('[data-action=collapse-rest]').click();
    await page.locator('#restPanel').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'expand-rest');
    await page.locator('[data-action=expand-rest]').click();
    await rest.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#restPanel').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'expand-rest');
    await page.locator('[data-action=expand-rest]').click();
    await page.reload(); await loaded();
    await page.locator('#sectionTrainingButton').click();
    await rest.waitFor({ state: 'visible' });
    assert.equal((await state()).active.restUntil, original + 60000);
    await rest.locator('[data-action=subtract-rest]').evaluate(button => { for (let i = 0; i < 5; i++) button.click(); });
    await rest.waitFor({ state: 'hidden' });
    await page.waitForFunction(async () => (await (await import('./js/workout-db.js')).readAll()).active.restUntil === null);
    assert.equal(await page.locator('#completeSet').isEnabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sessionActualReps');

    await page.locator('#completeSet').click();
    await rest.waitFor({ state: 'visible' });
    await rest.locator('[data-action=collapse-rest]').click();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok(await page.evaluate(async () => (await caches.keys()).includes('hvat-static-v11')));
    const recordsBeforeOffline = (await state()).manualRecords;
    await context.setOffline(true);
    await page.reload(); await loaded();
    assert.deepEqual((await state()).manualRecords, recordsBeforeOffline);
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log('PASS timer fullscreen/keyboard/focus/rapid adjustments/collapse/reload/expiry/skip; exact manual RM/export v3/import/deletion; v11 offline reload');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
