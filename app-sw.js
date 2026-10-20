/* WCA app worker (app-sw.js)
   This exists ONLY so phones and Chrome/Edge offer "Install app" for the
   website. It deliberately caches NOTHING: every page and file still comes
   straight from the website, so a new upload is live on the next visit.
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
