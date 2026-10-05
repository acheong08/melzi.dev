<div class="providers" aria-label="Deployment providers">
  <div class="provider aws"><img src="/logos/aws.svg" alt="AWS" width="65" height="39" /></div>
  <div class="provider"><img src="/logos/azure.svg" alt="" width="29" height="29" /><span>Azure</span></div>
  <div class="provider"><img src="/logos/hetzner.svg" alt="" width="27" height="27" /><span>Hetzner</span></div>
  <div class="provider"><svg viewBox="0 0 28 28" width="29" height="29" fill="none" aria-hidden="true"><path d="m3 13 11-9 11 9M6 11v13h16V11M10 24v-8h8v8" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span>Homelab</span></div>
</div>
<style>
  .providers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:center;gap:14px;padding:24px 6px 4px}
  .provider{display:flex;align-items:center;justify-content:center;gap:9px;color:#18384c;min-width:0;font-size:12px;font-weight:600}
  img{display:block;object-fit:contain;flex-shrink:0}.provider svg{flex-shrink:0}.aws img{width:65px;height:39px}
  @media(max-width:1100px){.provider{flex-direction:column;gap:8px}.providers{gap:10px}.aws img{width:61px;height:42px}}
  @media(max-width:480px){.providers{padding-top:22px;gap:7px}.provider{font-size:11px;gap:8px}.provider img,.provider svg{width:26px;height:26px}.aws img{width:57px;height:37px}}
</style>
