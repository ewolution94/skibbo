// Skibbo QA: a host and a guest (and bots) play a whole game through the page, as people would: each
// move is the journeyman's (server/bots.mjs, on the seat's own view from the server), made with the
// page's controls: a tap on the plate and a tap on the pile, every third play a drag instead, and a
// discard with its ✓. Screenshots of the stages, page overflow, console errors, refusals the table
// shows, and the jump check: the band, the others, the piles, your side and the hand keep their place
// and size every frame (learnings/projects/stichle.md, "the table never moves"). Not part of CI:
// Playwright is borrowed from Folio's checkout next door (the workspace's `folio/node_modules`,
// WebKit installed).
//
//   npm run build && node server/server.mjs --port 6811        (or the skibbo-prod preview)
//   node tools/qa.mjs [base] [outdir]          W=1180 H=820 PEOPLE=2 BOTS=1 STOCK=10 by default
//   W=820 H=1180 node tools/qa.mjs …           the iPad upright; W=390 H=844 the phone
//   SOLO=1 node tools/qa.mjs …                 a game alone instead (the rules in the page)
//   AUDIT=1 node tools/qa.mjs …                every shot also checks that text sits in the middle of its box
//   BROWSER=chromium node tools/qa.mjs …       in Chromium
import { chromium, webkit } from '../../folio/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { botMove } from '../server/bots.mjs';
import { textAudit } from './text-audit.mjs';

const BASE = process.argv[2] ?? 'http://localhost:6811';
const OUT = process.argv[3] ?? '/tmp/skibbo-qa/';
const W = Number(process.env.W ?? 1180), H = Number(process.env.H ?? 820);
const LANG = process.env.LANG_UI ?? 'de';
const PEOPLE = Number(process.env.PEOPLE ?? 2);
const BOTS = Number(process.env.BOTS ?? 1);
const STOCK = process.env.STOCK ?? '10';
const SOLO = Boolean(process.env.SOLO);
const AUDIT = Boolean(process.env.AUDIT);
const LIMIT = Number(process.env.LIMIT_S ?? 600) * 1000;
mkdirSync(OUT, { recursive: true });

const problems = [];
const say = (...a) => console.log(...a);
const browser = await (process.env.BROWSER === 'chromium' ? chromium : webkit).launch();

