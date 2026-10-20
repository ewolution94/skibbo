<!--
  The table, tablet first (the user, 2026-10-20: "the main focus would be tablet and up screen sizes
  for playability"), laid out as sketched in development/plans/skibbo/looks.html:

    sideways (wider than tall, from 700 px)  the others along the top, each with their stock and four
                                             discard piles fanned; the four piles in the middle with
                                             the draw pile and the cleared ones beside them; your
                                             stock, your four discard piles and your hand of five
                                             along the bottom
    upright                                  the same, with the hand in its own row below
    phone (under 700 px)                     the others' tops only, everything smaller, the hand at
                                             the thumb

  Each layout is drawn at one size (1180 × 820, 820 × 1180, 390 wide) and scaled to the window, so a
  laptop or a big screen gets the same table larger (Settings → Table size). Nothing changes height
  while you play: the table never moves under a finger (learnings/projects/stichle.md).

  You play by dragging a plate onto a pile, or tapping it and then the pile; a card from your hand
  onto one of your discard piles ends the turn, after a ✓ beside it (a move you can't take back waits
  for a confirm: learnings/ui-preferences.md). Every move shows at once and flies to where it goes;
  the others' moves fly the same way, one after another, from their side of the table.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { ApiError, isJoker, value, type CardId, type GameState, type TableEvent } from '../lib/api';
  import { errorText, names, t } from '../lib/i18n.svelte';
  import type { Driver, MatchView, Move } from '../lib/match';
  import { prefs } from '../lib/prefs.svelte';
  import { play, unlockOnGesture } from '../lib/sound.svelte';
  import { answers, fits, othersFrom, partnerOf, placeHand, playOf, shows, stillThere, withMoves, type Pick } from '../lib/table';
  import Avatar from './Avatar.svelte';
  import Clock from './Clock.svelte';
  import Plate from './Plate.svelte';
  import RoundEnd from './RoundEnd.svelte';

  let { match, driver, onsettings }: { match: MatchView; driver: Driver; onsettings: () => void } = $props();

  type Layout = 'land' | 'port' | 'phone';
  type Rect = { x: number; y: number; w: number; h: number };
  type Flight = { key: number; card: CardId; as: number; from: Rect; to: Rect; ms: number; done: () => void };

  /** Each layout's drawing size, and its discard fans: a plate's height, the step between plates, how many show. */
  const BASE: Record<Layout, { w: number; h: number; fan: { ph: number; step: number; max: number }; ofan: { ph: number; step: number; max: number } }> = {
    land: { w: 1180, h: 820, fan: { ph: 138, step: 26, max: 4 }, ofan: { ph: 62, step: 13, max: 3 } },
    port: { w: 820, h: 1180, fan: { ph: 174, step: 28, max: 4 }, ofan: { ph: 50, step: 11, max: 3 } },
    phone: { w: 390, h: 724, fan: { ph: 88, step: 17, max: 4 }, ofan: { ph: 26, step: 0, max: 1 } },
  };

  // ---- the screen ---------------------------------------------------------------------------

  let tableEl: HTMLDivElement | undefined = $state();
  let stageEl: HTMLDivElement | undefined = $state();
  let room = $state({ w: 1180, h: 820 });
  const layout: Layout = $derived(room.w < 700 ? 'phone' : room.w / room.h >= 1.12 ? 'land' : 'port');
  const base = $derived(BASE[layout]);
  const k = $derived.by(() => {
    if (layout === 'phone') return Math.min(1.25, room.w / base.w);
    const fit = Math.min(room.w / base.w, room.h / base.h);
    return prefs.size === 'auto' ? fit : fit * (Number(prefs.size) / 100);
  });
  /** The phone's table is as tall as the screen; the others keep their drawn height. */
  const stageH = $derived(layout === 'phone' ? Math.max(660, room.h / k) : base.h);

  // ---- what's shown -------------------------------------------------------------------------

  const me = $derived(match.me);
  /** Your moves on their way to the server, shown already. */
  let pending: { move: Move; after: number }[] = $state([]);
  const s: GameState = $derived(withMoves(match.state, pending.map((p) => p.move), me));
  const over = $derived(match.over || s.phase === 'over');
  const partner = $derived(me >= 0 ? partnerOf(s, me) : -1);
  const myTurn = $derived(!over && me >= 0 && s.phase === 'play' && s.turn === me && match.autopilot !== me);
  const others = $derived(othersFrom(s.players, me));
  const nextSeat = $derived(others[0] ?? -1);
  const compact = $derived(others.length >= 4);

  /** Piles held at what they showed before a plate of yours that is still in the air lands on them. */
  let held: Record<number, { n: number; top: CardId | null }> = $state({});
  /** The piles as the others' plays have landed so far, while some are still in the air (else null). */
  let lagBuild: { n: number; top: CardId | null }[] | null = $state(null);
  /** Discard piles whose new top is still in the air: `${seat}:${slot}`. */
  let landing: Record<string, boolean> = $state({});
  const pileShown = (i: number) => held[i] ?? lagBuild?.[i] ?? s.build[i];

  /** The hand in its five places (nothing slides when a card leaves). */
  let slots: (CardId | null)[] = $state([null, null, null, null, null]);
  $effect(() => {
    const hand = s.hand;
    slots = placeHand(untrack(() => slots), hand);
  });

  let pick: Pick | null = $state(null);
  /** A card from your hand over one of your discard piles, waiting for its ✓. */
  let confirm: { slot: number } | null = $state(null);
  let error = $state('');

  // A pick whose card has gone (the server's answer, a turn ending) drops.
  $effect(() => {
    const st = s;
    const p = untrack(() => pick);
    if (p && (!myTurn || !stillThere(st, p))) {
      pick = null;
      confirm = null;
    }
  });

  const name = (seat: number) => match.people[seat]?.name ?? '?';
  const turnName = $derived(name(s.turn));
  const stockFits = $derived(myTurn && s.seats[me]?.stockTop != null && s.build.some((p) => fits(p.n, s.seats[me].stockTop!)));
  const fitsAnywhere = (card: CardId) => s.build.some((p) => fits(p.n, card));

  const hint = $derived.by(() => {
    if (over) return '';
    if (s.phase === 'roundEnd') return '';
    if (me < 0) return t('hintTheirs', { name: turnName });
    if (match.autopilot >= 0) return match.autopilot === me ? t('hintAutoYou') : t('hintAuto', { name: turnName });
    if (s.turn !== me) return s.turn < 0 ? '' : t('hintTheirs', { name: turnName });
    if (confirm) return t('hintConfirm');
    if (pick) {
      if (!fitsAnywhere(pick.card)) return pick.from === 'hand' ? t('hintPickedHand') : t('hintNoFit');
      return pick.from === 'hand' ? t('hintPickedHand') : t('hintPicked');
    }
    if (!s.hand.length) return t('hintEnd');
    if (stockFits) return t('hintStock');
    return t('hintYours');
  });

  // ---- the screen's size, the touches, the keys ----------------------------------------------

  onMount(() => {
    unlockOnGesture();
    const measure = () => {
      if (!tableEl) return;
      const cs = getComputedStyle(tableEl);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      room = { w: Math.max(320, tableEl.clientWidth - padX), h: Math.max(480, tableEl.clientHeight - padY) };
    };
    const ro = new ResizeObserver(measure);
    if (tableEl) ro.observe(tableEl);
    measure();
    // A drag anywhere on the table is the table's: on the iPhone and the iPad an unclaimed touch pulls
    // the whole page (Würfle's finding, learnings/ios-and-webkit.md).
    const claim = (e: TouchEvent) => {
      if (!(e.target as Element).closest('.sheet-wrap, .scrolls')) e.preventDefault();
    };
    tableEl?.addEventListener('touchmove', claim, { passive: false });
    addEventListener('keydown', keys);
    return () => {
      ro.disconnect();
      tableEl?.removeEventListener('touchmove', claim);
      removeEventListener('keydown', keys);
      clearTimeout(flashTimer);
    };
  });

  // ---- flights ------------------------------------------------------------------------------

  let flights: Flight[] = $state([]);
  let flightKey = 0;

  /** A rectangle in the stage's own (unscaled) coordinates. */
  function rectIn(el: Element): Rect {
    // The table may be gone already (the game ended while a plate was in the air).
    if (!stageEl) return { x: 0, y: 0, w: 0, h: 0 };
    const a = stageEl.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { x: (b.left - a.left) / k, y: (b.top - a.top) / k, w: b.width / k, h: b.height / k };
  }

  /** A plate's shape at the foot of a box (a discard pile's column, the hand, a name): where its top plate lies. */
  function plateIn(el: Element | null): Rect | null {
    if (!el) return null;
    const r = rectIn(el);
    const ratio = 1.4;
    if (r.h >= r.w * 1.2 && r.h <= r.w * 1.6) return r;
    const w = Math.min(r.w, r.h / ratio);
    const h = w * ratio;
    return { x: r.x + (r.w - w) / 2, y: r.y + r.h - h, w, h };
  }

  async function launch(card: CardId, as: number, from: Rect | null, toEl: Element | Rect | null, ms = 300): Promise<void> {
    if (!from || !toEl || !stageEl || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The table shows the move first (a new top on a pile): measure where it lands once it has.
    await tick();
    if (!stageEl || (toEl instanceof Element && !toEl.isConnected)) return;
    const to = toEl instanceof Element ? plateIn(toEl) : toEl;
    if (!to || !to.w) return;
    return new Promise((resolve) => {
      const key = ++flightKey;
      flights = [...flights, { key, card, as, from, to, ms, done: () => {
        flights = flights.filter((f) => f.key !== key);
        resolve();
      } }];
    });
  }

  function flyTo(node: HTMLElement, f: Flight) {
    const dx = f.to.x - f.from.x;
    const dy = f.to.y - f.from.y;
    const sx = f.to.w / f.from.w;
    const sy = f.to.h / f.from.h;
    const a = node.animate(
      [
        { transform: 'translate(0, 0) scale(1, 1) rotate(0deg)' },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 24}px) scale(${1 + (sx - 1) * 0.6}, ${1 + (sy - 1) * 0.6}) rotate(-4deg)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(0deg)` },
      ],
      { duration: f.ms, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' },
    );
    a.onfinish = () => f.done();
    a.oncancel = () => f.done();
    return { destroy: () => a.cancel() };
  }

  const pileEl = (i: number) => stageEl?.querySelector(`[data-pile="${i}"]`) ?? null;
  const fanEl = (seat: number, slot: number) =>
    stageEl?.querySelector(seat === me ? `[data-slot="${slot}"]` : `[data-opp="${seat}"] [data-ofan="${slot}"]`) ?? null;
  /** Where a played plate starts from, as a plate's shape: the seat's stock, discard pile or hand. */
  function sourceRect(seat: number, from: string, slot?: number): Rect | null {
    if (!stageEl) return null;
    if (seat === me) {
      if (from === 'stock') return plateIn(stageEl.querySelector('[data-mystock]'));
      if (from === 'discard') return plateIn(fanEl(seat, slot ?? 0));
      const hand = stageEl.querySelector('.hand .plate-btn');
      return hand ? plateIn(hand) : plateIn(stageEl.querySelector('.hand'));
    }
    const opp = stageEl.querySelector(`[data-opp="${seat}"]`);
    if (!opp) return null;
    // A hand card comes from the seat's side of the table: its stock's place, the closest plate there.
    if (from === 'discard') return plateIn(opp.querySelector(`[data-ofan="${slot}"]`));
    return plateIn(opp.querySelector('.otop'));
  }

  // ---- your moves ---------------------------------------------------------------------------

  /** Your plays this page has flown already: their events from the server don't fly again. */
  const flown = new Set<string>();
  let flashTimer = 0;
  function flash(text: string) {
    error = text;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (error = ''), 3200);
  }

  const lastN = () => match.events.at(-1)?.n ?? 0;

  function send(move: Move, at: Element | null) {
    const entry = { move, after: lastN() };
    pending = [...pending, entry];
    driver.move(move, at).catch((e) => {
      pending = pending.filter((p) => p !== entry);
      flash(errorText(e instanceof ApiError ? e.code : 'other'));
    });
  }

  // The server's answer to a move of yours: shown from its state now, no longer laid over it.
  $effect(() => {
    const events = match.events;
    const list = untrack(() => pending);
    if (!list.length) return;
    const left = list.filter((p) => !events.some((e) => e.n > p.after && answers(e, p.move, me)));
    if (left.length !== list.length) pending = left;
  });

  async function playPick(p: Pick, pile: number, from: Rect | null = null) {
    // The others' last plays land first: what you see is what you play onto.
    if (batches) await queue;
    if (!myTurn || !fits(pileShown(pile).n, p.card)) return;
    const el = pileEl(pile);
    const src = from ?? (srcElOf(p) ? rectIn(srcElOf(p)!) : null);
    const before = { ...pileShown(pile) };
    const as = isJoker(p.card) ? before.n + 1 : 0;
    held = { ...held, [pile]: before };
    flown.add(`${p.card}:${pile}`);
    pick = null;
    confirm = null;
    send(playOf(p, pile, me), el);
    await launch(p.card, as, src, el, from ? 200 : 280);
    if (before.n + 1 >= 12) {
      held = { ...held, [pile]: { n: 12, top: p.card } };
      play.clink();
      await new Promise((r) => setTimeout(r, 520));
      play.cleared();
    } else if (p.from === 'stock' && p.owner === me) play.stock();
    else play.clink();
    const { [pile]: _, ...rest } = held;
    held = rest;
  }

  async function discard(slot: number) {
    const p = pick;
    if (!myTurn || !p || p.from !== 'hand') return;
    const el = fanEl(me, slot);
    const src = srcElOf(p);
    const from = src ? rectIn(src) : null;
    pick = null;
    confirm = null;
    landing = { ...landing, [`${me}:${slot}`]: true };
    send({ type: 'discard', card: p.card, slot }, el);
    await launch(p.card, 0, from, el, 260);
    play.lay();
    const { [`${me}:${slot}`]: _, ...rest } = landing;
    landing = rest;
  }

  function endTurn(e: Event) {
    if (!myTurn || s.hand.length) return;
    send({ type: 'end' }, e.currentTarget as Element);
  }

  function srcElOf(p: Pick): Element | null {
    if (!stageEl) return null;
    if (p.from === 'hand') return stageEl.querySelector(`[data-card="${p.card}"]`);
    if (p.owner === me) return p.from === 'stock' ? stageEl.querySelector('[data-mystock]') : stageEl.querySelector(`[data-slot="${p.i}"] .top`);
    return stageEl.querySelector(p.from === 'stock' ? `[data-opp="${p.owner}"] .otop` : `[data-opp="${p.owner}"] [data-ofan="${p.i}"] .top`);
  }

  /** A plate tapped: lifted, or dropped again when it already was. */
  function choose(next: Pick) {
    if (!myTurn) {
      if (me >= 0 && !over) flash(t('notYourTurn'));
      return;
    }
    confirm = null;
    pick = pick && pick.from === next.from && pick.owner === next.owner && pick.card === next.card ? null : next;
  }

  function tapPile(i: number) {
    if (!pick) return;
    if (fits(pileShown(i).n, pick.card)) void playPick(pick, i);
  }

  function tapFan(slot: number) {
    if (!myTurn) return;
    if (pick?.from === 'hand') {
      if (confirm?.slot === slot) return void discard(slot);
      confirm = { slot };
      return;
    }
    const top = s.seats[me].discards[slot].at(-1);
    if (top !== undefined) choose({ from: 'discard', i: slot, owner: me, card: top });
  }

  /** A tap on the table's empty parts drops what you lifted. */
  function tapAway(e: MouseEvent) {
    if (!(e.target as Element).closest('button, .plate-btn, [data-pile], [data-slot], .endb')) {
      pick = null;
      confirm = null;
    }
  }

  // ---- dragging -----------------------------------------------------------------------------

  let drag: { card: CardId; from: Rect; dx: number; dy: number; tilt: number } | null = $state(null);
  let dragging: { id: number; x0: number; y0: number; on: boolean; pick: Pick; el: Element } | null = null;
  let suppress = false;

  function down(e: PointerEvent, p: Pick) {
    if (!myTurn || e.button > 0) return;
    dragging = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, pick: p, el: e.currentTarget as Element };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  function move(e: PointerEvent) {
    const d = dragging;
    if (!d || e.pointerId !== d.id) return;
    const dx = (e.clientX - d.x0) / k;
    const dy = (e.clientY - d.y0) / k;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return;
      d.on = true;
      pick = d.pick;
      confirm = null;
      drag = { card: d.pick.card, from: rectIn(d.el), dx, dy, tilt: 0 };
    }
    drag = { ...drag!, dx, dy, tilt: Math.max(-6, Math.min(6, dx / 30)) };
  }

  function up(e: PointerEvent) {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    const d = dragging;
    dragging = null;
    if (!d || !d.on || !drag) return;
    suppress = true;
    setTimeout(() => (suppress = false), 0);
    const g = drag;
    drag = null;
    const at = { x: g.from.x + g.dx, y: g.from.y + g.dy, w: g.from.w, h: g.from.h };
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const pile = target?.closest('[data-pile]');
    const fan = target?.closest('[data-slot]');
    if (pile && stageEl?.contains(pile)) {
      const i = Number(pile.getAttribute('data-pile'));
      if (fits(pileShown(i).n, d.pick.card)) return void playPick(d.pick, i, at);
    }
    if (fan && stageEl?.contains(fan) && d.pick.from === 'hand') {
      pick = d.pick;
      confirm = { slot: Number(fan.getAttribute('data-slot')) };
      return;
    }
    // Nowhere it can go: it springs back, still lifted.
    void launch(d.pick.card, 0, at, d.el, 160);
  }

  function clicked(e: MouseEvent, p: Pick) {
    e.stopPropagation();
    if (suppress) return;
    if (pick?.from === 'hand' && p.from === 'discard' && p.owner === me) return tapFan(p.i);
    choose(p);
  }

  // ---- keys on a computer -------------------------------------------------------------------

  function keys(e: KeyboardEvent) {
    if (!myTurn || e.metaKey || e.ctrlKey || e.altKey || (e.target as Element)?.closest?.('input, textarea, [contenteditable]')) return;
    const key = e.key.toLowerCase();
    const n = Number(key);
    if (n >= 1 && n <= 5) {
      const card = slots[n - 1];
      if (card !== null && card !== undefined) choose({ from: 'hand', i: s.hand.indexOf(card), owner: me, card });
    } else if (key === ' ') {
      e.preventDefault();
      const top = s.seats[me].stockTop;
      if (top !== null) choose({ from: 'stock', i: -1, owner: me, card: top });
    } else if ('qwer'.includes(key) && key.length === 1) {
      tapFan('qwer'.indexOf(key));
    } else if ('asdf'.includes(key) && key.length === 1) {
      tapPile('asdf'.indexOf(key));
    } else if (key === 'enter' && confirm) {
      void discard(confirm.slot);
    } else if (key === 'escape') {
      pick = null;
      confirm = null;
    } else return;
    e.preventDefault();
  }

  // ---- the others' moves, flown one after another ----------------------------------------------

  let matchId = '';
  let seen = 0;
  let prevBuild: { n: number; top: CardId | null }[] = [];
  let queue: Promise<void> = Promise.resolve();
  /** Batches of the others' moves still being flown. */
  let batches = 0;

  $effect(() => {
    const m = match;
    const events = m.events;
    if (m.id !== matchId) {
      matchId = m.id;
      seen = events.at(-1)?.n ?? 0;
      prevBuild = m.state.build.map((p) => ({ ...p }));
      lagBuild = null;
      held = {};
      landing = {};
      return;
    }
    const fresh = events.filter((e) => e.n > seen);
    const before = prevBuild;
    prevBuild = m.state.build.map((p) => ({ ...p }));
    if (!fresh.length) return;
    // Events missed (a reload, a phone woken up, more than the view keeps): show the table as it is.
    const missed = fresh[0].n > seen + 1 || fresh.length > 12;
    seen = fresh.at(-1)!.n;
    if (missed) return;
    if (!lagBuild) lagBuild = before.map((p) => ({ ...p }));
    for (const e of fresh) {
      if (e.type === 'discard' && e.seat !== me) landing = { ...landing, [`${e.seat}:${e.slot}`]: true };
    }
    batches++;
    const id = m.id;
    queue = queue.then(() => replay(fresh, id)).finally(() => {
      batches--;
      if (!batches) lagBuild = null;
    });
  });

  /** One pile moved on by a landed plate (or cleared). */
  function lag(pile: number, to: { n: number; top: CardId | null }) {
    if (!lagBuild) return;
    lagBuild = lagBuild.map((p, i) => (i === pile ? to : p));
  }

  async function replay(events: TableEvent[], id: string) {
    for (const e of events) {
      if (id !== matchId) return;
      if (e.type === 'play') {
        const pile = e.pile as number;
        const card = e.card as CardId;
        if (flown.delete(`${card}:${pile}`)) {
          lag(pile, { n: e.as as number, top: card });
          continue;
        }
        const from = sourceRect(e.seat as number, e.from as string, e.slot as number | undefined);
        await launch(card, isJoker(card) ? (e.as as number) : 0, from, pileEl(pile), 330);
        lag(pile, { n: e.as as number, top: card });
        if (e.from === 'stock') play.stock();
        else play.clink();
        await new Promise((r) => setTimeout(r, 90));
      } else if (e.type === 'cleared') {
        const pile = e.pile as number;
        await new Promise((r) => setTimeout(r, 420));
        lag(pile, { n: 0, top: null });
        play.cleared();
      } else if (e.type === 'discard' && e.seat !== me) {
        const seat = e.seat as number;
        const slot = e.slot as number;
        await launch(e.card as CardId, 0, sourceRect(seat, 'hand'), fanEl(seat, slot), 300);
        const { [`${seat}:${slot}`]: _, ...rest } = landing;
        landing = rest;
        play.lay();
      } else if (e.type === 'turn' && e.seat === me && !over) {
        play.yourTurn();
      } else if (e.type === 'round') {
        const r = e as unknown as { winner: number | null; team: number[] | null };
        if (r.winner !== null && (r.winner === me || r.team?.includes(me))) play.fanfare();
      }
    }
  }

  // ---- drawing helpers ----------------------------------------------------------------------

  const fanTop = (seat: number, slot: number) => s.seats[seat]?.discards[slot]?.at(-1);
  const fanOf = (seat: number, slot: number, max: number) => s.seats[seat]?.discards[slot]?.slice(-max) ?? [];
  const canPickOwner = (owner: number) => myTurn && (owner === me || owner === partner);
  const label = (card: CardId) => (isJoker(card) ? t('joker') : String(value(card)));
  const teamNames = $derived(
    s.teams && me >= 0 ? names(s.teams.find((t) => t.includes(me))?.map((seat) => (seat === me ? t('you') : name(seat))) ?? []) : '',
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="table" bind:this={tableEl} onclick={tapAway}>
  <div class="sizer" style="width:{base.w * k}px;height:{stageH * k}px">
  <div
    class="stage {layout}"
    class:compact
    class:mine-turn={myTurn}
    bind:this={stageEl}
    style="width:{base.w}px;height:{stageH}px;transform:scale({k});--k:{k}"
  >
    <header class="band">
      <span class="mark">Skib<b>b</b>o</span>
      <span class="meta">
        {t('roundOf', { round: s.round })}{#if s.rules.target}<span class="dot">·</span>{t('toFive')}{/if}{#if layout !== 'phone' && teamNames}<span class="dot">·</span>{teamNames}{/if}
      </span>
      <span class="end">
        {#if match.endsAt && !over && s.phase === 'play'}<Clock left={driver.left} endsAt={match.endsAt} tick={myTurn} />{/if}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <ewo-settings-button onclick={onsettings}></ewo-settings-button>
      </span>
    </header>

    <section class="opps" aria-label={t('table')} style="--cols:{Math.min(3, Math.max(1, others.length))}">
      {#each others as seat (seat)}
        {@const st = s.seats[seat]}
        {@const p = match.people[seat]}
        <div class="opp" class:turn={s.turn === seat && s.phase === 'play'} class:partner={seat === partner} data-opp={seat}>
          <div class="who">
            {#if layout !== 'phone'}<Avatar avatar={p?.avatar} size={26} />{/if}
            <b>{p?.name ?? '?'}</b>
            {#if seat === partner}<em class="tag">{t('partner')}</em>{:else if seat === nextSeat && me >= 0 && layout !== 'phone'}<em class="tag">{t('next')}</em>{/if}
            <span class="left">{t('left', { n: st.stock })}</span>
          </div>
          {#if canPickOwner(seat) && st.stockTop !== null}
            <button
              class="otop plate-btn"
              class:sel={pick?.from === 'stock' && pick.owner === seat}
              aria-label={t('plateFrom', { card: label(st.stockTop), where: t('stockOf', { name: p?.name ?? '' }) })}
              onpointerdown={(e) => down(e, { from: 'stock', i: -1, owner: seat, card: st.stockTop! })}
              onclick={(e) => clicked(e, { from: 'stock', i: -1, owner: seat, card: st.stockTop! })}
            >
              {#if st.stock > 1}<span class="back b1"><Plate back /></span>{/if}
              <Plate id={st.stockTop} mini={layout === 'phone'} />
            </button>
          {:else}
            <div class="otop" aria-label={st.stockTop !== null ? t('plateFrom', { card: label(st.stockTop), where: t('stockOf', { name: p?.name ?? '' }) }) : t('stockEmpty')}>
              {#if st.stock > 1}<span class="back b1"><Plate back /></span>{/if}
              {#if st.stockTop !== null}<Plate id={st.stockTop} mini={layout === 'phone'} />{:else if st.stock > 0}<Plate back />{/if}
            </div>
          {/if}
          <div class="odiscs">
            {#each [0, 1, 2, 3] as slot (slot)}
              {@const cards = fanOf(seat, slot, base.ofan.max)}
              {@const top = fanTop(seat, slot)}
              <div class="ofan" data-ofan={slot}>
                {#each cards as card, idx (`${card}:${idx}`)}
                  {@const isTop = idx === cards.length - 1}
                  {#if isTop && canPickOwner(seat)}
                    <button
                      class="top plate-btn"
                      class:sel={pick?.from === 'discard' && pick.owner === seat && pick.i === slot}
                      class:hidden={landing[`${seat}:${slot}`]}
                      style="top:{layout === 'phone' ? 0 : (cards.length - 1 - idx) * -base.ofan.step + (base.ofan.max - 1) * base.ofan.step}px"
                      aria-label={t('plateFrom', { card: label(card), where: t('discardN', { n: slot + 1 }) })}
                      onpointerdown={(e) => down(e, { from: 'discard', i: slot, owner: seat, card: top! })}
                      onclick={(e) => clicked(e, { from: 'discard', i: slot, owner: seat, card: top! })}><Plate id={card} mini /></button
                    >
                  {:else}
                    <span
                      class="under"
                      class:top={isTop}
                      class:hidden={isTop && landing[`${seat}:${slot}`]}
                      style="top:{layout === 'phone' ? 0 : idx * base.ofan.step + (base.ofan.max - cards.length) * base.ofan.step}px"><Plate id={card} mini /></span
                    >
                  {/if}
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </section>

    <section class="street">
      {#if layout !== 'phone'}
        <div class="side">
          <div class="drawpile" aria-label="{t('drawPile')}: {s.draw}">
            {#if s.draw > 0}<span class="back b2"><Plate back /></span><span class="back b1"><Plate back /></span><Plate back />{/if}
            <span class="cap">{t('drawPile')} · {s.draw}</span>
          </div>
          {#if layout === 'port'}
            <div class="cleared small"><b>{s.done / 12}</b><span class="cap">{t('cleared')}</span></div>
          {/if}
        </div>
      {/if}
      <div class="build">
        {#each s.build as _, i (i)}
          {@const shown = pileShown(i)}
          {@const ok = prefs.hint && pick !== null && fits(shown.n, pick.card)}
          <button
            class="pile"
            class:ok
            class:target={pick !== null}
            data-pile={i}
            aria-label="{t('pileN', { n: i + 1 })}: {shown.n}"
            onclick={(e) => {
              e.stopPropagation();
              tapPile(i);
            }}
          >
            {#if shown.top !== null}
              <Plate id={shown.top} as={shown.n} />
            {:else}
              <span class="empty">1</span>
            {/if}
            <i class="screw t"></i><i class="screw b"></i>
            {#if layout !== 'phone'}
              <span class="pips" aria-hidden="true">{#each Array(12) as _, n (n)}<i class:f={n < shown.n} class:g={n >= 4} class:h={n >= 8}></i>{/each}</span>
            {/if}
          </button>
        {/each}
      </div>
      {#if layout === 'land'}
        <div class="side">
          <div class="cleared"><b>{s.done / 12}</b><span class="cap">{t('cleared')}</span></div>
        </div>
      {/if}
    </section>

    <div class="status" class:error={Boolean(error)} role="status">
      {#if error}{error}{:else}{hint}{/if}
      {#if myTurn && !s.hand.length}
        <button class="btn primary small endturn" type="button" onclick={endTurn}>{t('endTurn')}</button>
      {/if}
    </div>

    {#if me >= 0}
      {@const mine = s.seats[me]}
      <section class="mine" aria-label={t('yourDiscards')}>
        <div class="stock">
          {#if mine.stock > 1}<span class="back b2"><Plate back /></span><span class="back b1"><Plate back /></span>{/if}
          {#if mine.stockTop !== null}
            <button
              class="plate-btn"
              class:sel={pick?.from === 'stock' && pick.owner === me}
              class:glow={stockFits && !pick && prefs.hint}
              data-mystock
              aria-label={t('plateFrom', { card: label(mine.stockTop), where: t('yourStock') })}
              onpointerdown={(e) => down(e, { from: 'stock', i: -1, owner: me, card: mine.stockTop! })}
              onclick={(e) => clicked(e, { from: 'stock', i: -1, owner: me, card: mine.stockTop! })}><Plate id={mine.stockTop} /></button
            >
          {:else if mine.stock > 0}
            <span data-mystock><Plate back /></span>
          {:else}
            <span class="empty-stock" data-mystock>{t('stockEmpty')}</span>
          {/if}
          <span class="cap">{t('stock')} · {mine.stock}</span>
        </div>
        <div class="discards">
          {#each [0, 1, 2, 3] as slot (slot)}
            {@const cards = fanOf(me, slot, base.fan.max)}
            {@const extra = (mine.discards[slot]?.length ?? 0) - cards.length}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="fan"
              class:okd={pick?.from === 'hand' && myTurn}
              class:asked={confirm?.slot === slot}
              data-slot={slot}
              onclick={(e) => {
                e.stopPropagation();
                tapFan(slot);
              }}
            >
              {#each cards as card, idx (`${card}:${idx}`)}
                {@const isTop = idx === cards.length - 1}
                {@const y = base.fan.ph * 0 + (layout === 'phone' ? 140 : layout === 'land' ? 216 : 258) - base.fan.ph - (cards.length - 1 - idx) * base.fan.step}
                {#if isTop}
                  <button
                    class="top plate-btn"
                    class:sel={pick?.from === 'discard' && pick.owner === me && pick.i === slot}
                    class:hidden={landing[`${me}:${slot}`]}
                    style="top:{y}px"
                    aria-label={t('plateFrom', { card: label(card), where: t('discardN', { n: slot + 1 }) })}
                    onpointerdown={(e) => down(e, { from: 'discard', i: slot, owner: me, card })}
                    onclick={(e) => clicked(e, { from: 'discard', i: slot, owner: me, card })}><Plate id={card} /></button
                  >
                {:else}
                  <span class="under" style="top:{y}px"><Plate id={card} /></span>
                {/if}
              {/each}
              {#if extra > 0}<span class="more">+{extra}</span>{/if}
              {#if confirm?.slot === slot}
                <button
                  class="endb"
                  type="button"
                  onclick={(e) => {
                    e.stopPropagation();
                    void discard(slot);
                  }}>{t('layHere')}</button
                >
              {/if}
            </div>
          {/each}
        </div>
        {#if layout === 'land'}
          {@render hand()}
        {/if}
      </section>
      {#if layout !== 'land'}
        {@render hand()}
      {/if}
    {:else}
      <p class="watching">{t('hintWatching')}</p>
    {/if}

    {#if layout === 'phone'}
      <footer class="foot"><span>{t('drawPile')} · {s.draw}</span><span>{t('cleared')} · {s.done / 12}</span></footer>
    {/if}

    <div class="flights" aria-hidden="true">
      {#each flights as f (f.key)}
        <div class="flight" style="left:{f.from.x}px;top:{f.from.y}px;--pw:{f.from.w}px;--ph:{f.from.h}px" use:flyTo={f}>
          <Plate id={f.card} as={f.as} />
        </div>
      {/each}
      {#if drag}
        <div
          class="flight dragged"
          style="left:{drag.from.x}px;top:{drag.from.y}px;--pw:{drag.from.w}px;--ph:{drag.from.h}px;transform:translate({drag.dx}px, {drag.dy}px) rotate({drag.tilt}deg)"
        >
          <Plate id={drag.card} />
        </div>
      {/if}
    </div>

    {#if s.phase === 'roundEnd' && s.result}
      <RoundEnd {match} game={s} left={driver.left} />
    {/if}
  </div>
  </div>
</div>

{#snippet hand()}
  <section class="hand" aria-label={t('yourHand')}>
    {#each slots as card, i (card ?? `gap${i}`)}
      {#if card !== null}
        <button
          class="plate-btn"
          class:sel={pick?.from === 'hand' && pick.card === card}
          class:dim={myTurn && !fitsAnywhere(card) && pick?.card !== card && prefs.hint && false}
          class:away={drag?.card === card}
          data-card={card}
          aria-label="{t('plateLabel', { card: label(card) })}, {t('yourHand')}"
          onpointerdown={(e) => down(e, { from: 'hand', i: s.hand.indexOf(card), owner: me, card })}
          onclick={(e) => clicked(e, { from: 'hand', i: s.hand.indexOf(card), owner: me, card })}><Plate id={card} /></button
        >
      {:else}
        <span class="gap"></span>
      {/if}
    {/each}
  </section>
{/snippet}

<style>
  /* ---- the frame: the stage, drawn at one size and scaled to the window ---------------------- */
  .table {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    overflow: hidden;
    overscroll-behavior: none;
    touch-action: none;
    /* The safe area above the band is the band's navy (iOS 26+ blurs an edge without a solid bar). */
    background: linear-gradient(var(--navy) 0 env(safe-area-inset-top, 0px), transparent env(safe-area-inset-top, 0px));
    -webkit-user-select: none;
    user-select: none;
  }
  /* The scaled stage's room in the window; the stage inside is drawn at its own size. */
  .sizer {
    position: relative;
    flex: none;
  }
  .stage {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    display: flex;
    flex-direction: column;
  }

  /* ---- the band: the street sign ------------------------------------------------------------ */
  .band {
    flex: none;
    height: 56px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 0 22px;
    background: linear-gradient(135deg, rgb(255 255 255 / 0.1) 0 20%, rgb(255 255 255 / 0) 45%), var(--navy);
    box-shadow: inset 0 0 0 3px var(--navy), inset 0 0 0 4.5px rgb(255 255 255 / 0.9);
    color: #ffffff;
    border-radius: 0 0 14px 14px;
    --ewo-fg: #ffffff;
    --ewo-fg-2: #ffffff;
    --ewo-fill-2: rgb(255 255 255 / 0.14);
  }
  .phone .band {
    height: 50px;
    padding: 0 14px;
    border-radius: 0;
  }
  .mark {
    font: 700 28px/1 var(--face);
    letter-spacing: 0.01em;
  }
  .phone .mark {
    font-size: 24px;
  }
  .mark b {
    color: #ffb8f1;
  }
  .meta {
    justify-self: center;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.92;
  }
  .phone .meta {
    font-size: 14px;
  }
  .dot {
    margin: 0 0.45em;
    opacity: 0.6;
  }
  .end {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* ---- the others ---------------------------------------------------------------------------- */
  .opps {
    flex: none;
    display: flex;
    justify-content: center;
    gap: 16px;
    padding: 18px 26px 0;
  }
  .port .opps {
    flex-wrap: wrap;
    gap: 10px;
    padding: 16px 20px 0;
  }
  .phone .opps {
    display: grid;
    grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
    gap: 6px;
    padding: 8px 10px 0;
  }
  .opp {
    position: relative;
    flex: 1 1 0;
    max-width: 380px;
    display: grid;
    grid-template-columns: auto auto;
    justify-content: start;
    column-gap: 16px;
    row-gap: 10px;
    padding: 12px 16px 14px;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.55);
    box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
    transition: box-shadow 0.2s ease;
  }
  .compact .opp {
    column-gap: 10px;
    padding: 10px 12px 12px;
  }
  .port .opp {
    flex-basis: 230px;
    column-gap: 12px;
    padding: 10px 12px 12px;
  }
  .phone .opp {
    max-width: none;
    grid-template-columns: auto minmax(0, 1fr);
    column-gap: 6px;
    row-gap: 4px;
    padding: 6px 7px;
    border-radius: 10px;
  }
  .opp.turn {
    box-shadow: inset 0 0 0 2.5px var(--fuchsia), 0 4px 14px -6px rgb(159 34 148 / 0.5);
  }
  .opp.partner {
    background: rgb(255 255 255 / 0.78);
  }
  .who {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 17px;
    line-height: 1;
    white-space: nowrap;
  }
  .phone .who {
    font-size: 12.5px;
    gap: 4px;
  }
  .who b {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    font-style: normal;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fuchsia);
  }
  .who .left {
    margin-left: auto;
    padding-left: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-2);
  }
  .otop {
    position: relative;
    width: 64px;
    height: 90px;
    align-self: end;
    padding: 0;
    border: 0;
    background: none;
    --pw: 64px;
    --ph: 90px;
  }
  .compact .otop,
  .port .otop {
    width: 54px;
    height: 76px;
    --pw: 54px;
    --ph: 76px;
  }
  .phone .otop {
    width: 34px;
    height: 48px;
    --pw: 34px;
    --ph: 48px;
  }
  .otop :global(.plate),
  .ofan :global(.plate) {
    position: absolute;
    left: 0;
    top: 0;
  }
  .back {
    position: absolute;
    left: 0;
    top: 0;
  }
  .back.b1 {
    transform: translate(3px, 3px);
  }
  .back.b2 {
    transform: translate(6px, 6px);
  }
  .otop .back.b1 {
    transform: translate(2px, 2px);
  }
  .odiscs {
    display: grid;
    grid-template-columns: repeat(4, 44px);
    gap: 8px;
    align-self: end;
  }
  .compact .odiscs,
  .port .odiscs {
    grid-template-columns: repeat(4, 36px);
    gap: 6px;
  }
  .phone .odiscs {
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }
  .ofan {
    position: relative;
    height: 88px;
    border-radius: 6px;
    background: rgb(42 38 34 / 0.05);
    --pw: 44px;
    --ph: 62px;
  }
  .compact .ofan,
  .port .ofan {
    height: 72px;
    --pw: 36px;
    --ph: 50px;
  }
  .phone .ofan {
    height: 26px;
    --pw: 100%;
    --ph: 26px;
  }
  .ofan > .under,
  .ofan > .top {
    position: absolute;
    left: 0;
    width: var(--pw);
    height: var(--ph);
    padding: 0;
    border: 0;
    background: none;
  }

  /* ---- the street ---------------------------------------------------------------------------- */
  .street {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 44px;
    height: 272px;
    padding-top: 6px;
  }
  .port .street {
    gap: 22px;
    height: 300px;
  }
  /* On a phone the piles take the room the screen has to spare. */
  .phone .street {
    flex: 1 1 auto;
    height: auto;
    min-height: 140px;
    padding-top: 6px;
  }
  .build {
    display: flex;
    gap: 24px;
  }
  .port .build {
    gap: 16px;
  }
  .phone .build {
    gap: 12px;
  }
  .pile {
    position: relative;
    width: 136px;
    height: 190px;
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: none;
    --pw: 136px;
    --ph: 190px;
    -webkit-tap-highlight-color: transparent;
  }
  .port .pile {
    width: 146px;
    height: 204px;
    --pw: 146px;
    --ph: 204px;
  }
  .phone .pile {
    width: 84px;
    height: 118px;
    border-radius: 9px;
    --pw: 84px;
    --ph: 118px;
  }
  .pile .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border: 1.5px dashed rgb(42 38 34 / 0.28);
    border-radius: inherit;
    font: 700 calc(var(--ph) * 0.34) / 1 var(--face);
    color: rgb(42 38 34 / 0.16);
  }
  .pile.ok::after,
  .fan.okd::after {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 15px;
    box-shadow: 0 0 0 2.5px var(--fuchsia), 0 0 22px rgb(159 34 148 / 0.28);
    pointer-events: none;
    z-index: 9;
  }
  .screw {
    position: absolute;
    left: 50%;
    width: 9px;
    height: 9px;
    margin-left: -4.5px;
    border-radius: 50%;
    z-index: 3;
    background: radial-gradient(circle at 35% 35%, #f4f1ea, #9b958b 70%);
    box-shadow: 0 1px 1px rgb(0 0 0 / 0.3);
    pointer-events: none;
  }
  .screw::after {
    content: '';
    position: absolute;
    left: 1px;
    right: 1px;
    top: 4px;
    height: 1px;
    background: #6b655c;
    transform: rotate(30deg);
  }
  .screw.t {
    top: 9px;
  }
  .screw.b {
    bottom: 9px;
  }
  .screw.b::after {
    transform: rotate(-50deg);
  }
  .phone .screw {
    width: 7px;
    height: 7px;
    margin-left: -3.5px;
  }
  .phone .screw.t {
    top: 6px;
  }
  .phone .screw.b {
    bottom: 6px;
  }
  .pips {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -24px;
    display: flex;
    justify-content: center;
    gap: 4px;
  }
  .pips i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgb(29 47 94 / 0.16);
  }
  .pips i.f {
    background: var(--enzian);
  }
  .pips i.f.g {
    background: var(--fir);
  }
  .pips i.f.h {
    background: var(--fuchsia);
  }
  .side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 34px;
  }
  .drawpile,
  .cleared {
    position: relative;
    width: 92px;
    height: 128px;
    --pw: 92px;
    --ph: 128px;
  }
  .port .drawpile {
    width: 80px;
    height: 112px;
    --pw: 80px;
    --ph: 112px;
  }
  .drawpile :global(.plate) {
    position: absolute;
    left: 0;
    top: 0;
  }
  .cap {
    position: absolute;
    left: -24px;
    right: -24px;
    bottom: -24px;
    text-align: center;
    font-size: 14px;
    line-height: 1;
    white-space: nowrap;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .cleared {
    display: grid;
    place-items: center;
    border-radius: 10px;
    border: 1.5px dashed rgb(42 38 34 / 0.22);
  }
  .cleared.small {
    height: 64px;
  }
  .cleared b {
    font-size: 44px;
    font-weight: 700;
    color: rgb(42 38 34 / 0.4);
    font-variant-numeric: tabular-nums;
  }
  .cleared.small b {
    font-size: 28px;
  }

  /* ---- the status line ------------------------------------------------------------------------ */
  .status {
    flex: none;
    height: 46px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 0 20px;
    font-size: 18px;
    font-weight: 600;
    color: var(--navy);
    text-align: center;
    line-height: 1.15;
  }
  .phone .status {
    height: 34px;
    font-size: 14px;
    padding: 0 12px;
  }
  .status.error {
    color: var(--bad);
  }
  .endturn {
    min-height: 34px;
  }

  /* ---- yours ----------------------------------------------------------------------------------- */
  .mine {
    flex: none;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    gap: 22px;
    padding: 0 24px;
  }
  .land .mine {
    flex: 1;
    padding-bottom: 28px;
  }
  .port .mine {
    gap: 26px;
    padding: 0 20px;
  }
  .phone .mine {
    gap: 12px;
    padding: 0 12px;
  }
  .stock {
    position: relative;
    flex: none;
    width: 124px;
    height: 174px;
    margin-bottom: 26px;
    --pw: 124px;
    --ph: 174px;
  }
  .port .stock {
    width: 140px;
    height: 196px;
    --pw: 140px;
    --ph: 196px;
  }
  .phone .stock {
    width: 76px;
    height: 106px;
    margin-bottom: 20px;
    --pw: 76px;
    --ph: 106px;
  }
  .stock > .plate-btn,
  .stock > [data-mystock] {
    position: absolute;
    left: 0;
    top: 0;
  }
  .empty-stock {
    width: var(--pw);
    height: var(--ph);
    display: grid;
    place-items: center;
    text-align: center;
    border: 1.5px dashed rgb(42 38 34 / 0.3);
    border-radius: 10px;
    font-size: 14px;
    color: var(--ink-2);
  }
  .stock .cap {
    bottom: -24px;
  }
  .phone .stock .cap {
    font-size: 12px;
    bottom: -18px;
  }
  .discards {
    flex: none;
    display: grid;
    grid-template-columns: repeat(4, 98px);
    gap: 10px;
  }
  .port .discards {
    grid-template-columns: repeat(4, 124px);
    gap: 12px;
  }
  .phone .discards {
    flex: 1;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .fan {
    position: relative;
    height: 216px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.35);
    box-shadow: inset 0 0 0 1px rgb(42 38 34 / 0.08);
    --pw: 100%;
    --ph: 138px;
  }
  .port .fan {
    height: 258px;
    --ph: 174px;
  }
  .phone .fan {
    height: 140px;
    border-radius: 8px;
    --ph: 88px;
  }
  .fan > .under,
  .fan > .top {
    position: absolute;
    left: 0;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
  }
  .more {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-2);
  }
  .hand {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    --pw: 98px;
    --ph: 138px;
  }
  .port .hand {
    justify-content: center;
    gap: 12px;
    padding: 34px 0 44px;
    --pw: 132px;
    --ph: 184px;
  }
  .phone .hand {
    justify-content: center;
    gap: 8px;
    padding: 18px 0 10px;
    --pw: 62px;
    --ph: 88px;
  }
  .gap {
    width: var(--pw);
    height: var(--ph);
  }
  .watching {
    margin: auto;
    padding-bottom: 40px;
    font-size: 18px;
    color: var(--ink-2);
  }
  .foot {
    flex: none;
    display: flex;
    justify-content: space-between;
    padding: 0 16px 10px;
    font-size: 12.5px;
    color: var(--ink-2);
  }

  /* ---- plates you can lift -------------------------------------------------------------------- */
  .plate-btn {
    position: relative;
    display: block;
    padding: 0;
    border: 0;
    background: none;
    border-radius: calc(var(--ph) * 0.085);
    transition: transform 0.16s ease, box-shadow 0.16s ease;
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
  }
  .mine-turn .plate-btn {
    cursor: grab;
  }
  .plate-btn.sel {
    transform: translateY(-16px);
    box-shadow: 0 0 0 3px var(--fuchsia), 0 14px 20px -6px rgb(60 40 20 / 0.45);
  }
  .phone .plate-btn.sel {
    transform: translateY(-10px);
  }
  .plate-btn.glow {
    box-shadow: 0 0 0 3px rgb(159 34 148 / 0.55), 0 0 18px rgb(159 34 148 / 0.35);
  }
  .plate-btn.away,
  .hidden {
    visibility: hidden;
  }
  .plate-btn:focus-visible {
    outline: 3px solid var(--fuchsia);
    outline-offset: 3px;
  }
  @media (hover: hover) and (pointer: fine) {
    .mine-turn .plate-btn:not(.sel):hover {
      transform: translateY(-4px);
    }
  }

  /* The ✓ that ends your turn, beside the discard pile it would go on. */
  .endb {
    position: absolute;
    left: 50%;
    top: -12px;
    transform: translate(-50%, -100%);
    z-index: 20;
    white-space: nowrap;
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--fuchsia);
    color: #ffffff;
    font: 700 16px/1 var(--face);
    box-shadow: 0 4px 12px rgb(80 10 70 / 0.35);
  }
  .phone .endb {
    min-height: 34px;
    padding: 0 10px;
    font-size: 13px;
  }
  .phone .fan:first-child .endb {
    left: 0;
    transform: translate(0, -100%);
  }
  .phone .fan:last-child .endb {
    left: auto;
    right: 0;
    transform: translate(0, -100%);
  }
  .endb::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -5px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    background: inherit;
    transform: rotate(45deg);
  }

  /* ---- what flies ------------------------------------------------------------------------------ */
  .flights {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 30;
  }
  .flight {
    position: absolute;
    transform-origin: 0 0;
  }
  .flight.dragged {
    transform-origin: 50% 50%;
    filter: drop-shadow(0 16px 18px rgb(0 0 0 / 0.28));
    z-index: 2;
  }
</style>
