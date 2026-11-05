const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseUrl = process.env.HVAT_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Yekaterinburg', acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const state = () => page.evaluate(async () => (await import('./js/workout-db.js')).readAll());
  const act = name => page.locator(`#blockRoot [data-block-action="${name}"]`).first();
  const loaded = () => page.waitForFunction(() => !!document.querySelector('#blockRoot h1'));
  const saved = () => page.waitForFunction(() => document.querySelector('#blockSaveStatus')?.textContent === 'Сохранено на устройстве');
  const submit = async () => { await page.locator('#blockDialog button[type=submit]').click(); await page.locator('#blockDialog').waitFor({ state: 'hidden' }); };
  const change = async (selector, value) => {
    const field = page.locator(selector);
    if (await field.evaluate(el => el.tagName === 'SELECT')) await field.selectOption(value);
    else { await field.fill(value); await field.dispatchEvent('change'); }
    await saved();
  };
  try {
    // Seed a real existing v3 journal before the app opens, including an old valid progression.
    await page.goto(new URL('manifest.json', baseUrl).href);
    const legacy = await page.evaluate(async () => {
      const m = await import('./js/workout-model.js'), pm = await import('./js/progression-model.js');
      const program = pm.createProgression({ name: 'Сохранённая прогрессия', targetDate: '2027-02-01', weeks: 4,
        arms: { right: { ...pm.defaultArm(), baseConfirmed: true }, left: { ...pm.defaultArm(), base: 80, baseConfirmed: true } } });
      const plan = m.createPlan(), at = '2026-01-01T10:00:00.000Z';
      const workout = { id: 'existing-workout', title: 'Сохранённая тренировка', startedAt: at, endedAt: at, restSec: 90,
        initialPlan: plan, sets: Object.fromEntries(m.ARMS.map(arm => [arm, plan[arm].map(set => ({ ...set, status: 'done', actualReps: set.reps, completedAt: at }))])) };
      const record = { id: 'existing-record', arm: 'right', ...m.PAIRS[10], reps: 1, recordedAt: at };
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('hvat-training', 3), stores = ['templates', 'workouts', 'manualRecords', 'meta', 'progressions'];
        request.onupgradeneeded = () => stores.forEach(name => request.result.createObjectStore(name, { keyPath: 'id' }));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction(stores, 'readwrite');
          tx.objectStore('workouts').put(workout); tx.objectStore('progressions').put(program);
          tx.objectStore('manualRecords').put(record); tx.objectStore('meta').put({ id: 'settings', value: { sound: false } });
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
      return { program, workout, record };
    });
    await page.goto(new URL('#block', baseUrl).href); await loaded();
    assert.equal(await page.locator('#sectionBlock').isVisible(), true, 'direct #block link opens the planner');
    await page.locator('#sectionBlockButton').click();
    const calendarFixtures = await page.evaluate(async () => {
      const m = await import('./js/block-model.js'), v = await import('./js/block-view.js');
      const renderState = block => { const workspace = m.createWorkspace(); workspace.blocks = [block]; return {
        workspace, blockId: block.id, sessionId: null, arm: 'right', editArms: 'both', week: 0,
        range: 'all', source: 'plan', includeWarmup: false, workouts: [], saveStatus: '' };
      };
      const fixtures = ['2026-11-02', '2026-11-05', '2026-11-08'].map((start, index) => {
        const block = { id: `fixture-${index}`, name: 'Календарный пример', start, weeks: 3, sessions: [] };
        const doc = new DOMParser().parseFromString(v.blockView(renderState(block)), 'text/html');
        return { start: block.start, layout: v.calendarLayout(block), rows: doc.querySelectorAll('.block-calendar-week').length,
          headers: [...doc.querySelectorAll('.block-day-headings')].map(row => [...row.children].map(el => el.textContent)),
          firstWeekdays: [...doc.querySelectorAll('.block-calendar-week')].map(row => new Date(`${row.firstElementChild.dataset.date}T12:00:00Z`).getUTCDay()),
          available: doc.querySelectorAll('.block-calendar [data-block-action=add-session]').length,
          paddingButtons: doc.querySelectorAll('.block-calendar-day.is-outside button').length };
      });
      const partial = { id: 'partial', name: 'Неполная неделя', start: '2026-11-05', weeks: 3,
        sessions: ['2026-11-06', '2026-11-07'].map((date, index) => ({ id: `s${index}`, title: 'Занятие', date, arms: { right: [], left: [] } })) };
      const dialog = new DOMParser().parseFromString(v.dialogView('repeat-week', renderState(partial), { week: 0 }), 'text/html');
      return { fixtures, partialAllowed: v.canRepeatCalendarWeek(partial, 0, 3),
        partialTargets: [...dialog.querySelectorAll('[name=targetWeek] option')].map(el => Number(el.value)) };
    });
    const weekdayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    for (const [index, fixture] of calendarFixtures.fixtures.entries()) {
      assert.equal(fixture.start, ['2026-11-02', '2026-11-05', '2026-11-08'][index]);
      assert.equal(fixture.rows, index === 0 ? 3 : 4); assert.equal(fixture.available, 21);
      assert.equal(fixture.paddingButtons, 0); assert.ok(fixture.firstWeekdays.every(value => value === 1));
      assert.ok(fixture.headers.every(row => JSON.stringify(row) === JSON.stringify(weekdayNames)));
    }
    assert.equal(calendarFixtures.partialAllowed, false); assert.deepEqual(calendarFixtures.partialTargets, [1, 2]);
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const date = days => new Date(Date.parse(today + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    await act('profile').click();
    for (const [arm, max] of [['right', '100'], ['left', '80']]) {
      await page.locator(`#blockDialog [name="${arm}-max"]`).fill(max);
      await page.locator(`#blockDialog [name="${arm}-date"]`).fill(today);
    }
    await submit(); await act('new-block').click();
    await page.locator('#blockDialog [name=name]').fill('Пример · 3 недели');
    await page.locator('#blockDialog [name=start]').fill(today);
    await page.locator('#blockDialog [name=weeks]').fill('3'); await submit();
    assert.equal(await page.locator('.block-calendar [data-block-action=add-session]').count(), 21);
    assert.deepEqual(await page.locator('.block-day-headings').first().locator('span').allTextContents(), weekdayNames);
    assert.ok(await page.locator('.block-calendar-week').evaluateAll(rows => rows.every(row => new Date(`${row.firstElementChild.dataset.date}T12:00:00Z`).getUTCDay() === 1)));
    await page.locator(`.block-calendar [data-block-action=add-session][data-date="${today}"]`).click(); await saved();
    await page.locator('[data-block-control=edit-arms]').selectOption('right');
    await page.locator('.block-presets summary').click();
    await page.locator('[data-block-action=preset][data-count="2"]').click(); await saved();
    let data = await state(), session = data.blockWorkspace.blocks[0].sessions[0];
    assert.equal(session.arms.right.length, 5); assert.equal(session.arms.left.length, 0);
    assert.equal(await page.locator('.block-chart h3').first().textContent(), 'Относительный объём · все повторы');
    assert.equal(await page.locator('.block-chart h3').last().textContent(), 'Повторы ≥85% 1ПМ');
    await page.locator('[data-block-control=edit-arms]').selectOption('left');
    await page.locator('.block-presets summary').click();
    await page.locator('[data-block-action=preset][data-count="2"]').click(); await saved();
    const leftMain = (await state()).blockWorkspace.blocks[0].sessions[0].arms.left[3].id;
    await change(`[data-row-id="${leftMain}"] [data-row-field=value]`, '80');
    await page.locator('[data-block-control=edit-arms]').selectOption('right');
    const rightMain = session.arms.right[3].id;
    const trace = () => page.locator('.block-chart-line.block-chart-volume').getAttribute('d');
    const oldTrace = await page.locator('.block-chart').first().textContent();
    await page.locator(`[data-row-id="${rightMain}"] [data-row-field=value]`).fill('90');
    await page.waitForFunction(async rowId => (await (await import('./js/workout-db.js')).readAll()).blockWorkspace.blocks[0].sessions[0].arms.right.find(row => row.id === rowId).value === 90, rightMain);
    await saved();
    await page.waitForFunction(before => document.querySelector('.block-chart')?.textContent !== before, oldTrace);
    assert.notEqual(await page.locator('.block-chart').first().textContent(), oldTrace);
    const oldRir = await page.locator('.block-distribution').last().innerText();
    await change(`[data-row-id="${rightMain}"] [data-row-field=rir]`, '1');
    assert.notEqual(await page.locator('.block-distribution').last().innerText(), oldRir);
    const firstOffset = new Date(`${today}T12:00:00Z`).getUTCDay() === 6 ? 2 : 1;
    const beforeDate = await trace(); await change('[data-session-field=date]', date(firstOffset));
    assert.notEqual(await trace(), beforeDate);
    await act('copy-session').click();
    await page.locator('#blockDialog [name=title]').fill('Копия занятия');
    await page.locator('#blockDialog [name=date]').fill(date(firstOffset + 1)); await submit();
    const repeat = await page.evaluate(async () => {
      const d = await (await import('./js/workout-db.js')).readAll(), v = await import('./js/block-view.js');
      const block = d.blockWorkspace.blocks[0], layout = v.calendarLayout(block);
      const source = Math.floor((Date.parse(block.sessions[0].date) - Date.parse(layout.start)) / (7 * 86400000));
      return { source, dates: v.calendarWeekSessions(block, source).map(s => s.date),
        targets: Array.from({ length: layout.weeks }, (_, index) => index).filter(target => v.canRepeatCalendarWeek(block, source, target)) };
    });
    assert.equal(repeat.dates.length, 2); assert.ok(repeat.targets.length >= 2);
    for (const week of repeat.targets.slice(0, 2)) {
      await page.locator(`[data-block-action=repeat-week][data-week="${repeat.source}"]`).click();
      assert.deepEqual(await page.locator('#blockDialog [name=targetWeek] option').evaluateAll(options => options.map(el => Number(el.value))), repeat.targets);
      await page.locator('#blockDialog [name=targetWeek]').selectOption(String(week)); await submit();
      const copies = (await state()).blockWorkspace.blocks[0].sessions.slice(-2);
      assert.deepEqual(copies.map(s => s.date), repeat.dates.map(date => new Date(Date.parse(date) + (week - repeat.source) * 7 * 86400000).toISOString().slice(0, 10)));
      assert.deepEqual(copies.map(s => new Date(s.date).getUTCDay()), repeat.dates.map(date => new Date(date).getUTCDay()));
    }
    data = await state(); assert.equal(data.blockWorkspace.blocks[0].sessions.length, 6);
    assert.equal(data.blockWorkspace.blocks[0].sessions[0].arms.left[3].value, 80);
    assert.equal(data.blockWorkspace.blocks[0].sessions[0].arms.right[3].value, 90);
    assert.deepEqual(data.progressions[0], legacy.program); assert.deepEqual(data.workouts[0], legacy.workout);
    assert.deepEqual(data.manualRecords[0], legacy.record); assert.equal(data.settings.sound, false);
    const rollingBefore = await page.locator('.block-rolling-grid').innerText();
    await change('[data-block-control=anchor]', today);
    assert.notEqual(await page.locator('.block-rolling-grid').innerText(), rollingBefore);
    assert.equal(await page.locator('[data-block-control=anchor]').inputValue(), today);
    const persisted = data.blockWorkspace;
    await page.reload(); await loaded(); await page.locator('#sectionBlockButton').click();
    assert.deepEqual((await state()).blockWorkspace, persisted);

    // Complete a tiny one-hand linked workout through the journal controls.
    await page.locator(`.block-calendar [data-block-action=add-session][data-date="${today}"]`).click(); await saved();
    await page.locator('[data-block-control=edit-arms]').selectOption('right');
    await page.locator('[data-block-action=add-row][data-arm=right]').click(); await saved();
    const tiny = (await state()).blockWorkspace.blocks[0].sessions.at(-1), rowId = tiny.arms.right[0].id;
    for (const [field, value] of [['sets', '1'], ['reps', '1'], ['mode', 'kg'], ['value', '30'], ['restSec', '0'], ['rir', '2']]) await change(`[data-row-id="${rowId}"] [data-row-field=${field}]`, value);
    await act('start-session').click(); await page.locator('#sessionActualReps').waitFor();
    const active = (await state()).active;
    assert.equal(active.blockSessionId, tiny.id); assert.equal(active.sets.left.length, 0);
    assert.equal(active.sets.right[0].blockMaxKg, 100); assert.equal(active.sets.right[0].blockRowId, rowId);
    assert.equal(await page.locator('#sessionQuality').count(), 0);
    await page.locator('#sessionActualReps').fill('2'); await page.locator('#completeSet').click();
    await page.locator('#finishTraining').click();
    await page.waitForFunction(async () => !(await (await import('./js/workout-db.js')).readAll()).active);
    data = await state(); const completed = data.workouts.find(w => w.blockSessionId === tiny.id);
    assert.ok(completed); assert.equal(completed.blockId, persisted.blocks[0].id);
    assert.equal(completed.blockContext.maxima.right, 100); assert.equal(completed.sets.right[0].blockMaxKg, 100);
    await page.locator('#sectionBlockButton').click();
    const combined = await page.evaluate(async ({ today, id }) => {
      const d = await (await import('./js/workout-db.js')).readAll(), m = await import('./js/block-model.js');
      const w = d.blockWorkspace, b = w.blocks[0], series = m.scenarioSeries(b, w.profile, 'right', w.model, 'combined', d.workouts);
      const workout = d.workouts.find(value => value.blockSessionId === id);
      return { input: series.find(point => point.date === today).inputVolume, expected: workout.sets.right[0].kg / 100 * 2 };
    }, { today, id: tiny.id });
    assert.ok(Math.abs(combined.input - combined.expected) < 1e-9, 'linked fact must replace its plan');
    const downloaded = page.waitForEvent('download'); await act('export').click();
    const download = await downloaded, raw = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(raw.version, 3); assert.equal(raw.data.blockWorkspace.blocks[0].sessions.length, 7);
    await page.evaluate(async raw => (await import('./js/progression-backup.js')).validateProgressions((await import('./js/workout-model.js')).validateBackup(raw)), raw);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('#blockImportFile').setInputFiles({ name: 'hvat-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
      await page.waitForFunction(() => document.querySelector('#blockSaveStatus').textContent === 'Импорт завершён');
    }
    assert.equal((await state()).blockWorkspace.blocks.length, 1); assert.equal((await state()).workouts.length, 2);
    const invalid = structuredClone(raw); invalid.data.blockWorkspace.blocks[0].sessions[0].arms.right[0].sets = 0;
    const beforeInvalid = await state();
    await page.locator('#blockImportFile').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.waitForFunction(() => !!document.querySelector('#blockMessage').textContent);
    assert.deepEqual(await state(), beforeInvalid);

    await page.locator('[data-block-action=select-session]').first().click();
    for (const width of [1440, 1024, 768, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `document overflow at ${width}`);
      assert.ok(await page.locator('.block-editor').evaluate(el => el.scrollWidth <= el.clientWidth), `editor overflow at ${width}`);
      if (process.env.QA_SCREENSHOT_DIR) { fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, `block-${width}.png`), fullPage: true }); }
    }
    if (process.env.QA_SCREENSHOT_DIR) {
      await page.locator('.block-editor').scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const editorPaint = await page.locator('.block-editor').evaluate(el => {
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        return { display: style.display, visibility: style.visibility, opacity: style.opacity,
          x: rect.x, y: rect.y, width: rect.width, height: rect.height, inputs: el.querySelectorAll('input').length };
      });
      assert.notEqual(editorPaint.display, 'none'); assert.equal(editorPaint.visibility, 'visible');
      assert.equal(editorPaint.opacity, '1'); assert.ok(editorPaint.height > 100 && editorPaint.inputs > 0);
      console.log('Mobile editor after scrolling:', JSON.stringify(editorPaint));
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'block-320-editor.png') });
      await page.locator('.block-editor').screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'block-320-editor-detail.png') });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'block-320-after-scroll.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator(`[data-block-action=select-session][data-id="${persisted.blocks[0].sessions[0].id}"]`).click();
      await page.locator('.block-editor').evaluate(el => { el.scrollTop = 250; });
      await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, 'block-1440-preset.png'), fullPage: true });
    }
    assert.ok(await page.locator('#blockRoot').evaluate(root => [...root.querySelectorAll('button')].every(el => (el.getAttribute('aria-label') || el.textContent).trim())));
    assert.ok(await page.locator('#blockRoot').evaluate(root => [...root.querySelectorAll('input,select')].every(el => el.labels.length || el.getAttribute('aria-label'))));
    await page.setViewportSize({ width: 1440, height: 1000 }); await act('edit-block').click();
    await page.locator('#blockDialog [name=weeks]').fill('52'); await submit();
    await page.locator('[data-block-control=range]').selectOption('all');
    const expectedCalendarRows=await page.evaluate(async()=>{const d=await (await import('./js/workout-db.js')).readAll();return (await import('./js/block-view.js')).calendarLayout(d.blockWorkspace.blocks[0]).weeks;});
    assert.equal(await page.locator('.block-calendar-week').count(), expectedCalendarRows);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '52-week overflow');
    await act('edit-block').click(); await page.locator('#blockDialog [name=weeks]').fill('3'); await submit();
    await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok(await page.evaluate(async () => (await caches.keys()).includes('hvat-static-v18')));
    for (const name of ['block-model', 'block-storage', 'block-ui', 'block-view', 'block-charts', 'block-format']) assert.ok(await page.evaluate(async name => !!await (await caches.open('hvat-static-v18')).match(new URL(`./js/${name}.js`, location.href)), name), `offline cache missing ${name}`);
    const offlineBefore = (await state()).blockWorkspace; await context.setOffline(true);
    await page.reload(); await loaded(); await page.locator('#sectionBlockButton').click();
    assert.deepEqual((await state()).blockWorkspace, offlineBefore); assert.deepEqual(errors, []);
    console.log('PASS Monday-first/full weekday names/21 active days/padding/Mon-Thu-Sun fixtures/partial-week copy guards; block UI/profile/presets/live metrics/copy/repeat/reload; v3 preservation/linked journal/export/import; 1440/1024/768/320/52-weeks/accessibility; v18 offline');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
