const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    for (const oldVersion of [1, 2]) {
      const context = await browser.newContext(), page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:8765/manifest.json');
      await page.evaluate(version => new Promise((resolve, reject) => {
        const names = ['templates', 'workouts', 'manualRecords', 'meta', ...(version === 2 ? ['progressions'] : [])];
        const request = indexedDB.open('hvat-training', version);
        request.onupgradeneeded = () => names.forEach(n => request.result.createObjectStore(n, { keyPath: 'id' }));
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction(names, 'readwrite');
          for (const name of names) tx.objectStore(name).put({ id: 'legacy', value: 'old' });
          tx.objectStore('meta').put({ id: 'settings', value: { sound: false } });
          tx.objectStore('meta').put({ id: 'active', value: { id: 'old-active' } });
          tx.objectStore('meta').put({ id: 'pendingImports', value: [{ id: 'old-import' }] });
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      }), oldVersion);
      await page.goto('http://127.0.0.1:8765/');
      await page.waitForFunction(() => document.querySelector('#recordsOverview').children.length > 0);
      const result = await page.evaluate(async () => {
        const db = await import('./js/workout-db.js'), m = await import('./js/progression-model.js'), w = await import('./js/workout-model.js');
        const check = (condition, message) => { if (!condition) throw Error(message); };
        let data = await db.readAll();
        check(['templates', 'workouts', 'manualRecords', 'progressions', 'pendingImports'].every(n => data[n].length === 0) && !data.active && !data.settings.sound, 'upgrade reset');
        let p = m.createProgression({ name: 'Новая подготовка', weeks: 4, targetDate: '2027-01-31', arms: { right: { ...m.defaultArm(), baseConfirmed: true }, left: { ...m.defaultArm(), base: 80, baseConfirmed: true } } });
        p.status = 'active'; await db.saveProgression(p);
        const frozen = JSON.stringify(p.slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms })));
        const slot = p.slots[0], active = { id: crypto.randomUUID(), title: p.name, progressionId: p.id, plannedSessionId: slot.id,
          slotRevision: slot.revision, startedAt: new Date().toISOString(), restSec: 0, restUntil: null, initialPlan: m.clone(slot.plan), sets: m.clone(slot.plan) };
        const starts = await Promise.allSettled([db.startWorkout(active), db.startWorkout({ ...active, id: crypto.randomUUID() })]);
        check(starts.filter(x => x.status === 'fulfilled').length === 1, 'double start');
        active.sets.right[0].draftReps = 7; await db.setMeta('active', active);
        await db.setRestUntil(active.id, Date.now() + 120000);
        check((await db.readAll()).active.sets.right[0].draftReps === 7, 'timer lost draft');
        const workout = { ...active, endedAt: new Date().toISOString(), partial: false };
        for (const arm of w.ARMS) workout.sets[arm].forEach(s => Object.assign(s, { status: 'done', actualReps: s.reps, completedAt: workout.endedAt }));
        await Promise.all([db.finishWorkout(workout), db.finishWorkout(workout)]);
        await db.setMeta('active', active); await db.setRestUntil(active.id, Date.now() + 200000);
        data = await db.readAll();
        check(!data.active && data.workouts.length === 1 && data.progressions[0].slots[0].attempts.length === 1, 'finish idempotency');
        check(JSON.stringify(data.progressions[0].slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms }))) === frozen, 'fixed plan');
        const backup = w.validateBackup({ format: w.BACKUP_FORMAT, version: w.BACKUP_VERSION, data });
        const again = await db.mergeBackup(backup); check(!again.workouts && !again.progressions, 'duplicate import');
        const incoming = m.clone(backup); incoming.progressions[0].name = 'Конфликт';
        const copy = await db.mergeBackup(incoming, { [p.id]: 'copy' });
        check(copy.progressions === 1 && copy.workouts === 1, 'copy import');
        await db.deleteWorkout(workout.id); data = await db.readAll();
        p = data.progressions.find(x => x.id === p.id);
        check(!p.slots[0].credited && p.slots[0].closed, 'deletion credit');
        check(JSON.stringify(p.slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms }))) === frozen, 'deletion changed plan');
        return { id: p.id, count: data.progressions.length };
      });
      assert.equal(result.count, 2);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#recordsOverview').children.length > 0);
      const after = await page.evaluate(async () => (await import('./js/workout-db.js')).readAll());
      assert.equal(after.progressions.length, 2); assert.equal(after.workouts.length, 1); assert.equal(after.settings.sound, false);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS v${oldVersion}→v3 one-time reset, sound, double start/finish, stale timer, backup graph copy, immutable deletion, reload persistence`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
