<div class="testing" data-diagram="testing">
  <div class="replication">
    <div class="production"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16M8 8h.01M8 16h.01"/></svg><strong>Production</strong></div>
    <div class="replicate-arrow"><span>Replicate</span><svg viewBox="0 0 60 18" aria-hidden="true"><path d="M1 9h55m-7-6 7 6-7 6"/></svg></div>
    <div class="replica"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 7V3H3v14h4"/></svg><strong>Isolated replica</strong></div>
  </div>
  <svg class="fan-out" viewBox="0 0 540 48" preserveAspectRatio="none" aria-hidden="true"><path d="M400 0v14q0 8-8 8H90q-8 0-8 8v18M270 22v26M392 22h58q8 0 8 8v18"/></svg>
  <div class="benefits">
    <article class="load">
      <div class="benefit-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 26V17m7 9V12m8 14V8m7 18V3"/><path class="faint" d="M2 29h28"/></svg></div>
      <h3>Load</h3><p>Performance<br /> at scale</p>
      <div class="mini-chart" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </article>
    <article class="security-test">
      <div class="benefit-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 11 4v9c0 6-11 13-11 13S5 22 5 16V7l11-4Z"/><path d="m11 12 10 10m-10 0 10-10"/></svg></div>
      <h3>Security</h3><p>Risky pentesting,<br /> off production</p>
      <div class="target" aria-hidden="true"><span></span><i></i></div>
    </article>
    <article class="functional">
      <div class="benefit-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="5" width="24" height="23" rx="3"/><path d="M4 12h24m-18 8 4 4 8-8"/></svg></div>
      <h3>Functional</h3><p>Catch regressions<br /> before they ship</p>
      <div class="comparison" aria-hidden="true"><span>−</span><i></i><span>+</span><i></i></div>
    </article>
  </div>
</div>
<style>
  .testing{width:100%;min-width:0;padding:14px 0;color:#203d4d;container-type:inline-size}
  svg{display:block;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
  .replication{display:grid;grid-template-columns:1fr .5fr 1.15fr;align-items:center;gap:13px}
  .production,.replica{border:1px solid #b6cbd5;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:12px;padding:24px 12px}
  .production>svg,.replica>svg{width:25px;height:25px;flex-shrink:0;color:#55778a}.replica{border-color:#709fb5;background:#e0edf3}.replica>svg{color:#315e75}strong{font-size:13px;font-weight:500}
  .replicate-arrow{color:#52778c;text-align:center}.replicate-arrow>span{font-size:10px;display:block;margin-bottom:6px}.replicate-arrow>svg{width:100%;height:18px}
  .fan-out{width:100%;height:45px;color:#86a6b7}
  .benefits{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  article{position:relative;overflow:hidden;min-height:207px;padding:22px 16px 17px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--ink)}
  .load{--ink:#245c80;--border:#a5c5d8;--surface:#e6f0f7}.security-test{--ink:#765066;--border:#d4b9ca;--surface:#f3eaf0}.functional{--ink:#376a57;--border:#adcaba;--surface:#e8f2eb}
  .benefit-icon>svg{width:30px;height:30px;stroke-width:1.6}.benefit-icon .faint{opacity:.35}
  h3{font-size:17px;font-weight:600;letter-spacing:-.3px;margin:16px 0 7px}p{font-size:12px;line-height:1.7;margin:0;color:var(--ink)}
  .mini-chart{display:flex;gap:5px;height:23px;align-items:flex-end;margin-top:17px;opacity:.3}.mini-chart i{flex:1;background:currentColor;border-radius:2px 2px 0 0;height:25%}.mini-chart i:nth-child(2){height:40%}.mini-chart i:nth-child(3){height:35%}.mini-chart i:nth-child(4){height:65%}.mini-chart i:nth-child(5){height:58%}.mini-chart i:nth-child(6){height:78%}.mini-chart i:nth-child(7){height:100%}
  .target{height:23px;position:relative;margin-top:17px;opacity:.3;border-bottom:1px solid currentColor}.target span{width:18px;height:18px;border:1px solid currentColor;border-radius:50%;position:absolute;left:43%;top:0}.target i{height:23px;width:1px;background:currentColor;position:absolute;left:calc(43% + 9px);top:-2px}
  .comparison{display:grid;grid-template-columns:12px 1fr;gap:3px 6px;margin-top:17px;height:23px;align-items:center;opacity:.4}.comparison span{font-family:var(--font-mono);font-size:10px;line-height:10px}.comparison i{height:3px;border-radius:2px;background:currentColor;width:85%}.comparison i:last-child{width:65%}
  @container(max-width:430px){.replication{grid-template-columns:1fr .42fr 1.2fr;gap:7px}.production,.replica{flex-direction:column;padding:15px 6px;gap:8px}.production strong,.replica strong{font-size:11px}.replicate-arrow>span{font-size:9px}.benefits{gap:7px}article{padding:16px 10px 13px;min-height:197px}h3{font-size:14px;margin-top:13px}p{font-size:11px;line-height:1.65}.benefit-icon>svg{width:26px;height:26px}}
  @container(max-width:350px){
    .fan-out{display:none}.benefits{grid-template-columns:1fr;gap:8px;margin-top:20px}
    article{display:grid;grid-template-columns:29px 1fr;column-gap:13px;align-items:center;min-height:0;padding:13px 14px}
    .benefit-icon{grid-row:1 / 3}h3{font-size:14px;margin:0 0 3px}p{font-size:11px;line-height:1.55}p br{display:none}
    .mini-chart,.target,.comparison{display:none}.replica strong{font-size:11px}
  }
</style>
