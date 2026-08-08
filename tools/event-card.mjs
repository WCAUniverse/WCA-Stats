/* ============================================================================
 * tools/event-card.mjs
 * ----------------------------------------------------------------------------
 * Draws the 1200x630 share card for one event.
 *
 *   [ left competitor ]      EVENT NAME      [ right competitor ]
 *
 * The main event's two sides sit left and right, the event name and number in
 * the middle. If a competitor has a portrait it's used; if not, their NAME is
 * drawn in the same slot — so a show with no photos still produces a card that
 * looks deliberate rather than broken.
 *
 * Rendered from SVG via resvg, so no browser or canvas is involved.
 * ==========================================================================*/

import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'fs/promises';
import path from 'path';

const W = 1200, H = 630;
const GOLD = '#E9B949', GOLD_D = '#96742a', PARCH = '#efe9db', MUTED = '#8a8a86';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Rough text width, so long names can be scaled down instead of overflowing. */
function fitSize(text, maxWidth, startSize, minSize = 14, ratio = 0.62) {
  let size = startSize;
  while (size > minSize && String(text).length * size * ratio > maxWidth) size -= 1;
  return size;
}

/** Split a long name onto two lines at the nearest space. */
function wrapName(name, maxChars) {
  const s = String(name || '').trim();
  if (s.length <= maxChars) return [s];
  const mid = Math.floor(s.length / 2);
  let cut = -1, best = 1e9;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ' ' && Math.abs(i - mid) < best) { best = Math.abs(i - mid); cut = i; }
  }
  if (cut < 0) return [s];
  return [s.slice(0, cut), s.slice(cut + 1)];
}