async function person(name) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: W < 900 });
  await context.addInitScript(([lang, who]) => {
    try {
      localStorage.setItem('ewo:lang', lang);
      localStorage.setItem('skibbo:guide', '1');
      localStorage.setItem('skibbo:name', who);
    } catch {}
    // Every frame: where the table's fixed parts are. Any change while playing is a jump.
    const watched = ['.stage .band', '.stage .opps', '.stage .street', '.stage .status', '.stage .mine', '.stage .hand'];
    const last = new Map();
    window.__jumps = [];
    const tick = () => {
      if (document.querySelector('.stage')) {
        for (const sel of watched) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const box = [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
          const before = last.get(sel);
          if (before && before.some((v, i) => Math.abs(v - box[i]) > 1)) window.__jumps.push({ sel, before, now: box, at: Math.round(performance.now()) });
          last.set(sel, box);
        }
      } else last.clear();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [LANG, name]);
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${name}: pageerror: ${e.message}`));
  return { name, page, context, shots: 0, moves: 0, drags: 0 };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The seat's own view from the server: the first message of its stream. */
async function viewOf(p, code) {
  return p.page.evaluate(async (c) => {
    const seat = JSON.parse(localStorage.getItem(`skibbo:seat:${c}`) ?? 'null');
    if (!seat) return null;
    const ctrl = new AbortController();
    const res = await fetch(`/api/rooms/${c}/events?p=${seat.player}`, { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      const line = text.split('\n').find((l) => l.startsWith('data: '));
      if (line && text.includes('\n\n')) {
        ctrl.abort();
        return JSON.parse(line.slice(6));
      }
    }
    return null;
  }, code);
}

async function shot(p, label) {
  p.shots++;
  await p.page.screenshot({ path: `${OUT}${p.name}-${String(p.shots).padStart(2, '0')}-${label}.png` });
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (wide) problems.push(`${p.name}: the page is wider than the window at ${label}`);
  if (AUDIT) {
    const rows = await p.page.evaluate(textAudit, { min: 1.5 });
    for (const r of rows) if (Math.abs(r.off - r.bias) > 1.5) problems.push(`${p.name}: text off-centre at ${label}: ${r.where} "${r.text}" ${r.off}px`);
  }
}

/** Clicks the centre of an element (a tap on a phone). */
async function tap(p, selector) {
  const el = p.page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 4000 });
  if (W < 900) await el.tap();
  else await el.click();
}

/** A drag from one element to another, in small steps, as a finger or a mouse would. */
async function drag(p, from, to) {
  const a = await p.page.locator(from).first().boundingBox();
  const b = await p.page.locator(to).first().boundingBox();
  if (!a || !b) return false;
  const m = p.page.mouse;
  await m.move(a.x + a.width / 2, a.y + a.height / 2);
  await m.down();
  for (let i = 1; i <= 10; i++) await m.move(a.x + a.width / 2 + ((b.x - a.x + (b.width - a.width) / 2) * i) / 10, a.y + a.height / 2 + ((b.y - a.y + (b.height - a.height) / 2) * i) / 10);
  await m.up();
  return true;
}

/** Where a move's plate lies on the page. */
function sourceOf(move, me) {
  if (move.from === 'hand') return `[data-card="${move.card}"]`;
  const owner = move.owner ?? me;
  if (owner === me) return move.from === 'stock' ? '[data-mystock]' : `[data-slot="${move.slot}"] .top`;
  return move.from === 'stock' ? `[data-opp="${owner}"] .otop` : `[data-opp="${owner}"] [data-ofan="${move.slot}"] .top`;
}

/** One move of this person's, if it's their turn; true when they moved. */
async function play(p, code) {
  const view = await viewOf(p, code);
  if (!view || view.phase !== 'play' || !view.game) return false;
  const g = view.game;
  const s = g.state;
  if (s.phase !== 'play' || s.turn !== g.seat || g.autopilot === g.seat) return false;
  const move = botMove(s, { level: 'journeyman' });
  if (!move) return false;
  const turnNo = s.turnNo;
  if (move.type === 'play') {
    const from = sourceOf(move, g.seat);
    const to = `[data-pile="${move.pile}"]`;
    if (p.moves % 3 === 2 && (await drag(p, from, to))) p.drags++;
    else {
      await tap(p, from);
      await tap(p, to);
    }
  } else if (move.type === 'discard') {
    await tap(p, `[data-card="${move.card}"]`);
    await tap(p, `[data-slot="${move.slot}"]`);
    await tap(p, '.endb');
  } else {
    await tap(p, '.endturn');
  }
  p.moves++;
  // The table answers at once; give the server a moment to agree, and look for a refusal.
  await wait(420);
  const refusal = await p.page.locator('.status.error').count();
  if (refusal) problems.push(`${p.name}: refused: ${await p.page.locator('.status.error').innerText()} (${JSON.stringify(move)}, turn ${turnNo})`);
  return true;
}

// ---- the table ------------------------------------------------------------------------------

const t0 = Date.now();
const host = await person('host');
await host.page.goto(BASE);
await host.page.waitForSelector('.home');
await shot(host, 'home');
let code = null;
const people = [host];

if (SOLO) {
  await host.page.evaluate(([bots, stock]) => localStorage.setItem('skibbo:solo-setup', JSON.stringify({ bots, level: 'journeyman', stock: stock === 'auto' ? 'auto' : Number(stock), target: 0, teams: false })), [Math.max(1, BOTS), STOCK]);
  await host.page.reload();
  await host.page.locator('.home .btn.primary').first().click();
  await host.page.waitForSelector('.stage');
  await shot(host, 'solo');
  say('solo game started');
  while (Date.now() - t0 < LIMIT) {
    if (await host.page.locator('.final').count()) break;
    const mine = await host.page.locator('.stage.mine-turn').count();
    if (!mine) {
      await wait(300);
      continue;
    }
    // Alone, the page holds the whole game: the move comes from the bot on the page's own state.
    const move = await host.page.evaluate(() => JSON.parse(localStorage.getItem('skibbo:solo') ?? 'null')?.state ?? null);
    if (!move) break;
    const { view } = await import('../server/rules.mjs');
    const m = botMove(view(move, 0), { level: 'journeyman' });
    if (!m) {
      await wait(300);
      continue;
    }
    if (m.type === 'play') {
      const from = sourceOf(m, 0);
      if (host.moves % 3 === 2 && (await drag(host, from, `[data-pile="${m.pile}"]`))) host.drags++;
      else {
        await tap(host, from);
        await tap(host, `[data-pile="${m.pile}"]`);
      }
    } else if (m.type === 'discard') {
      await tap(host, `[data-card="${m.card}"]`);
      await tap(host, `[data-slot="${m.slot}"]`);
      await tap(host, '.endb');
    } else await tap(host, '.endturn');
    host.moves++;
    await wait(380);
    if (host.moves % 25 === 1) await shot(host, `move${host.moves}`);
    if (await host.page.locator('.status.error').count()) problems.push(`host: refused: ${await host.page.locator('.status.error').innerText()}`);
  }
} else {
  await host.page.locator('.home .btn.navy').last().click();
  await host.page.waitForSelector('.lobby');
  code = new URL(host.page.url()).pathname.slice(1);
  say('table', code);
  for (let i = 1; i < PEOPLE; i++) {
    const guest = await person(`guest${i}`);
    await guest.page.goto(`${BASE}/${code}`);
    await guest.page.locator('form .btn.primary').click();
    await guest.page.waitForSelector('.lobby');
    people.push(guest);
  }
  for (let i = 0; i < BOTS; i++) {
    await host.page.locator('.lobby .seats .btn', { hasText: /Bot|bot/ }).last().click();
    await wait(250);
  }
  await host.page.evaluate(async ([c, stock]) => {
    const seat = JSON.parse(localStorage.getItem(`skibbo:seat:${c}`));
    await fetch(`/api/rooms/${c}/settings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skibbo-token': seat.token }, body: JSON.stringify({ rules: { stock: stock === 'auto' ? 'auto' : Number(stock) } }) });
  }, [code, STOCK]);
  await wait(300);
  await shot(host, 'lobby');
  await host.page.locator('.lobby .go .btn.primary').click();
  await Promise.all(people.map((p) => p.page.waitForSelector('.stage')));
  for (const p of people) await shot(p, 'start');
  say('game started');
  let quiet = Date.now();
  while (Date.now() - t0 < LIMIT) {
    if (await host.page.locator('.final').count()) break;
    let moved = false;
    for (const p of people) if (await play(p, code)) moved = true;
    if (moved) quiet = Date.now();
    else if (Date.now() - quiet > 45_000) {
      problems.push('nothing moved for 45 s');
      break;
    }
    else await wait(300);
    const total = people.reduce((n, p) => n + p.moves, 0);
    if (moved && total % 30 === 1) for (const p of people) await shot(p, `move${total}`);
  }
}

for (const p of people) {
  await wait(400);
  await shot(p, 'end');
  const jumps = await p.page.evaluate(() => window.__jumps);
  for (const j of jumps.slice(0, 5)) problems.push(`${p.name}: jump: ${j.sel} ${j.before} → ${j.now} at ${j.at} ms`);
  if (jumps.length > 5) problems.push(`${p.name}: … ${jumps.length - 5} more jumps`);
}
const ended = await host.page.locator('.final').count();
say(`${ended ? 'game over' : 'NOT OVER'} after ${Math.round((Date.now() - t0) / 1000)} s; moves ${people.map((p) => `${p.name} ${p.moves} (${p.drags} drags)`).join(', ')}`);
if (!ended) problems.push('the game did not end in time');
say(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no problems');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
