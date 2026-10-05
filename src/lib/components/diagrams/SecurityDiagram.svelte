<div class="security" data-diagram="security">
  <div class="signals">
    <article class="intel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4V5Zm4 4h8m-8 4h5M8 19v2m8-2v2"/></svg><div><h3>Threat intel</h3><p>CVEs &amp; advisories</p></div></article>
    <article class="sensors"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M5 5a10 10 0 0 0 0 14m14-14a10 10 0 0 1 0 14M8 8a6 6 0 0 0 0 8m8-8a6 6 0 0 1 0 8"/></svg><div><h3>Detection signals</h3><p>Honeypots &amp; canaries</p></div></article>
  </div>
  <svg class="signal-paths" viewBox="0 0 560 42" preserveAspectRatio="none" aria-hidden="true"><path d="M134 0v14q0 7 7 7h278q7 0 7-7V0M280 21v21m-5-6 5 6 5-6"/></svg>
  <section class="inventory" aria-label="Infrastructure inventory matched against threat intelligence">
    <header><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 9-4 9 4-9 4-9-4Zm0 6 9 4 9-4M3 18l9 4 9-4"/></svg><h3>Inventory</h3></header>
    <div class="asset-types">
      <div><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18m-12 4-2 2 2 2m6-4 2 2-2 2"/></svg><strong>Services</strong></div>
      <div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10"/></svg><strong>Images &amp; packages</strong></div>
      <div><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/></svg><strong>Exposed endpoints</strong></div>
    </div>
    <div class="asset-details"><span>Versions</span><i></i><span>Dependencies</span><i></i><span>Exposure</span></div>
    <div class="matching"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11 2-7 9h5l-1 7 8-10h-5l0-6Z"/></svg><span>Automatic protection</span></div>
  </section>
  <svg class="response-path" viewBox="0 0 560 26" preserveAspectRatio="none" aria-hidden="true"><path d="M280 0v7q0 6-6 6H140q-6 0-6 6v7M280 7q0 6 6 6h134q6 0 6 6v7"/></svg>
  <div class="response">
    <div class="fix"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4a6 6 0 0 0-7 7L3 15a3 3 0 0 0 4 4l4-4a6 6 0 0 0 7-7l-4 4-4-4 4-4Z"/></svg><strong>Fix vulnerabilities</strong></div>
    <div class="block"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="M8 12h8"/></svg><strong>Block attacks</strong></div>
  </div>
</div>
<style>
  .security{width:100%;min-width:0;padding:12px 0;color:#203d4d;container-type:inline-size}
  svg{display:block;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
  .signals{display:grid;grid-template-columns:1fr 1fr;gap:14px}.signals article{display:flex;align-items:center;gap:12px;border:1px solid #b8cbd6;border-radius:9px;padding:18px 14px;background:#fff}.signals article>svg{width:25px;height:25px;color:#456d85}.signals h3{font-size:14px;font-weight:600;letter-spacing:-.15px;margin:0 0 5px}.signals p{font-size:11px;color:#4c6879;line-height:1.5;margin:0}.sensors{background:#ecf2f5!important}
  .signal-paths{width:100%;height:42px;color:#7b9aab}
  .inventory{border:1px solid #709ab0;border-radius:11px;overflow:hidden;background:#fff;box-shadow:0 6px 18px #1c3d4f0c}
  header{display:flex;align-items:center;gap:10px;padding:15px 17px;background:#dbe9f0;border-bottom:1px solid #aec7d4}header>svg{width:23px;height:23px;color:#315d75}header h3{font-size:17px;font-weight:600;letter-spacing:-.3px;margin:0}
  .asset-types{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:23px 12px 17px}.asset-types>div{display:flex;flex-direction:column;align-items:center;gap:11px;text-align:center}.asset-types svg{width:24px;height:24px;color:#4b738a}.asset-types strong{font-size:11px;font-weight:500;line-height:1.45}
  .asset-details{display:flex;align-items:center;justify-content:center;gap:13px;padding:0 8px 20px;color:#526e7e;font-size:10px}.asset-details i{width:3px;height:3px;background:#7b9aa9;border-radius:50%}
  .matching{display:flex;align-items:center;justify-content:center;gap:9px;background:#ecf3f6;border-top:1px solid #c5d7e0;padding:14px;font-size:12px;color:#244f67}.matching svg{width:17px;height:17px}
  .response-path{height:26px;width:100%;color:#8daaba}
  .response{display:grid;grid-template-columns:1fr 1fr;gap:12px}.response>div{display:flex;align-items:center;justify-content:center;gap:10px;min-height:49px;padding:10px 12px;border:1px solid #aac2b7;border-radius:8px;background:#e9f1ed;color:#355e4c}.response .block{border-color:#9fbccc;background:#e3eef5;color:#254e68}.response strong{font-size:13px;font-weight:600;line-height:1.4}.response svg{width:21px;height:21px}
  @container(max-width:430px){.signals{gap:9px}.signals article{padding:14px 11px;gap:9px;flex-direction:column;align-items:flex-start}.signals article>svg{width:22px;height:22px}.signals h3{font-size:13px}.signals p{font-size:10px}header{padding:13px}.asset-types{gap:6px;padding:21px 8px 15px}.asset-types strong{font-size:10px}.asset-types svg{width:22px;height:22px}.asset-details{gap:8px;font-size:9px;padding-bottom:17px}.matching{font-size:11px;padding:13px 8px}.response{gap:8px}.response>div{padding:8px;gap:7px}.response strong{font-size:11px}.response svg{width:18px;height:18px}}
</style>
