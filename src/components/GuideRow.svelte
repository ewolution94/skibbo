<!--
  "So geht's" as a row of its own, in the panels' look (the user, 2026-10-20: the quiet button "looks
  really lost in this ui", Würfle): a small Joker plate, the title, what's inside, a chevron. On the
  start page and at the top of Settings, as Stichle has it.
-->
<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { ui } from '../lib/ui.svelte';

  let { before }: { before?: () => void } = $props();
</script>

<button
  class="sheet guide-row"
  type="button"
  onclick={() => {
    before?.();
    ui.guide = true;
  }}
>
  <svg class="joker" viewBox="0 0 22 28" aria-hidden="true">
    <defs><clipPath id="guide-plate"><rect x="1" y="1" width="20" height="26" rx="3.6" /></clipPath></defs>
    <g clip-path="url(#guide-plate)"><path d="M0 0h22v9.5L0 17.5z" fill="#1d5fa0" /><path d="M0 17.5L22 9.5v9L0 26.5z" fill="#23704f" /><path d="M0 26.5L22 18.5V28H0z" fill="#9f2294" /></g>
    <rect x="2.6" y="2.6" width="16.8" height="22.8" rx="2.4" fill="none" stroke="#fff" stroke-width="1.3" />
    <path d="M11 8.2l1.5 3.3 3.6.4-2.7 2.4.8 3.6L11 16l-3.2 1.9.8-3.6-2.7-2.4 3.6-.4z" fill="#fff" />
  </svg>
  <span class="text"><b>{t('guide')}</b><small>{t('guideOpen')}</small></span>
  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
</button>

<style>
  .guide-row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 68px;
    padding: 12px 14px 12px 16px;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--ewo-dur-1) var(--ewo-ease), box-shadow var(--ewo-dur-1) var(--ewo-ease);
  }
  .guide-row:active {
    transform: translateY(2px);
    box-shadow: 0 0 0 rgb(29 47 94 / 0.35);
  }
  .guide-row:focus-visible {
    outline: 3px solid var(--fuchsia);
    outline-offset: 2px;
  }
  .joker {
    flex: none;
    width: 28px;
    height: 36px;
    filter: drop-shadow(0 1.5px 0 rgb(0 0 0 / 0.2));
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .text b {
    font: 700 20px/1.15 var(--face);
    color: var(--ink);
  }
  .text small {
    font: 500 14px/1.3 var(--face);
    color: var(--mute);
  }
  .chev {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--navy);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
