<svelte:head>
  <title>How we use your answers | Melzi</title>
  <meta name="description" content="How Melzi saves research responses, uses contact details, and keeps drafts on your device." />
</svelte:head>

<main>
  <a class="brand" href="/">Melzi</a>
  <h1>How we use your answers</h1>
  <p>We use this research to understand infrastructure problems and decide what to build. Please do not include passwords, API keys, confidential information, or other people’s personal details.</p>

  <h2>Answers save as you go</h2>
  <p>Once you start answering, the form saves your choices and text, including unfinished responses. Closing the form does not withdraw answers that have already been saved. If you provide an email address, we use it only for the follow-up options you select.</p>

  <h2>Your draft on this device</h2>
  <p>Your answers and a secret session credential are kept in this browser’s local storage so you can resume after a reload. Anyone using the same browser profile may be able to open the draft. The form shows a warning if browser storage is unavailable.</p>
  <p>Device copies are not removed automatically. “Clear local draft” removes the local copy, but does not delete a response already received by Melzi. Browser settings, private browsing, or clearing site data can also remove your local copy. You can download your answers from the form.</p>

  <h2>How long server copies remain</h2>
  <ul>
    <li>Unfinished drafts expire 30 days after their last successful save.</li>
    <li>Submitted responses expire 365 days after their last successful save.</li>
    <li>Expired answers are removed by scheduled cleanup. Database backups can retain them for up to another seven days.</li>
    <li>Unlinked hashes of expired session credentials may remain to prevent those credentials from being reused.</li>
  </ul>
  <p>Editing a submitted response returns it to an unfinished draft until you submit it again.</p>

  <h2>Storage and security</h2>
  <p>Microsoft Azure hosts the site and stores research responses in an encrypted PostgreSQL database in the United States. The public API requires your secret session credential to retrieve or change your draft. It stores a hash of that credential, not the credential itself. Requests use HTTPS.</p>
  <p>We do not add IP addresses to research responses or log answer text and session credentials. Hosting and security providers still process connection information to deliver the site and limit abuse. Cloudflare manages the domain’s DNS, and Google Fonts supplies the site’s typefaces.</p>

  <h2>If saving is unavailable</h2>
  <p>Request limits can temporarily pause server saves. The form keeps your pending answers locally when browser storage is available and tells you when they have not reached the server. Submission is only confirmed after the server acknowledges it.</p>

  <a class="back" href="/">Back to Melzi</a>
</main>

<style>
  main{max-width:720px;margin:0 auto;padding:48px 24px 80px;color:#1e3d52;line-height:1.65}
  .brand{display:inline-block;margin-bottom:32px;font-family:'DM Serif Display',serif;font-size:30px;color:inherit;text-decoration:none}
  h1{font-size:clamp(30px,5vw,42px);line-height:1.15;margin:0 0 24px}
  h2{font-size:22px;margin:32px 0 10px;line-height:1.3}
  p,li{font-size:16px}p{margin:0 0 16px}ul{padding-left:22px}li{margin:8px 0}
  .back{display:inline-block;margin-top:24px;color:#174e71;text-underline-offset:4px}
</style>
