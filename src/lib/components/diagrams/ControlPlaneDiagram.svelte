<script lang="ts">
  import ProviderLogos from './ProviderLogos.svelte';
  const resources=[{name:'Compute',icon:'compute'},{name:'Database',icon:'database'},{name:'Auth',icon:'auth'},{name:'Storage',icon:'storage'},{name:'Secrets',icon:'secrets'},{name:'Networking',icon:'network'}];
</script>
<div class="platform-diagram" data-diagram="platform">
  <div class="definition"><div class="code-icon" aria-hidden="true">{'{ }'}</div><strong>Your app</strong><div class="entrypoints"><span>Developer</span><i>/</i><span>Agent</span></div></div>
  <div class="stem" aria-hidden="true"><i></i></div>
  <section class="stack" aria-label="Included application services">
    <div class="stack-header"><span>Melzi</span><svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m3 6 7-3 7 3-7 3-7-3Zm0 4 7 3 7-3M3 14l7 3 7-3" stroke="currentColor" stroke-width="1.4"/></svg></div>
    <div class="resource-grid">
      {#each resources as resource}
        <div class="resource"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {#if resource.icon==='compute'}<rect x="4" y="5" width="16" height="14" rx="3"/><path d="m8 9 3 3-3 3m5 0h3"/>
          {:else if resource.icon==='database'}<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 4 14 4 14 0V6M5 12c0 4 14 4 14 0"/>
          {:else if resource.icon==='auth'}<circle cx="10" cy="8" r="3"/><path d="M4 20v-3a6 6 0 0 1 10-4m2 3 2 2 4-5"/>
          {:else if resource.icon==='storage'}<path d="M3 8V5h7l2 3h9v12H3V8Zm0 3h18"/>
          {:else if resource.icon==='secrets'}<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>
          {:else}<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v6M5 17v-4h14v4"/>{/if}
        </svg><strong>{resource.name}</strong></div>
      {/each}
    </div>
  </section>
  <ProviderLogos />
</div>
<style>
  .platform-diagram{width:100%;min-width:0;color:#18384c;padding:8px 0}
  .definition{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #a8c1d0;border-radius:10px;padding:14px 16px;margin:0 16px;box-shadow:0 3px 10px #243e4807}
  .definition>strong{font-size:14px;font-weight:600}.code-icon{display:grid;place-items:center;width:34px;height:34px;border:1px solid #a7c5d5;border-radius:8px;background:#e2eef4;font-family:var(--font-mono);font-size:14px;color:#2c5971;flex-shrink:0}
  .entrypoints{display:flex;gap:8px;margin-left:auto;color:#425f72;font-size:11px}.entrypoints i{font-style:normal;color:#809aa8}
  .stem{display:flex;justify-content:center;height:28px}.stem i{width:1px;background:#729bad;position:relative}.stem i:after{content:'';position:absolute;width:5px;height:5px;border-radius:50%;background:#547f95;bottom:-2px;left:-2px;z-index:1}
  .stack{border:1px solid #8facbc;border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 8px 22px #2445520c}
  .stack-header{display:flex;align-items:center;justify-content:space-between;padding:14px 17px;background:#dbe9f1;border-bottom:1px solid #b6ccd8;color:#31586d}.stack-header>span{font-family:'DM Serif Display',Georgia,serif;font-size:24px;line-height:1;color:#193a4c}
  .resource-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:6px 12px}
  .resource{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:100px;padding:15px 8px;border-bottom:1px solid #d2dfe5;min-width:0}.resource:nth-child(n+4){border-bottom:0}
  .resource svg{width:27px;height:27px;stroke:#345f78;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.resource strong{font-size:13px;font-weight:500;line-height:1.4}
  @media(max-width:480px){.definition{margin:0 4px;padding:12px 10px;gap:9px}.definition>strong{font-size:13px}.entrypoints{flex-direction:column;gap:3px;font-size:10px}.entrypoints i{display:none}.stack-header{padding:13px}.resource-grid{padding:5px 8px}.resource{min-height:92px;gap:11px;padding:13px 4px}.resource svg{width:24px;height:24px}.resource strong{font-size:12px}}
</style>
