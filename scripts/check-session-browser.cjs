const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Asia/Yekaterinburg' });
  const page = await context.newPage(), errors = [], evidence = { viewports: [], checks: [], focus: [] };
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const state = () => page.evaluate(async () => (await import('./js/workout-db.js')).readAll());
  const pending = active => ['right', 'left'].flatMap(arm => active.sets[arm]).find(set => set.status === 'pending');
  async function capture(name, fullPage = false) {
    if (!process.env.QA_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, name + '.png'), fullPage });
  }
  async function sessionAction(id) {
    await page.locator('#openSessionActions').click();
    await page.locator('#sessionActionsDialog').waitFor({ state: 'visible' });
    await page.locator(`#${id}`).click();
  }
  async function resumeSession() {
    if (await page.locator('#trainingSession').isVisible()) return;
    const resumeCycle = page.locator('#cycleRoot [data-cycle-action=resume-workout]');
    if (await resumeCycle.isVisible()) await resumeCycle.click();
    else await page.locator('#sectionTrainingButton').click();
    await page.locator('#sessionActualReps').waitFor({ state: 'visible' });
  }
  async function planState() {
    return page.evaluate(() => {
      const visibleText = element => {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('.session-sr-only,.sr-only,[hidden],.hidden').forEach(hidden => hidden.remove());
        return clone.textContent.replace(/\s+/g, ' ').trim();
      };
      return { open: document.querySelector('#sessionPlan').open, visibleText: visibleText(document.querySelector('#sessionQueue')), rows: [...document.querySelectorAll('.session-plan-row')].map(row => {
        const marker = row.querySelector('.session-set-state svg');
        return { state: row.dataset.state, current: row.getAttribute('aria-current'), text: visibleText(row), status: row.querySelector('.session-sr-only,.sr-only')?.textContent.trim(), shape: marker ? [...marker.querySelectorAll('path,circle,line,polyline,rect')].map(shape => ({ tag: shape.tagName, filled: getComputedStyle(shape).fill !== 'none', geometry: Object.fromEntries([...shape.attributes].filter(attribute => !['fill', 'stroke', 'class', 'style'].includes(attribute.name)).map(attribute => [attribute.name, attribute.value])) })) : null };
      }) };
    });
  }
  async function assertPlan(expectedStates) {
    const plan = await planState();
    assert.equal(plan.open, true);
    assert.equal(plan.rows.length, 12);
    assert.doesNotMatch(plan.visibleText, /Рабочий|Добор|Отдых/iu);
    assert.deepEqual(plan.rows.map(row => row.state), expectedStates);
    for (const row of plan.rows) {
      assert.ok(row.status, 'every row exposes a spoken status');
      assert.ok(row.shape?.length, 'every row has a graphical status marker');
      assert.equal(row.current === 'step', row.state === 'current');
    }
    return plan;
  }
  async function completeOne() {
    const current = pending((await state()).active);
    await page.locator('#completeSet').click();
    await page.waitForFunction(async id => Object.values((await (await import('./js/workout-db.js')).readAll()).active.sets).flat().find(set => set.id === id).status === 'done', current.id);
    if (await page.locator('#restDialog').isVisible()) await page.locator('#restDialog [data-action=skip-rest]').click();
  }
  try {
    await page.goto(new URL('#cycle', process.env.HVAT_URL || 'http://127.0.0.1:8766/').href);
    await page.locator('#cycleRoot [data-cycle-action=settings]').click();
    await page.locator('#cycleDialog [name=right]').fill('100'); await page.locator('#cycleDialog [name=left]').fill('80');
    await page.locator('#cycleDialog button[type=submit]').click(); await page.locator('#cycleDialog').waitFor({ state: 'hidden' });
    await page.locator('#cycleRoot [data-cycle-action=start]').click(); await page.locator('#sessionActualReps').waitFor({ state: 'visible' });
    const sessionId = (await state()).active.id;
    assert.equal(await page.locator('.brand').isVisible(), false);
    assert.equal(await page.locator('.primary-nav').isVisible(), false);
    assert.equal(await page.locator('#sessionProgress').innerText(), 'Подход 1 из 12');
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); });
      const geometry = await page.evaluate(() => {
        const bounds = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(), style = getComputedStyle(el); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, fontSize: style.fontSize, paddingBottom: style.paddingBottom }; };
        const targets = [...document.querySelectorAll('#trainingSession button,#trainingSession input,#trainingSession summary')].map(el => ({ el, rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.width && rect.height).map(({ el, rect }) => ({ id: el.id || el.tagName, width: rect.width, height: rect.height }));
        return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, weight: bounds('.session-hero__weight'), springs: bounds('.session-hero__springs'), actual: bounds('#sessionActualReps'), dock: bounds('.session-dock'), primary: bounds('#completeSet'), targets };
      });
      assert.equal(geometry.scrollWidth, viewport.width, 'no horizontal overflow');
      assert.ok(geometry.weight.top < viewport.height / 3, 'weight in upper third');
      assert.ok(geometry.springs.bottom <= geometry.dock.top, 'springs above dock');
      assert.ok(geometry.actual.bottom <= geometry.dock.top, 'actual reps above dock');
      assert.ok(parseFloat(geometry.actual.fontSize) >= 16, 'main input has readable mobile font');
      assert.ok(geometry.primary.top >= 0 && geometry.primary.bottom <= viewport.height && geometry.primary.height >= 56, 'primary action fully visible');
      assert.ok(parseFloat(geometry.dock.paddingBottom) >= 12, 'dock has bottom padding before device safe-area inset');
      assert.ok(geometry.targets.every(target => target.width >= 48 && target.height >= 48), `48px visible controls: ${JSON.stringify(geometry.targets)}`);
      evidence.viewports.push(geometry);
      await assertPlan(['current', ...Array(11).fill('pending')]);
      await capture(`session-v20-${viewport.width}x${viewport.height}`);
      await capture(`session-v20-${viewport.width}x${viewport.height}-full`, true);
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const el = document.activeElement, rect = el.getBoundingClientRect(), dock = document.querySelector('.session-dock').getBoundingClientRect();
          return { id: el.id, tag: el.tagName, top: rect.top, bottom: rect.bottom, dock: !!el.closest('.session-dock'), dockTop: dock.top, viewportHeight: innerHeight };
        });
        evidence.focus.push({ viewport, ...focus });
        if (focus.tag === 'BODY') continue;
        assert.ok(focus.top >= -1 && focus.bottom <= focus.viewportHeight + 1, `focus inside viewport: ${JSON.stringify(focus)}`);
        assert.ok(focus.dock || focus.bottom <= focus.dockTop + 1, `focus above bottom action: ${JSON.stringify(focus)}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#increaseSessionReps').click(); assert.equal(await page.locator('#sessionActualReps').inputValue(), '6');
    await page.locator('#decreaseSessionReps').click(); assert.equal(await page.locator('#sessionActualReps').inputValue(), '5');
    await page.locator('#sessionActualReps').fill('0'); assert.equal(await page.locator('#decreaseSessionReps').isDisabled(), true);
    await page.locator('#sessionActualReps').fill('999'); assert.equal(await page.locator('#increaseSessionReps').isDisabled(), true);
    await page.locator('#sessionActualReps').fill(''); await page.locator('#completeSet').click();
    assert.equal(pending((await state()).active).status, 'pending'); assert.equal(await page.locator('#restDialog').isVisible(), false);
    await page.locator('#sessionActualReps').fill('7');
    await page.waitForFunction(async () => (await (await import('./js/workout-db.js')).readAll()).active.sets.right[0].draftReps === 7);
    await page.reload(); await resumeSession();
    assert.equal((await state()).active.id, sessionId); assert.equal(await page.locator('#sessionActualReps').inputValue(), '7');
    await sessionAction('editCurrentSet'); await page.locator('#sessionSetDialog').waitFor({ state: 'visible' });
    const editedPair = await page.evaluate(async () => (await import('./js/workout-model.js')).PAIRS[20]);
    await page.locator('#sessionWeight').selectOption(`${editedPair.i}-${editedPair.j}`);
    await page.locator('#sessionPlannedReps').fill('6'); await page.locator('#saveCurrentSet').click();
    await page.locator('#sessionSetDialog').waitFor({ state: 'hidden' });
    assert.equal(pending((await state()).active).reps, 6); assert.equal(pending((await state()).active).kg, editedPair.kg);
    assert.equal(await page.locator('#sessionActualReps').inputValue(), '7', 'editing the plan preserves a user-entered actual draft');
    assert.match(await page.locator('.session-hero__weight').innerText(), new RegExp(String(editedPair.kg).replace('.', '[.,]')));
    const soundBefore = (await state()).settings.sound;
    await sessionAction('toggleSound');
    await page.waitForFunction(async before => (await (await import('./js/workout-db.js')).readAll()).settings.sound !== before, soundBefore);
    if (await page.locator('#sessionActionsDialog').isVisible()) await page.locator('#closeSessionActions').click();
    await page.locator('#sessionPlan > summary').click(); assert.equal(await page.locator('#sessionPlan').evaluate(el => el.open), false);
    await page.locator('#sessionPlan > summary').click();
    await completeOne(); await sessionAction('skipSet');
    await page.waitForFunction(() => document.querySelector('#sessionProgress').textContent === 'Подход 3 из 12');
    const plan = await assertPlan(['done', 'skipped', 'current', ...Array(9).fill('pending')]);
    const examples = ['done', 'skipped', 'current', 'pending'].map(state => plan.rows.find(row => row.state === state));
    assert.equal(new Set(examples.map(row => JSON.stringify(row.shape))).size, 4, 'statuses differ by shape without color');
    evidence.statusExamples = examples;
    await page.locator('#sessionPlan').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await capture('session-v20-plan-statuses-390x844'); await capture('session-v20-plan-statuses-full', true);
    await sessionAction('undoSet'); await page.waitForFunction(() => document.querySelector('#sessionProgress').textContent === 'Подход 2 из 12');
    await sessionAction('skipSet'); await page.waitForFunction(() => document.querySelector('#sessionProgress').textContent === 'Подход 3 из 12');
    const savedBeforeReturn = (await state()).active;
    await page.locator('#backToTraining').click(); await page.locator('#sectionCycle').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.primary-nav').isVisible(), true);
    await page.locator('#cycleRoot [data-cycle-action=resume-workout]').click(); await page.locator('#sessionActualReps').waitFor({ state: 'visible' });
    assert.deepEqual((await state()).active, savedBeforeReturn);
    await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok(await page.evaluate(async () => !!await (await caches.open('hvat-static-v20')).match(new URL('./styles/workout.css', location.href))));
    await context.setOffline(true); await page.reload(); await resumeSession();
    assert.deepEqual((await state()).active, savedBeforeReturn); assert.equal(await page.locator('#sessionProgress').innerText(), 'Подход 3 из 12');
    await context.setOffline(false);
    while (pending((await state()).active)) await completeOne();
    await page.locator('#finishSessionDialog').waitFor({ state: 'visible' });
    assert.equal((await state()).workouts.length, 0, 'confirmation is required to save');
    assert.match(await page.locator('#finishSessionSummary').innerText(), /частич/i);
    await page.locator('#confirmFinishSession').click();
    await page.waitForFunction(async () => !(await (await import('./js/workout-db.js')).readAll()).active);
    assert.equal((await state()).workouts.length, 1); assert.equal((await state()).workouts[0].partial, true);
    assert.equal((await state()).endlessCycle.day, 1, 'partial completion does not advance cycle');
    assert.equal(await page.locator('.primary-nav').isVisible(), true);
    assert.deepEqual(errors, []);
    evidence.checks = ['v2 mobile geometry at 390x844/320x568', '48px controls and readable input', 'default expanded 12-row plan', 'four status shapes and spoken labels', 'stepper bounds0..999/draft reload', 'edit preserves actual draft', 'sound action', 'hide/show plan', 'skip ordinal/undo', 'cycle back/resume', 'offline v20 stylesheet and active workout', 'partial finish confirmation and unchanged cycle'];
    evidence.pageErrors = errors;
    if (process.env.QA_SCREENSHOT_DIR) fs.writeFileSync(path.join(process.env.QA_SCREENSHOT_DIR, 'session-v20-checks.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log('PASS focused session: mobile geometry/touch/focus/plan/statuses/edit/stepper/draft/reload/menu/back/resume/skip/undo/offlinev20/partial finish');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