async function fetchImageDataUri(url, timeoutMs = 8000) {
  if (!url) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').toLowerCase();
    if (!/^image\/(png|jpe?g|webp|gif)/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

/** One competitor slot: portrait if we have one, otherwise their name. */
function sideSvg(x, side, id) {
  const boxW = 330, boxH = 400, cy = 330;
  const top = cy - boxH / 2;
  if (side.photo) {
    return `
  <defs><clipPath id="clip${id}"><rect x="${x - boxW / 2}" y="${top}" width="${boxW}" height="${boxH}" rx="10"/></clipPath></defs>
  <rect x="${x - boxW / 2}" y="${top}" width="${boxW}" height="${boxH}" rx="10" fill="#12141c"/>
  <image href="${esc(side.photo)}" x="${x - boxW / 2}" y="${top}" width="${boxW}" height="${boxH}"
         preserveAspectRatio="xMidYMid slice" clip-path="url(#clip${id})"/>
  <rect x="${x - boxW / 2}" y="${top}" width="${boxW}" height="${boxH}" rx="10" fill="none" stroke="${GOLD_D}" stroke-width="2"/>
  <rect x="${x - boxW / 2}" y="${top + boxH - 72}" width="${boxW}" height="72" fill="rgba(6,8,16,.82)" clip-path="url(#clip${id})"/>
  <text x="${x}" y="${top + boxH - 28}" text-anchor="middle" font-family="Oswald" font-weight="700"
        font-size="${fitSize(side.name, boxW - 30, 30, 14)}" fill="${PARCH}">${esc(side.name.toUpperCase())}</text>`;
  }
  // No portrait — the name carries the slot on its own.
  const lines = wrapName(side.name, 13);
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
  const size = fitSize(longest, boxW - 46, 46, 18);
  return `
  <rect x="${x - boxW / 2}" y="${top}" width="${boxW}" height="${boxH}" rx="10"
        fill="#101219" stroke="${GOLD_D}" stroke-width="2"/>
  ${lines.map((ln, i) =>
    `<text x="${x}" y="${cy + (i - (lines.length - 1) / 2) * (size + 8) + size * 0.34}" text-anchor="middle"
           font-family="Oswald" font-weight="700" font-size="${size}" fill="${PARCH}">${esc(ln.toUpperCase())}</text>`
  ).join('')}`;
}

/**
 * @param {{name, tagline, date, matchCount, sides:[{name,photo}], stip}} ev
 * @returns {Buffer} PNG
 */
const titleLinesRaw = (t) => (t.length > 11 ? wrapName(t, 11) : [t]);

export async function renderEventCard(ev, fontFiles) {
  const left  = ev.sides[0] || { name: 'WCA' };
  const right = ev.sides[1] || { name: 'WCA' };

  const [lp, rp] = await Promise.all([
    fetchImageDataUri(left.photo), fetchImageDataUri(right.photo)
  ]);
  left.photo = lp; right.photo = rp;

  const title = String(ev.name || 'WCA Event').toUpperCase();
  const titleSize = fitSize(titleLinesRaw(title)[0], 300, 62, 22, 0.62);
  const titleLines = titleLinesRaw(title);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="46%" r="72%">
      <stop offset="0%" stop-color="#161a26"/><stop offset="70%" stop-color="#0a0b12"/>
      <stop offset="100%" stop-color="#05060b"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="26" y="26" width="${W - 52}" height="${H - 52}" fill="none" stroke="${GOLD_D}" stroke-width="1"/>
  <path d="M26 72 V26 H72"   stroke="${GOLD}" stroke-width="3" fill="none"/>
  <path d="M${W - 72} 26 H${W - 26} V72" stroke="${GOLD}" stroke-width="3" fill="none"/>
  <path d="M26 ${H - 72} V${H - 26} H72" stroke="${GOLD}" stroke-width="3" fill="none"/>
  <path d="M${W - 72} ${H - 26} H${W - 26} V${H - 72}" stroke="${GOLD}" stroke-width="3" fill="none"/>

  <text x="${W / 2}" y="80" text-anchor="middle" font-family="Barlow Condensed" font-size="21"
        letter-spacing="6" fill="${GOLD}">WORLD CHAMPIONSHIP ALLIANCE</text>

  ${sideSvg(232, left, 'L')}
  ${sideSvg(W - 232, right, 'R')}

  <text x="${W / 2}" y="252" text-anchor="middle" font-family="Barlow Condensed" font-size="19"
        letter-spacing="4" fill="${MUTED}">${esc((ev.stip || 'MAIN EVENT').toUpperCase())}</text>

  ${titleLines.map((ln, i) =>
    `<text x="${W / 2}" y="${318 + (i - (titleLines.length - 1) / 2) * (titleSize + 6)}" text-anchor="middle"
           font-family="Oswald" font-weight="700" font-size="${titleSize}" fill="${PARCH}">${esc(ln)}</text>`
  ).join('')}

  <line x1="${W / 2 - 96}" y1="${352 + (titleLines.length - 1) * 34}" x2="${W / 2 + 96}"
        y2="${352 + (titleLines.length - 1) * 34}" stroke="${GOLD}" stroke-width="2"/>

  ${ev.tagline ? `<text x="${W / 2}" y="${386 + (titleLines.length - 1) * 34}" text-anchor="middle"
        font-family="Barlow Condensed" font-size="22" letter-spacing="2"
        fill="${GOLD}">${esc(String(ev.tagline).toUpperCase())}</text>` : ''}

  <text x="${W / 2}" y="${H - 74}" text-anchor="middle" font-family="Barlow Condensed" font-size="20"
        letter-spacing="3" fill="${MUTED}">${esc([ev.date, ev.matchCount ? ev.matchCount + ' MATCHES' : '']
          .filter(Boolean).join('   ·   ').toUpperCase())}</text>
  <text x="${W / 2}" y="${H - 46}" text-anchor="middle" font-family="Barlow Condensed" font-size="16"
        letter-spacing="2" fill="${GOLD_D}">WCAUNIVERSE.GITHUB.IO/WCA-STATS</text>
</svg>`;

  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles, loadSystemFonts: true, defaultFontFamily: 'Oswald' }
  });
  return r.render().asPng();
}
