const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseUrl = process.env.HVAT_URL || 'http://127.0.0.1:8766/';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Yekaterinburg', acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  const spacingEvidence = { weekCards: [], overview: [] };
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const state = () => page.evaluate(async () => (await import('./js/workout-db.js')).readAll());
  const cycle = async () => (await state()).endlessCycle;
  const position = value => ({ week: value.week, day: value.day });
  const action = name => page.locator(`#cycleRoot [data-cycle-action="${name}"]`).first();
  const loaded = () => page.waitForFunction(() => !!document.querySelector('#cycleRoot h1'));
  const openCycle = async () => { await page.locator('#sectionCycleButton').click(); await loaded(); };
  const submit = async () => { await page.locator('#cycleDialog button[type=submit]').click(); await page.locator('#cycleDialog').waitFor({ state: 'hidden' }); };
  const pause = async () => { await action('pause').click(); await page.waitForFunction(async () => (await (await import('./js/workout-db.js')).readAll()).endlessCycle.status === 'paused'); };
  const skip = async () => {
    const before = await cycle(); await action('skip').click(); await submit();
    await page.waitForFunction(async revision => (await (await import('./js/workout-db.js')).readAll()).endlessCycle.revision > revision, before.revision);
  };
  const setReturn = async weeksBack => {
    const input = page.locator('#cycleDialog [name=weeksBack]');
    if (await input.evaluate(el => el.tagName === 'SELECT')) await input.selectOption(String(weeksBack));
    else await input.fill(String(weeksBack));
    await input.dispatchEvent('input'); await input.dispatchEvent('change');
  };
  const completeOne = async () => {
    const active = (await state()).active;
    const pending = ['right', 'left'].flatMap(arm => active.sets[arm]).find(set => set.status === 'pending');
    assert.ok(pending);
    await page.locator('#sessionActualReps').fill(String(pending.reps)); await page.locator('#completeSet').click();
    await page.waitForFunction(async id => (await (await import('./js/workout-db.js')).readAll()).active.sets.right
      .concat((await (await import('./js/workout-db.js')).readAll()).active.sets.left).find(set => set.id === id).status === 'done', pending.id);
    if (await page.locator('#restDialog').isVisible()) await page.locator('#restDialog [data-action=skip-rest]').click();
  };
  const finish = async () => {
    const active = (await state()).active;
    if (active.sets.right.concat(active.sets.left).every(set => set.status !== 'pending')) {
      await page.locator('#finishSessionDialog').waitFor({ state: 'visible' });
    }
    const completed = await page.locator('#finishSessionDialog').isVisible();
    if (!completed) await page.locator('#openSessionActions').click();
    await page.locator(completed ? '#confirmFinishSession' : '#finishTraining').click();
    await page.waitForFunction(async () => !(await (await import('./js/workout-db.js')).readAll()).active);
  };
  async function weekCardGeometry(width, selectedWeek) {
    const selected = page.locator(`.cycle-week[data-week="${selectedWeek}"]`);
    await page.keyboard.press('Tab'); await selected.focus();
    const measured = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      const container = document.querySelector('.cycle-weeks'), style = getComputedStyle(container), box = rect(container);
      const cards = [...container.querySelectorAll('.cycle-week')].map(card => ({ week: Number(card.dataset.week), selected: card.classList.contains('is-selected'), rect: rect(card), title: rect(card.querySelector('.cycle-week-title')), value: rect(card.querySelector('strong')), state: rect(card.querySelector('.cycle-week-state')), outlineWidth: parseFloat(getComputedStyle(card).outlineWidth), outlineOffset: parseFloat(getComputedStyle(card).outlineOffset) }));
      return { viewportWidth: innerWidth, pageScrollWidth: document.documentElement.scrollWidth, container: { ...box, clientHeight: container.clientHeight, clientTop: container.clientTop, clientLeft: container.clientLeft, clientWidth: container.clientWidth, scrollWidth: container.scrollWidth, paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom) }, cards, bottomAir: box.top + container.clientTop + container.clientHeight - Math.max(...cards.map(card => card.rect.bottom)) };
    });
    assert.equal(measured.pageScrollWidth, width, `week cards do not overflow page at ${width}`);
    assert.equal(measured.cards.length, 5);
    const tops = measured.cards.map(card => card.value.top), bottoms = measured.cards.map(card => card.value.bottom);
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 1 && Math.max(...bottoms) - Math.min(...bottoms) <= 1, `week values align at ${width}, selected ${selectedWeek}: ${JSON.stringify(measured.cards)}`);
    assert.ok(measured.cards.every(card => card.title.height >= 15 && card.state.height >= 15), 'week title and current-state each reserve a line');
    assert.ok(measured.bottomAir >= 12, `air between cards and scrollbar at ${width}: ${measured.bottomAir}`);
    const card = measured.cards.find(item => item.week === selectedWeek);
    assert.ok(card?.selected);
    assert.ok(card.outlineWidth >= 3, 'keyboard focus remains visible');
    const focusExtent = card.outlineWidth + Math.max(0, card.outlineOffset);
    assert.ok(card.rect.left - focusExtent >= measured.container.left + measured.container.clientLeft - 1, 'left focus outline is not clipped');
    assert.ok(card.rect.top - focusExtent >= measured.container.top + measured.container.clientTop - 1, 'top focus outline is not clipped');
    assert.ok(card.rect.bottom + focusExtent <= measured.container.top + measured.container.clientTop + measured.container.clientHeight + 1, 'bottom focus outline is not clipped');
    spacingEvidence.weekCards.push({ width, selectedWeek, ...measured });
    if (process.env.QA_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
      await page.locator('.cycle-weeks').screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, `cycle-spacing-v21-weeks-${width}-selected${selectedWeek}.png`) });
    }
    await page.locator('.cycle-week').last().focus();
    const rightEdge = await page.evaluate(() => {
      const container = document.querySelector('.cycle-weeks'), card = container.querySelector('.cycle-week:last-child'), style = getComputedStyle(card);
      return { cardRight: card.getBoundingClientRect().right, viewportRight: container.getBoundingClientRect().left + container.clientLeft + container.clientWidth, outlineExtent: parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)) };
    });
    assert.ok(rightEdge.cardRight + rightEdge.outlineExtent <= rightEdge.viewportRight + 1, 'right focus outline is not clipped at the scroll boundary');
  }
  async function overviewGeometry(width) {
    const measured = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      const wrapper = document.querySelector('.cycle-overview-scroll'), rows = [...document.querySelectorAll('.cycle-overview-table tbody tr')];
      return { viewportWidth: innerWidth, pageScrollWidth: document.documentElement.scrollWidth, wrapper: { ...rect(wrapper), clientWidth: wrapper.clientWidth, scrollWidth: wrapper.scrollWidth, overflowX: getComputedStyle(wrapper).overflowX }, rows: [rows[0], rows[1], rows[9]].map(row => ({ current: row.classList.contains('is-current'), firstCell: rect(row.children[0]), paddingLeft: parseFloat(getComputedStyle(row.children[0]).paddingLeft), button: rect(row.querySelector('button')), caption: row.querySelector('small') ? rect(row.querySelector('small')) : null, values: [...row.querySelectorAll('.cycle-overview-value')].map(rect) })) };
    });
    assert.equal(measured.pageScrollWidth, width, `overview does not overflow page at ${width}`);
    assert.ok(['auto', 'scroll'].includes(measured.wrapper.overflowX), 'table overflow stays within its wrapper');
    for (const row of measured.rows) {
      assert.ok(row.button.width >= 44 && row.button.height >= 44 && row.button.width <= 45 && row.button.height <= 45, `week button remains 44px without stretching: ${JSON.stringify(row.button)}`);
      assert.ok(row.button.left - row.firstCell.left >= 12 - 1, 'week button is separated from current-week indicator');
      assert.equal(row.values.length, 3, 'maximum and both sessions have value wrappers');
      for (const value of row.values) {
        assert.ok(value.height >= 44);
        assert.ok(Math.abs((row.button.top + row.button.bottom) / 2 - (value.top + value.bottom) / 2) <= 1, `button and numeric content align at ${width}`);
      }
      if (row.caption) {
        assert.ok(row.caption.top - row.button.bottom >= 4, 'week caption has room below its button');
        assert.ok(row.caption.width <= row.button.width + 1, 'week caption stays within button column');
        assert.ok(Math.abs((row.caption.left + row.caption.right) / 2 - (row.button.left + row.button.right) / 2) <= 1, 'week caption is centered under its number');
      }
    }
    assert.equal(measured.rows[0].paddingLeft, measured.rows[1].paddingLeft, 'current and regular week cells share the same left alignment');
    spacingEvidence.overview.push({ width, ...measured });
    if (process.env.QA_SCREENSHOT_DIR) await page.locator('.cycle-overview').screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, `cycle-spacing-v21-overview-${width}.png`) });
  }
  try {
    await page.goto(new URL('#cycle', baseUrl).href); await loaded();
    assert.equal(await page.locator('#sectionCycle').isVisible(), true);
    assert.equal(await cycle(), null);
    await action('settings').click();
    await page.locator('#cycleDialog [name=right]').fill('100');
    await page.locator('#cycleDialog [name=left]').fill('80'); await submit();
    await page.waitForFunction(async () => !!(await (await import('./js/workout-db.js')).readAll()).endlessCycle);
    assert.deepEqual(position(await cycle()), { week: 1, day: 1 });
    assert.deepEqual((await cycle()).initialMaxima, { right: 100, left: 80 });
    assert.equal(await page.locator('.primary-nav #sectionProgressionButton').count(), 0);
    const beforeSpacing = await cycle();
    for (const width of [320, 390, 700, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      await weekCardGeometry(width, 1);
      await action('page-next').click(); await action('page-next').click();
      await page.locator('.cycle-week[data-week="11"]').click();
      await weekCardGeometry(width, 11);
      await action('view-overview').click(); await overviewGeometry(width);
      await action('view-sessions').click(); await action('current').click();
    }
    assert.deepEqual(await cycle(), beforeSpacing, 'layout previews do not change the cycle');
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.QA_SCREENSHOT_DIR) fs.writeFileSync(path.join(process.env.QA_SCREENSHOT_DIR, 'cycle-spacing-v21-checks.json'), JSON.stringify(spacingEvidence, null, 2) + '\n');
    await action('view-charts').click();
    const loadCharts = page.locator('.cycle-load');
    const volumeLine = loadCharts.locator('.block-chart-line.block-chart-volume');
    await volumeLine.waitFor();
    assert.equal(await loadCharts.locator('svg[role=img]').count(), 2);
    assert.match(await loadCharts.innerText(), /Недели 1–26/);
    const workOnly = await volumeLine.getAttribute('d');
    assert.equal(await action('chart-warmup').count(), 0);
    await loadCharts.locator('[data-cycle-action=chart-arm][data-arm=left]').click();
    assert.notEqual(await volumeLine.getAttribute('d'), workOnly);
    await loadCharts.locator('[data-cycle-action=chart-arm][data-arm=right]').click();
    await page.setViewportSize({ width: 320, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'load charts overflow at 320');
    if (process.env.QA_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
      await loadCharts.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'cycle-load-320.png') });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await loadCharts.locator('[data-cycle-action=chart-source][data-source=actual]').click();
    assert.match(await loadCharts.innerText(), /пока нет записанных повторов/);
    const overviewPosition = await cycle();
    await action('view-overview').click();
    const overview = page.locator('.cycle-overview-table');
    const overviewRows = overview.locator('tbody tr');
    assert.equal(await overviewRows.count(), 26);
    assert.equal(await overviewRows.filter({ hasText: /л[её]гкая/i }).count(), 5);
    const finalRight = (await overviewRows.last().innerText()).replace(/\s+/g, ' ');
    assert.match(finalRight, /113,28/);
    assert.match(finalRight, /84,9×5×5\s*\+\s*76,7×10×1/);
    assert.match(finalRight, /71,5×10×4/);
    if (process.env.QA_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'cycle-overview-1440.png'), fullPage: true });
    }
    await page.locator('[data-cycle-action=overview-arm][data-arm=left]').click();
    assert.match(await overviewRows.last().innerText(), /90,62/);
    await page.setViewportSize({ width: 320, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overview overflow at 320');
    if (process.env.QA_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'cycle-overview-320.png'), fullPage: true });
    await overview.locator('[data-cycle-action=select-week][data-week="26"]').click();
    assert.match(await page.locator('.cycle-preview-heading').innerText(), /Неделя 26/);
    assert.deepEqual(await cycle(), overviewPosition);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await action('current').click();
    assert.doesNotMatch(await page.locator('.cycle-arm-grid').innerText(), /размин/i);
    const previewBefore = await page.locator('#cycleRoot table').first().innerText();
    await page.locator('[data-cycle-action=select-day][data-day="2"]').click();
    assert.notEqual(await page.locator('#cycleRoot table').first().innerText(), previewBefore);
    assert.deepEqual(position(await cycle()), { week: 1, day: 1 });
    await page.locator('[data-cycle-action=select-day][data-day="1"]').click();
    await action('start').click(); await page.locator('#sessionActualReps').waitFor();
    const originalActive = structuredClone((await state()).active);
    await page.locator('#backToTraining').click();
    await page.locator('#sectionCycle').waitFor({ state: 'visible' });
    await action('resume-workout').click(); await page.locator('#sessionActualReps').waitFor();
    assert.equal((await state()).active.id, originalActive.id, 'cycle return/resume preserves the active workout');
    for (const sets of Object.values(originalActive.sets)) {
      assert.deepEqual(sets.map(set => set.cycleRole), ['main', 'main', 'main', 'main', 'main', 'backoff']);
    }
    assert.equal(originalActive.sets.right.find(set => set.cycleRole === 'main').kg, 74.9);
    assert.notEqual(originalActive.sets.left.find(set => set.cycleRole === 'main').kg, 74.9);
    assert.equal(originalActive.sets.right[0].cycleMaxKg, 100); assert.equal(originalActive.sets.left[0].cycleMaxKg, 80);
    const guarded = await page.evaluate(async () => {
      const db = await import('./js/workout-db.js'), d = await db.readAll(), rejected = [];
      for (const name of ['double-start', 'skip', 'pause']) try {
        if (name === 'double-start') await db.startWorkout(structuredClone(d.active));
        else await db.cycleAction({ type: name }, d.endlessCycle.revision);
        rejected.push(false);
      } catch { rejected.push(true); }
      return rejected;
    });
    assert.deepEqual(guarded, [true, true, true]);
    await page.locator('#openSessionActions').click(); await page.locator('#cancelTraining').click();
    await page.waitForFunction(async () => !(await (await import('./js/workout-db.js')).readAll()).active);
    assert.deepEqual(position(await cycle()), { week: 1, day: 1 });
    const tampering = await page.evaluate(async valid => {
      const db = await import('./js/workout-db.js'), result = [];
      for (const type of ['load', 'revision']) {
        const active = structuredClone(valid); active.id = crypto.randomUUID();
        if (type === 'load') { active.initialPlan.right[0].kg += 1; active.sets.right[0].kg += 1; }
        else active.cycleRevision += 1;
        try { await db.startWorkout(active); result.push(false); } catch { result.push(true); }
      }
      return result;
    }, originalActive);
    assert.deepEqual(tampering, [true, true]);
    await openCycle();
    const skipBefore = await cycle(); await action('skip').click(); await page.keyboard.press('Escape');
    assert.deepEqual(await cycle(), skipBefore, 'opening/cancelling a skip must not move the cursor');
    for (let index = 0; index < 4; index++) await skip();
    assert.deepEqual(position(await cycle()), { week: 3, day: 1 });
    await pause(); const paused = await cycle();
    await page.reload(); await loaded();
    assert.deepEqual(await cycle(), paused, 'reload and calendar time do not grow a paused cycle');
    await action('return').click(); await setReturn(1);
    const preview1 = await page.locator('#cycleReturnPreview').innerText();
    await setReturn(2); const preview2 = await page.locator('#cycleReturnPreview').innerText();
    assert.notEqual(preview1, preview2); assert.deepEqual(await cycle(), paused);
    await setReturn(2); await submit();
    assert.deepEqual(position(await cycle()), { week: 1, day: 1 });
    for (let index = 0; index < 4; index++) await skip();
    await pause(); await action('return').click(); await setReturn(1); await submit();
    assert.deepEqual(position(await cycle()), { week: 2, day: 1 }); assert.equal((await cycle()).status, 'active');
    await action('start').click(); await page.locator('#sessionActualReps').waitFor();
    const partialPosition = position(await cycle()); await completeOne(); await finish();
    assert.deepEqual(position(await cycle()), partialPosition);
    assert.equal((await state()).workouts[0].partial, true);
    await openCycle(); await action('start').click(); await page.locator('#sessionActualReps').waitFor();
    assert.equal(await page.locator('#sessionQuality').count(), 0);
    while ((await state()).active.sets.right.concat((await state()).active.sets.left).some(set => set.status === 'pending')) await completeOne();
    await finish(); let data = await state();
    assert.deepEqual(position(data.endlessCycle), { week: 2, day: 2 });
    const completed = data.workouts.find(workout => !workout.partial);
    assert.equal(completed.cycleWeek, 2); assert.equal(completed.cycleDay, 1);
    assert.ok(completed.sets.right.every(set => set.cycleMaxKg === 100 * 1.005));
    await openCycle(); await action('view-charts').click();
    await loadCharts.locator('[data-cycle-action=chart-source][data-source=actual]').click();
    await loadCharts.locator('.block-chart-point.block-chart-volume').first().waitFor();
    assert.deepEqual(position(await cycle()), { week: 2, day: 2 });
    await action('view-sessions').click();
    const beforeDuplicate = structuredClone(data.endlessCycle);
    await page.evaluate(async workout => (await import('./js/workout-db.js')).finishWorkout(workout), completed);
    assert.deepEqual(await cycle(), beforeDuplicate); assert.equal((await state()).workouts.length, 2);
    await openCycle(); await pause(); await action('return').click(); await setReturn(1); await submit();
    assert.deepEqual(position(await cycle()), { week: 1, day: 1 });
    assert.deepEqual((await state()).workouts, data.workouts, 'return keeps previously recorded workouts');
    await pause(); const zeroPosition = position(await cycle());
    await action('return').click(); await setReturn(0); await submit();
    assert.deepEqual(position(await cycle()), zeroPosition); assert.equal((await cycle()).status, 'active');

    // Restore an old started attempt after returning; its journal remains valid but cannot advance the new cursor.
    const beforeStale = await cycle();
    await page.evaluate(async oldActive => {
      const db = await import('./js/workout-db.js'), d = await db.readAll();
      const active = structuredClone(oldActive); active.id = crypto.randomUUID();
      await db.mergeBackup({ templates: [], workouts: [], manualRecords: [], progressions: [], pendingImports: [], settings: d.settings,
        active, endlessCycle: d.endlessCycle });
      const restored = (await db.readAll()).active, now = new Date().toISOString();
      const workout = { ...restored, endedAt: now, partial: false,
        sets: Object.fromEntries(['right','left'].map(arm => [arm, restored.sets[arm].map(set => ({ ...set, status: 'done', actualReps: set.reps, completedAt: now }))])) };
      await db.finishWorkout(workout);
    }, originalActive);
    assert.deepEqual(await cycle(), beforeStale); assert.equal((await state()).workouts.length, 3);
    await page.reload(); await loaded(); await page.locator('#sectionTrainingButton').click();
    const downloading = page.waitForEvent('download'); await page.locator('#exportTraining').click();
    const download = await downloading, raw = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(raw.data.endlessCycle, beforeStale); assert.equal(raw.version, 3);
    await page.locator('#importTraining').setInputFiles({ name: 'cycle-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
    await page.waitForFunction(() => document.querySelector('#trainingMessage').textContent.startsWith('Импорт:'));
    assert.deepEqual(await cycle(), beforeStale); assert.equal((await state()).workouts.length, 3);
    const preserved = await page.evaluate(async raw => {
      const db = await import('./js/workout-db.js'), m = await import('./js/cycle-model.js'), w = await import('./js/workout-model.js');
      const before = (await db.readAll()).endlessCycle, incoming = structuredClone(raw);
      incoming.data.endlessCycle = m.createCycle({ right: 90, left: 70 }); await db.mergeBackup(w.validateBackup(incoming));
      delete incoming.data.endlessCycle; await db.mergeBackup(w.validateBackup(incoming));
      return { before, after: (await db.readAll()).endlessCycle };
    }, raw);
    assert.deepEqual(preserved.after, preserved.before);
    await openCycle();
    for (const width of [1440, 1024, 768, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `cycle overflow at ${width}`);
      if (process.env.QA_SCREENSHOT_DIR) { fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, `cycle-${width}.png`), fullPage: true }); }
    }
    await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => {
      const cache = await caches.open('hvat-static-v21');
      return Promise.all(['js/cycle-model.js','js/cycle-ui.js','js/cycle-view.js','styles/cycle.css','js/cycle-charts-model.js','js/cycle-charts.js'].map(async asset => !!await cache.match(new URL(asset, location.href))));
    });
    assert.deepEqual(cached, [true, true, true, true, true, true]);
    const offlineBefore = await cycle(); await context.setOffline(true); await page.reload(); await loaded();
    assert.deepEqual(await cycle(), offlineBefore); assert.equal(await page.locator('#sectionCycle').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS cycle plan/fact load charts/hand switch; 26-week overview/week 26 preview; independent maxima/pause/reload/return0-1-2/confirmed skip/cancel/partial/full/finish dialog/idempotence/stale import; journal snapshots+history; backupv3/local preservation; 1440/1024/768/320; v21 offline');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
