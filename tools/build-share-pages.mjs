#!/usr/bin/env node
/* ============================================================================
 * tools/build-share-pages.mjs
 * ----------------------------------------------------------------------------
 * Generates one small static HTML page per shareable thing on the site, into
 * /s/, plus sitemap.xml.
 *
 * WHY THIS EXISTS
 *   Discord, X, Facebook, Reddit and iMessage do NOT run JavaScript when they
 *   fetch a link for a preview — they read the raw HTML's <meta> tags. The main
 *   site is one JS-driven file using hash routing, and the part after '#' never
 *   even reaches the server. So a link to a single storyline can't carry its own
 *   preview no matter what the app does at runtime.
 *
 *   These pages solve that: each is a real URL with real meta tags. A crawler
 *   reads them; a human is forwarded straight into the app at the exact item.
 *   They double as the only pages Google can index individually.
 *
 * NO CONFIGURATION
 *   The Supabase URL and publishable key are read out of index.html, which is
 *   where the browser already gets them. Nothing to set up, no secrets, and it
 *   can never drift out of sync with the site.
 *
 * RUN IT
 *   node tools/build-share-pages.mjs            # normal
 *   node tools/build-share-pages.mjs --fixture tools/fixture.json   # offline test
 * ==========================================================================*/

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT     = process.cwd();
const OUT_DIR  = path.join(ROOT, 's');
const SITE     = process.env.WCA_SITE_URL || 'https://wcauniverse.github.io/WCA-Stats';
const BASE     = SITE.replace(/\/+$/, '') + '/';
const CARD     = BASE + 'share/wca-share-card.png';
const BRAND    = 'World Championship Alliance';

const args    = process.argv.slice(2);
const fixture = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null;

