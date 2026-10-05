<script lang="ts">
  import ControlPlaneDiagram from './ControlPlaneDiagram.svelte';
  import TestingDiagram from './TestingDiagram.svelte';
  import SecurityDiagram from './SecurityDiagram.svelte';
  import { heroContent, type SlideIndex } from '#lib/hero-content.js';
  let { slide }: { slide: SlideIndex } = $props();
</script>
<figure id="diagram-carousel" class="slides" aria-label="Melzi platform diagrams" aria-roledescription="carousel">
  <header>
    <h2>{heroContent.slideTitles[slide]}</h2>
    <svg class="scroll-cue" viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden="true"><path d="M10 3v14m-5-5 5 5 5-5" stroke="currentColor" stroke-width="1.3"/></svg>
  </header>
  <div class="slide-stage">
    <div class="slide" hidden={slide!==0} role="group" aria-roledescription="slide" aria-label="1 of 3: Batteries-included"><ControlPlaneDiagram /></div>
    <div class="slide" hidden={slide!==1} role="group" aria-roledescription="slide" aria-label="2 of 3: Testable"><TestingDiagram /></div>
    <div class="slide" hidden={slide!==2} role="group" aria-roledescription="slide" aria-label="3 of 3: Secure"><SecurityDiagram /></div>
  </div>
</figure>
<style>
  .slides{margin:0;width:100%;min-width:0;padding:18px 20px 8px;border:1px solid #ffffffaa;border-radius:16px;background:#f5f8f8;box-shadow:0 22px 70px #051b3c30;color:#213944}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid #dce6e9}
  h2{font-size:16px;line-height:1.4;font-weight:500;letter-spacing:-.3px}
  .scroll-cue{color:#365c70;flex-shrink:0}
  .slide-stage{display:grid;padding:8px 0;background-image:radial-gradient(#9bb7c025 .65px,transparent .65px);background-size:14px 14px}
  .slide{grid-area:1 / 1;display:flex;align-items:center;justify-content:center;min-width:0}.slide[hidden]{display:flex;visibility:hidden;pointer-events:none}
  @media(max-width:480px){.slides{padding:14px 14px 4px;border-radius:13px}header{gap:8px;padding-bottom:10px}h2{font-size:14px}.slide-stage{padding:6px 0}}
  @media(max-height:680px){.slides{padding-top:12px;padding-bottom:4px}header{padding-bottom:8px}.slide-stage{padding:0}}
</style>
