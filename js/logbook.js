const DEVICE_KEY = 'hvat.logbook.deviceId';

function ensureDeviceId() {
  try {
    const existing = window.localStorage?.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = `dev-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    window.localStorage?.setItem(DEVICE_KEY, id);
    return id;
  } catch (err) {
    console.warn('Unable to persist device id', err);
    return `dev-${Math.random().toString(36).slice(2)}`;
  }
}

function normalizeNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function buildEntryPayload(raw, deviceId) {
  const tension = normalizeNumber(raw.tension);
  const sets = normalizeNumber(raw.sets);
  const reps = normalizeNumber(raw.reps);
  const rpe = normalizeNumber(raw.rpe);

  return {
    sessionDate: normalizeString(raw.sessionDate) || null,
    movement: normalizeString(raw.movement),
    band: normalizeString(raw.band),
    tension: typeof tension === 'number' ? Math.round(tension * 10) / 10 : null,
    sets: typeof sets === 'number' ? Math.max(1, Math.round(sets)) : null,
    reps: typeof reps === 'number' ? Math.max(1, Math.round(reps)) : null,
    rpe: typeof rpe === 'number' ? Math.round(rpe * 2) / 2 : null,
    notes: normalizeString(raw.notes),
    deviceId,
  };
}

export function initLogbook(config, callbacks = {}) {
  const { onEntries, onStatusChange } = callbacks;

  if (!config) {
    onStatusChange?.({ kind: 'missing-config' });
    return {
      async addEntry() {
        throw new Error('Cloud database config is missing');
      },
      destroy() {},
    };
  }

  let deviceId = null;
  let firestoreModule = null;
  let entriesRef = null;
  let unsubscribe = null;
  let dbPromise = null;
  let readyEmitted = false;

  function notify(status) {
    onStatusChange?.(status);
  }

  async function ensureFirestore() {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = (async () => {
      try {
        notify({ kind: 'connecting' });
        const [{ initializeApp }, fsModule] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        ]);
        firestoreModule = fsModule;
        const app = initializeApp(config);
        const db = firestoreModule.getFirestore(app);
        entriesRef = firestoreModule.collection(db, 'expanderLogs');
        deviceId = ensureDeviceId();

        const q = firestoreModule.query(
          entriesRef,
          firestoreModule.orderBy('loggedAt', 'desc'),
        );

        unsubscribe = firestoreModule.onSnapshot(
          q,
          (snapshot) => {
            const rows = snapshot.docs.map((doc) => {
              const data = doc.data();
              const loggedAt = data.loggedAt && typeof data.loggedAt.toDate === 'function'
                ? data.loggedAt.toDate()
                : null;
              const clientLoggedAt = data.clientLoggedAt && typeof data.clientLoggedAt.toDate === 'function'
                ? data.clientLoggedAt.toDate()
                : null;
              return {
                id: doc.id,
                sessionDate: typeof data.sessionDate === 'string' ? data.sessionDate : null,
                movement: typeof data.movement === 'string' ? data.movement : '',
                band: typeof data.band === 'string' ? data.band : '',
                tension: typeof data.tension === 'number' ? data.tension : null,
                sets: typeof data.sets === 'number' ? data.sets : null,
                reps: typeof data.reps === 'number' ? data.reps : null,
                rpe: typeof data.rpe === 'number' ? data.rpe : null,
                notes: typeof data.notes === 'string' ? data.notes : '',
                loggedAt: loggedAt || clientLoggedAt,
              };
            });

            rows.sort((a, b) => {
              const parseDate = (entry) => {
                if (entry.sessionDate) {
                  const d = new Date(entry.sessionDate);
                  if (!Number.isNaN(d.getTime())) return d.getTime();
                }
                return entry.loggedAt ? entry.loggedAt.getTime() : 0;
              };
              return parseDate(b) - parseDate(a);
            });

            onEntries?.(rows);
            if (!readyEmitted) {
              notify({ kind: 'ready' });
              readyEmitted = true;
            }
          },
          (error) => {
            console.error('Logbook subscription error', error);
            notify({ kind: 'error', error });
          },
        );

        return db;
      } catch (error) {
        console.error('Failed to initialise Firebase logbook', error);
        firestoreModule = null;
        entriesRef = null;
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        dbPromise = null;
        readyEmitted = false;
        notify({ kind: 'error', error });
        throw error;
      }
    })();

    return dbPromise;
  }

  async function addEntry(entry) {
    await ensureFirestore();
    if (!firestoreModule || !entriesRef) {
      throw new Error('Firestore is not ready');
    }
    const payload = buildEntryPayload(entry, deviceId || ensureDeviceId());
    const now = new Date();
    try {
      await firestoreModule.addDoc(entriesRef, {
        ...payload,
        loggedAt: firestoreModule.serverTimestamp(),
        clientLoggedAt: firestoreModule.Timestamp.fromDate(now),
      });
    } catch (error) {
      notify({ kind: 'error', error });
      throw error;
    }
  }

  ensureFirestore().catch(() => {
    /* errors already reported via notify */
  });

  return {
    addEntry,
    destroy() {
      if (unsubscribe) {
        unsubscribe();
      }
    },
  };
}
