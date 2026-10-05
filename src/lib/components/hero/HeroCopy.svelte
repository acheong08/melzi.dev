<script lang="ts">
  import Brand from './Brand.svelte';
  import FeatureLabels from './FeatureLabels.svelte';
  import { heroContent } from '#lib/hero-content.js';
  let { active, onselect, onaction }: { active: number; onselect: (index: number)=>void; onaction: ()=>void } = $props();
</script>
<div class="hero-copy">
  <Brand />
  <h1>{heroContent.tagline}</h1>
  <FeatureLabels {active} {onselect} />
  <div class="feature-taglines">
    {#each heroContent.featureTaglines as text,index}
      <p class="feature-tagline" class:active={active===index} aria-hidden={active!==index}>{text}</p>
    {/each}
  </div>
  <button class="action" type="button" onclick={onaction}>{heroContent.action}<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-7-7 7 7-7 7" stroke="currentColor" stroke-width="1.5"/></svg></button>
</div>
<style>
  .hero-copy { min-width:0; color:#fffdf8; }
  h1 { font-size:clamp(29px,2.8vw,42px); font-weight:400; letter-spacing:-1.3px; line-height:1.25; margin:29px 0 25px; max-width:530px; }
  .feature-taglines { display:grid; max-width:440px; margin-top:23px; }
  .feature-tagline { grid-area:1/1; visibility:hidden; color:#e1e9f1; font-size:15px; line-height:1.75; min-height:53px; margin:0; }
  .feature-tagline.active { visibility:visible; }
  .action { display:inline-flex; align-items:center; justify-content:center; gap:40px; min-height:50px; padding:15px 19px; margin-top:35px; border:1px solid #a6c6dc; border-radius:5px; background:#0b2b4a; color:#ffffff; font-size:13px; font-weight:500; cursor:pointer; transition:background .15s; }
  .action:hover { background:#183f60; }
  @media(max-width:1100px) { h1 { font-size:32px; } }
  @media(max-width:800px) { h1 { font-size:clamp(29px,7vw,40px); letter-spacing:-1px; margin:23px 0 22px; } .action { margin-top:28px; } }
</style>
