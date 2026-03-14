// Daily Reader — Service Worker
// Handles: offline caching, PWA install, 7 PM periodic background reminder
// CACHE_NAME is bumped by deploy.sh on every push so stale shells get evicted.

const CACHE_NAME = 'daily-reader-v20260314091844'; // ← deploy.sh replaces the version tag
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  PDFJS_BASE + 'pdf.min.js',
  PDFJS_BASE + 'pdf.worker.min.js'
];

// ─── Install: cache all shell assets ───────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch strategy ─────────────────────────────────────────────────────────
//  • App shell (index.html, manifest, icons): network-first → cache fallback.
//    This ensures users always get the latest version when online.
//  • CDN assets (PDF.js): cache-first — large files that never change.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;
  const isPDFjs = url.includes('cdnjs.cloudflare.com');

  if (isPDFjs) {
    // Cache-first: PDF.js is versioned and never changes
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        });
      })
    );
  } else {
    // Network-first: always try to get the latest app shell;
    // fall back to cache so the app still works offline.
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

// ─── Periodic Background Sync: 7 PM reminder ───────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'daily-reminder') {
    event.waitUntil(handleDailyReminder());
  }
});

async function handleDailyReminder() {
  const now = new Date();
  const hour = now.getHours();

  // Only fire between 7 PM and 10 PM
  if (hour < 19 || hour >= 22) return;

  try {
    const state = await getAppState();
    if (!state) return;

    const today = now.toISOString().split('T')[0];

    // Don't notify if: wrong day, already done, already notified
    if (state.today !== today) return;
    if (state.todayCompleted) return;
    if (state.notifiedToday) return;

    const pagesCompleted = state.pagesCompletedToday || 0;

    await self.registration.showNotification('📖 Daily Reading Reminder', {
      body: pagesCompleted > 0
        ? `You've read ${pagesCompleted} of 5 pages today — almost there!`
        : "You haven't started today's reading yet. 5 pages is all it takes!",
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'daily-reminder',
      renotify: false,
      requireInteraction: false,
      actions: [
        { action: 'open', title: '📖 Read Now' }
      ]
    });

    // Mark notified in IDB so we don't spam
    await updateAppState({ notifiedToday: true });

  } catch (err) {
    console.error('[SW] Periodic sync error:', err);
  }
}

// ─── Notification click: open the app ──────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes('index.html') || c.url.endsWith('/'));
      if (existing) return existing.focus();
      return self.clients.openWindow('./');
    })
  );
});

// ─── IDB helpers (SW can't access localStorage) ────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('DailyReaderDB', 1);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains('data')) {
        e.target.result.createObjectStore('data');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function getAppState() {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('data', 'readonly');
      const req = tx.objectStore('data').get('appState');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  } catch { return null; }
}

async function updateAppState(patch) {
  try {
    const db = await openIDB();
    const current = await getAppState() || {};
    const updated = { ...current, ...patch };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      const req = tx.objectStore('data').put(updated, 'appState');
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  } catch { /* silent */ }
}
