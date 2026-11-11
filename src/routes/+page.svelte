<svelte:head>
  <title>Melzi</title>
  <meta name="description" content="Melzi is an early-stage infrastructure and security company." />
  <meta name="robots" content="noindex" />
  <meta name="theme-color" content="#0c244c" />
  <link rel="preload" as="image" href="/images/cloudscape.webp" />
</svelte:head>
<main>
  <div class="panel">
    <p class="wordmark">Melzi</p>
    <h1>Building in stealth.</h1>
    <p class="note">We're an early-stage company working on infrastructure and security. More to share soon.</p>
  </div>
</main>

<style>
  main{min-height:100svh;display:flex;align-items:center;padding:clamp(24px,7vw,96px);position:relative;isolation:isolate;overflow:hidden}
  main::before{content:'';position:absolute;inset:0;z-index:-2;background:#0b204c url('/images/cloudscape.webp') center 45% / cover no-repeat}
  main::after{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,#061935e6 0%,#071b45b8 58%,#06183a8c 100%)}
  .panel{max-width:620px;color:#fffdf8}
  .wordmark{font-family:'DM Serif Display',Georgia,serif;font-size:clamp(46px,6vw,72px);letter-spacing:-2.6px;line-height:1}
  h1{margin-top:clamp(24px,4vw,38px);font-size:clamp(24px,2.6vw,34px);font-weight:400;letter-spacing:-.8px;line-height:1.25;color:#eef4f9}
  .note{margin-top:16px;max-width:430px;font-size:15px;line-height:1.75;color:#cbd8e4}
  @media(max-width:800px){.panel{max-width:520px}h1{letter-spacing:-.5px}.note{font-size:14px}}
  @media(max-height:520px){main{align-items:flex-start}}
</style>
