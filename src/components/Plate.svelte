<!--
  One card: an enamel number plate (the look the user picked, 2026-10-20, plans/skibbo/looks.html).
  White numerals on Enzian blue (1–4), fir green (5–8) or fuchsia (9–12), a white rim inside the
  edge, a gloss across the top left and a small chip of the enamel gone at one corner (where, by the
  card's id, so a card keeps its chip). The Joker is all three enamels with a white star; on a pile
  it keeps its colours and shows the number it stands for (`as`). The back is the street sign's navy
  with the star. Its size comes from the parent: --pw and --ph.
-->
<script lang="ts">
  import { isJoker, value, type CardId } from '../lib/api';

  let { id = null, as = 0, back = false, mini = false }: { id?: CardId | null; as?: number; back?: boolean; mini?: boolean } = $props();

  const joker = $derived(id !== null && isJoker(id));
  const v = $derived(id === null ? 0 : value(id));
  const shown = $derived(joker ? as : v);
  const range = $derived(back || id === null ? 'back' : joker ? 'joker' : v <= 4 ? 'r1' : v <= 8 ? 'r2' : 'r3');
  // The chip: one of six spots near the edge, the same for a card wherever it lies.
  const CHIPS = [
    [92, 7],
    [8, 93],
    [90, 91],
    [10, 6],
    [94, 52],
    [7, 40],
  ];
  const chip = $derived(CHIPS[(id ?? 0) % CHIPS.length]);
</script>

<div class="plate {range}" class:mini style="--cx:{chip[0]}%;--cy:{chip[1]}%" aria-hidden="true">
  {#if range === 'back'}
    <svg class="star" viewBox="0 0 40 40"><path d="M20 5l4.4 9.6 10.5 1.1-7.9 7 2.3 10.4L20 27.8l-9.3 5.3L13 22.7l-7.9-7 10.5-1.1z" /></svg>
  {:else if joker && !shown}
    {#if !mini}<span class="idx"><svg viewBox="0 0 40 40"><path d="M20 5l4.4 9.6 10.5 1.1-7.9 7 2.3 10.4L20 27.8l-9.3 5.3L13 22.7l-7.9-7 10.5-1.1z" /></svg></span>{/if}
    <svg class="star big" viewBox="0 0 40 40"><path d="M20 5l4.4 9.6 10.5 1.1-7.9 7 2.3 10.4L20 27.8l-9.3 5.3L13 22.7l-7.9-7 10.5-1.1z" /></svg>
  {:else}
    {#if !mini}<span class="idx">{shown}</span>{/if}
    <span class="big num">{shown}</span>
  {/if}
</div>

<style>
  .plate {
    --rim: max(1.4px, calc(var(--ph) * 0.016));
    position: relative;
    width: var(--pw);
    height: var(--ph);
    display: grid;
    place-items: center;
    overflow: hidden;
    isolation: isolate;
    border-radius: calc(var(--ph) * 0.085);
    background:
      radial-gradient(circle at var(--cx) var(--cy), #2a2622 0 calc(var(--ph) * 0.018), #3b3530 calc(var(--ph) * 0.022) calc(var(--ph) * 0.028), transparent calc(var(--ph) * 0.034)),
      linear-gradient(135deg, rgb(255 255 255 / 0.3) 0 20%, rgb(255 255 255 / 0) 45%),
      var(--enamel);
    box-shadow: 0 2px 0 rgb(0 0 0 / 0.28), 0 6px 10px rgb(60 40 20 / 0.22);
    color: #ffffff;
    font-family: var(--face);
    font-weight: 700;
    user-select: none;
    -webkit-user-select: none;
  }
  .plate::before {
    content: '';
    position: absolute;
    inset: calc(var(--ph) * 0.042);
    border: var(--rim) solid #ffffff;
    border-radius: calc(var(--ph) * 0.06);
    pointer-events: none;
  }
  .r1 {
    --enamel: #1d5fa0;
  }
  .r2 {
    --enamel: #23704f;
  }
  .r3 {
    --enamel: #9f2294;
  }
  .joker {
    --enamel: linear-gradient(135deg, #1d5fa0 0 34%, #23704f 34% 66%, #9f2294 66%);
  }
  .back {
    --enamel: #1d2f5e;
  }
  .num {
    font-size: calc(var(--ph) * 0.54);
    line-height: 1;
    letter-spacing: -0.01em;
    font-variant-numeric: lining-nums;
    /* Barlow's figures sit a touch low in their box: centred by eye. */
    translate: 0 -2%;
  }
  .mini .num {
    font-size: calc(var(--ph) * 0.6);
  }
  .idx {
    position: absolute;
    left: calc(var(--ph) * 0.085);
    top: calc(var(--ph) * 0.07);
    font-size: max(10px, calc(var(--ph) * 0.13));
    line-height: 1;
    font-variant-numeric: lining-nums;
  }
  .idx svg {
    display: block;
    width: 1em;
    height: 1em;
    fill: #ffffff;
  }
  .star {
    width: 58%;
    height: auto;
    fill: #ffffff;
  }
  .back .star {
    width: 34%;
    fill: none;
    stroke: #ffffff;
    stroke-width: 2.2;
    stroke-linejoin: round;
    opacity: 0.85;
  }
  .mini .star {
    width: 62%;
  }
</style>
