/* WCA app worker (app-sw.js)
   1) Lets phones and Chrome/Edge offer "Install app" for the website.
   2) Shows WCA notifications (Oct 2026), even when the site is closed.

   It still caches NOTHING: every page and file comes straight from the
   website, so a new upload is live on the next visit.
   (The old sw.js cached the site and served stale copies. The site removes
   that one automatically and keeps this one.) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;          // files, images, Supabase: untouched
  e.respondWith(
    fetch(e.request).catch(() => new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>WCA</title><body style="margin:0;background:#0d0d0f;color:#e9e6df;font:16px system-ui,sans-serif;' +
      'display:grid;place-items:center;height:100vh;text-align:center"><div><h1 style="color:#e9b949">You\'re offline</h1>' +
      '<p>Connect to the internet and the WCA app will load again.</p></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  );
});

/* ---------- notifications ----------
   The push-send edge function sends {title, body, url, tag, category, ...}. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'WCA', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'WCA';
  const opts = {
    body: d.body || '',
    icon: d.icon || '/icons/icon-192.png',
    badge: d.badge || '/icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!(d.tag && d.renotify),
    timestamp: d.ts || Date.now(),
    data: { url: d.url || '/', id: d.id || null, category: d.category || 'news' },
    requireInteraction: d.category === 'admin'
  };
  e.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    // an open WCA tab updates its bell straight away
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(c => c.postMessage({ type: 'wca-push', id: d.id || null, category: d.category || 'news' }));
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // use a WCA window that is already open: the site switches page without reloading
    const same = wins.find(c => new URL(c.url).origin === self.location.origin);
    if (same) {
      try { await same.focus(); } catch (_) {}
      same.postMessage({ type: 'wca-open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// the browser renewed this device's push sign up: tell the site so it saves the new one
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(c => c.postMessage({ type: 'wca-resubscribe' }));
  })());
});
