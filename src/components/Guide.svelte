<!--
  How to play, as full-screen pages: Folio's <ewo-guide> brings the frame (swipe, the dots, Back and
  Next, Done); each page has a small picture drawn with the game's own plates. Opens once on a
  device's first visit (Home), and from the start page, the lobby and Settings. From Würfle's.
-->
<script lang="ts">
  import { t, type Key } from '../lib/i18n.svelte';
  import { ui } from '../lib/ui.svelte';
  import Plate from './Plate.svelte';

  const close = () => (ui.guide = false);
  const pages = [1, 2, 3, 4, 5, 6];
  /** A card id for a number: the first of its twelve copies. */
  const id = (v: number) => v - 1;
  const JOKER = 150;
</script>

<ewo-guide
  open={ui.guide}
  label={t('guideTitle')}
  next-label={t('guideNext')}
  back-label={t('guideBack')}
  skip-label={t('guideSkip')}
  done-label={t('guideDone')}
  oncancel={close}
  onclose={close}
>
  {#each pages as n (n)}
    <section class="page">
      <div class="art" aria-hidden="true">
        {#if n === 1}
          <div class="stock">
            <span class="b2"><Plate back /></span><span class="b1"><Plate back /></span><Plate id={id(7)} />
          </div>
          <svg class="arrow" viewBox="0 0 120 40"><path d="M8 30 C 40 30, 74 20, 108 8" /><path d="M94 5 L108 8 L100 20" /></svg>
          <div class="one"><Plate id={id(6)} /></div>
        {:else if n === 2}
          <div class="climb">
            {#each [1, 2, 3, 4, 5] as v, k (k)}<span style:translate="{k * 16}px {k * -8}px"><Plate id={id(v)} /></span>{/each}
          </div>
          <p class="tag">1 → 12</p>
        {:else if n === 3}
          <div class="row">
            {#each [3, 9, JOKER + 1, 1, 12] as v, k (k)}<Plate id={v < 13 ? id(v) : v} />{/each}
          </div>
        {:else if n === 4}
          <div class="fan">
            {#each [11, 10, 9] as v, k (k)}<span style:top="{k * 26}px"><Plate id={id(v)} /></span>{/each}
          </div>
        {:else if n === 5}
          <div class="row two">
            <Plate id={JOKER} />
            <span class="eq">=</span>
            <Plate id={JOKER} as={8} />
          </div>
        {:else}
          <div class="row two">
            <div class="stock empty"><span>0</span></div>
            <p class="tag big">25 + 5 × …</p>
          </div>
        {/if}
      </div>
      <h2 class="display">{t(`guide${n}Title` as Key)}</h2>
      <p>{t(`guide${n}Text` as Key)}</p>
    </section>
  {/each}
</ewo-guide>

<style>
  /* The guide on the lime-washed wall, headings in navy, the main button fuchsia. */
  ewo-guide {
    --ewo-guide-bg: radial-gradient(circle at 20% 30%, rgb(120 100 80 / 0.07) 0 1px, transparent 1.6px) 0 0 / 9px 7px, #e7e0d3;
    --ewo-guide-fg: var(--ink);
    --ewo-guide-fg-2: var(--ink-2);
    --ewo-guide-accent: var(--fuchsia);
    --ewo-guide-accent-ink: #ffffff;
    --ewo-guide-dot: rgb(29 47 94 / 0.3);
    --ewo-guide-dot-on: var(--navy);
  }
  ewo-guide::part(next) {
    border-radius: 10px;
    box-shadow: inset 0 0 0 3px var(--fuchsia), inset 0 0 0 4.6px #ffffff, 0 3px 0 var(--fuchsia-edge);
    font: 700 18px/1 var(--face);
  }
  .page {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    max-width: 460px;
    margin: 0 auto;
    padding: 12px 24px 24px;
    text-align: center;
  }
  .art {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    height: 230px;
    --pw: 82px;
    --ph: 115px;
  }
  h2 {
    margin: 0;
    font-size: 30px;
    color: var(--navy);
  }
  p {
    margin: 0;
    font-size: 18px;
    line-height: 1.45;
    color: var(--ink-2);
  }
  .stock {
    position: absolute;
    left: 14%;
    top: 50px;
    width: var(--pw);
    height: var(--ph);
  }
  .stock > :global(.plate),
  .stock > span {
    position: absolute;
    left: 0;
    top: 0;
  }
  .b1 {
    translate: 3px 3px;
  }
  .b2 {
    translate: 6px 6px;
  }
  .arrow {
    position: absolute;
    left: 38%;
    top: 70px;
    width: 26%;
    fill: none;
    stroke: var(--fuchsia);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .one {
    position: absolute;
    right: 14%;
    top: 50px;
  }
  .climb {
    position: relative;
    width: 160px;
    height: 160px;
  }
  .climb span {
    position: absolute;
    left: 0;
    top: 40px;
  }
  .tag {
    position: absolute;
    bottom: 0;
    font: 700 22px/1 var(--face);
    color: var(--navy);
  }
  .tag.big {
    position: static;
    font-size: 30px;
  }
  .row {
    display: flex;
    gap: 8px;
    --pw: 62px;
    --ph: 88px;
  }
  .row.two {
    align-items: center;
    gap: 18px;
    --pw: 82px;
    --ph: 115px;
  }
  .eq {
    font: 700 40px/1 var(--face);
    color: var(--navy);
  }
  .fan {
    position: relative;
    width: var(--pw);
    height: 190px;
  }
  .fan span {
    position: absolute;
    left: 0;
  }
  .stock.empty {
    position: relative;
    left: auto;
    top: auto;
    display: grid;
    place-items: center;
    border: 2px dashed rgb(42 38 34 / 0.35);
    border-radius: 10px;
    font: 700 40px/1 var(--face);
    color: rgb(42 38 34 / 0.4);
  }
</style>
