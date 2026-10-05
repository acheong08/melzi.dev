<script lang="ts">
  import { heroContent } from '#lib/hero-content.js';
  let { active, onselect }: { active: number; onselect: (index: number)=>void } = $props();
</script>
<div class="features" role="group" aria-label="Explore platform capabilities">
  {#each heroContent.features as feature,index}
    <button type="button" class:active={index===active} aria-pressed={index===active} aria-controls="diagram-carousel" onclick={()=>onselect(index)}>{feature}</button>
  {/each}
</div>
<style>
  .features { display:flex; flex-wrap:wrap; gap:7px; }
  button { border:1px solid #93abc0; background:#0a2344; color:#ffffff; border-radius:999px; padding:9px 14px; font-size:12px; line-height:18px; min-height:40px; cursor:pointer; }
  button:hover { border-color:#d6e8f5; background:#163d61; }
  button.active { color:#102b3d; background:#d9effb; border-color:#d9effb; }
  @media(max-width:400px) { .features { gap:6px; } button { padding:8px 12px; font-size:11px; } }
</style>