/* ── helpers ────────────────────────────────────────────────────────── */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const slug = (s) => String(s ?? '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Strip HTML and collapse to a preview-sized sentence. */
function summarise(html, max = 180) {
  const text = String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return (stop > max * 0.55 ? cut.slice(0, stop) : cut).trim() + '…';
}

/** og:image must be absolute — platforms ignore relative paths. */
function absolute(url) {
  const u = String(url ?? '').trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return BASE + u.replace(/^\/+/, '');
}

/* ── credentials, straight out of index.html ────────────────────────── */
async function readCredentials() {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const url = html.match(/https:\/\/[a-z0-9]+\.supabase\.co/i)?.[0];
  const key = html.match(/\b(?:sb_publishable_[A-Za-z0-9_\-]+|eyJ[A-Za-z0-9_\-.]{40,})\b/)?.[0];
  if (!url || !key) throw new Error('Could not find the Supabase URL/key in index.html');
  return { url, key };
}

async function q(cred, table, select, filter = '') {
  const u = `${cred.url}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter}`;
  const r = await fetch(u, { headers: { apikey: cred.key, Authorization: `Bearer ${cred.key}` } });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${r.statusText} — ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* ── gather everything worth its own link ───────────────────────────── */
async function gather() {
  if (fixture) {
    console.log(`(fixture mode: ${fixture})`);
    return JSON.parse(await readFile(fixture, 'utf8'));
  }
  const cred = await readCredentials();
  console.log('Supabase:', cred.url);
  const soft = async (label, p) => {
    try { return await p; }
    catch (e) { console.warn(`  ! ${label} skipped — ${e.message}`); return []; }
  };
  const [posts, events, wrestlers] = await Promise.all([
    soft('storylines', q(cred, 'storylines',
      'id,kind,title,body,payload,story_date,is_published', '&is_published=eq.true')),
    soft('events',     q(cred, 'v_archive_events', '*')),
    soft('wrestlers',  q(cred, 'wrestlers',
      'name,nickname,bio,image_url,avatar_url,is_active,from_loc,finishers'))
  ]);
  return { posts, events, wrestlers };
}

/* ── the page template ──────────────────────────────────────────────── */
function page({ title, description, image, deepLink, canonical, kicker, body }) {
  const img = image || CARD;
  const full = `${title} — ${BRAND}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(BRAND)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:alt" content="${esc(title)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">

<link rel="icon" href="${esc(BASE)}icons/icon-192.png">
<style>
  :root{--gold:#E9B949;--bg:#0d0d0f;--txt:#f2f2f0;--muted:#8a8a86;--line:#2a2a2e}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;
       background:var(--bg);color:var(--txt);
       font-family:'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif;}
  .card{max-width:640px;width:100%;text-align:center}
  .kicker{font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:var(--gold);margin-bottom:14px}
  h1{font-family:'Oswald',Impact,sans-serif;font-weight:700;font-size:clamp(26px,5vw,40px);
     line-height:1.06;text-transform:uppercase;margin:0 0 14px}
  p{color:var(--muted);line-height:1.65;margin:0 0 22px}
  img.hero{width:100%;max-height:320px;object-fit:cover;border:1px solid var(--line);
           border-radius:12px;margin-bottom:22px}
  a.go{display:inline-block;padding:13px 26px;border:1px solid var(--gold);border-radius:8px;
       color:var(--gold);text-decoration:none;font-family:'Oswald',sans-serif;font-size:14px;
       letter-spacing:1.6px;text-transform:uppercase}
  a.go:hover{background:rgba(233,185,73,.12)}
  .wait{margin-top:18px;font-size:12px;color:#55534e}
</style>
</head>
<body>
  <main class="card">
    ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${image ? `<img class="hero" src="${esc(image)}" alt="${esc(title)}">` : ''}
    ${body ? `<p>${esc(body)}</p>` : ''}
    <a class="go" href="${esc(deepLink)}">Open on WCA</a>
    <div class="wait">Taking you there…</div>
  </main>
<script>
  // Humans get forwarded to the exact item. Crawlers don't run this and read
  // the markup above instead, which is the whole point.
  location.replace(${JSON.stringify(deepLink)});
</script>
<noscript><meta http-equiv="refresh" content="0;url=${esc(deepLink)}"></noscript>
</body>
</html>
`;
}

/* ── build ──────────────────────────────────────────────────────────── */
const KIND_LABEL = {
  article: 'Storyline', promo: 'Promo', interview: 'Interview',
  presser: 'Press Q&A', social: 'Social', report: 'Report'
};

function buildEntries({ posts = [], events = [], wrestlers = [] }) {
  const out = [];

  for (const p of posts) {
    if (!p || p.is_published === false) continue;
    let photo = null;
    try {
      const pl = typeof p.payload === 'string' ? JSON.parse(p.payload) : (p.payload || {});
      photo = pl.photo || (Array.isArray(pl.photos) && pl.photos.length ? pl.photos[0] : null);
      if (photo && typeof photo === 'object') photo = photo.url || photo.src || null;
    } catch { /* payload isn't JSON — no photo, carry on */ }
    const title = (p.title || '').trim() || 'WCA Storyline';
    out.push({
      dir: `post/${p.id}`,
      title,
      kicker: KIND_LABEL[p.kind] || 'Storyline',
      description: summarise(p.body) || `A storyline from ${BRAND}.`,
      image: absolute(photo),
      deepLink: `${BASE}#storylines?post=${encodeURIComponent(p.id)}`,
      date: p.story_date || null
    });
  }

  for (const e of events) {
    if (!e || e.id == null) continue;
    const name = (e.name || 'WCA Event').trim();
    const bits = [];
    if (e.match_count) bits.push(`${e.match_count} match${e.match_count === 1 ? '' : 'es'}`);
    if (e.champion_name) bits.push(`${e.champion_name} left as champion`);
    out.push({
      dir: `event/${e.id}`,
      title: name,
      kicker: e.tagline ? String(e.tagline) : 'Event',
      description: bits.length
        ? `${name} — ${bits.join(', ')}. Full card, results and final standings.`
        : `${name} — full card, results and final standings from ${BRAND}.`,
      image: absolute(e.poster_url),
      deepLink: `${BASE}#archive?event=${encodeURIComponent(e.id)}`,
      date: e.event_date || null
    });
  }

  const seen = new Set();
  for (const w of wrestlers) {
    if (!w || !w.name) continue;
    const s = slug(w.name);
    if (!s || seen.has(s)) continue;         // slug collision — first one wins
    seen.add(s);
    const desc = summarise(w.bio, 150) ||
      [w.nickname && `"${w.nickname}"`, w.from_loc && `From ${w.from_loc}.`,
       `Record, rankings and match history on ${BRAND}.`].filter(Boolean).join(' ');
    out.push({
      dir: `wrestler/${s}`,
      title: w.name,
      kicker: w.nickname ? String(w.nickname) : 'Roster',
      description: desc,
      image: absolute(w.image_url || w.avatar_url),
      deepLink: `${BASE}#roster?w=${encodeURIComponent(w.name)}`
    });
  }

  // plain pages worth their own preview
  for (const [dir, title, kicker, hash, description] of [
    ['apply',       'Join the WCA Roster', 'Apply',   '#apply',
     'Bring your own character into the World Championship Alliance. Here\u2019s how to apply and what happens next.'],
    ['roster',      'The WCA Roster',      'Roster',  '#roster',
     'Every competitor and stable in the World Championship Alliance, mapped as a constellation.'],
    ['rankings',    'WCA Rankings',        'Rankings','#rankings',
     'Championship divisions, contender points and who is next in line for a title shot.'],
    ['leaderboard', 'WCA Leaderboard',     'Leaderboard','#leaderboard',
     'How the community is doing \u2014 coins, streaks and standings across the season.'],
    ['storylines',  'WCA Storylines',      'Storylines','#storylines',
     'Headlines, promos, interviews and dirt from around the World Championship Alliance.'],
    ['events',      'WCA Events',          'Events',  '#events',
     'The next WCA show \u2014 full card, start time and where to watch.']
  ]) out.push({ dir, title, kicker, description, image: null, deepLink: BASE + hash });

  return out;
}

async function main() {
  const data = await gather();
  const entries = buildEntries(data);

  // rebuilt from scratch each run, so pages for deleted content disappear
  if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true, force: true });

  const counts = {};
  for (const e of entries) {
    const canonical = `${BASE}s/${e.dir}/`;
    const dir = path.join(OUT_DIR, ...e.dir.split('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), page({ ...e, canonical, body: e.description }), 'utf8');
    const k = e.dir.split('/')[0];
    counts[k] = (counts[k] || 0) + 1;
  }

  // sitemap: the app itself, plus every share page
  const urls = [{ loc: BASE, priority: '1.0' }].concat(
    entries.map(e => ({ loc: `${BASE}s/${e.dir}/`, lastmod: e.date, priority: '0.7' })));
  await writeFile(path.join(ROOT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc>` +
  (u.lastmod ? `<lastmod>${esc(String(u.lastmod).slice(0, 10))}</lastmod>` : '') +
  `<priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`, 'utf8');

  await writeFile(path.join(ROOT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${BASE}sitemap.xml\n`, 'utf8');

  console.log('\nShare pages written:');
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(10)} ${v}`);
  console.log(`  ${'TOTAL'.padEnd(10)} ${entries.length}`);
  console.log('sitemap.xml + robots.txt written.');
}

main().catch(e => { console.error('\nBuild failed:', e.message); process.exit(1); });
