<script lang="ts">
  import { heroContent } from '#lib/hero-content.js';
</script>
<div class="brand">{heroContent.name}</div>
<style>
  .brand { color:#fffdf8; font-family:'DM Serif Display',Georgia,serif; font-size:clamp(68px,7.5vw,108px); letter-spacing:-4px; line-height:1; }
  @media(max-width:800px) { .brand { font-size:72px; letter-spacing:-2.7px; } }
</style>
