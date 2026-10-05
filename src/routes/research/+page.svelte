<script lang="ts">
  import { goto } from '$app/navigation';
  import ResearchForm from '#lib/components/research/ResearchForm.svelte';
</script>
<svelte:head>
  <title>Share how you work | Melzi</title>
  <meta name="description" content="Tell Melzi about your infrastructure setup and the problems you run into. Answers save as you go." />
</svelte:head>
<main>
  <ResearchForm onclose={()=>goto('/')} />
</main>
<style>
  main{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:16px;background:#041329a6}
  main :global(.research-form){width:100%;max-width:590px;border:1px solid #c5d6e1;border-radius:15px;background:#f5f8fa;box-shadow:0 25px 100px #051a3b70;overflow:hidden}
  @media(max-width:480px){main{padding:10px}main :global(.research-form){border-radius:12px}}
</style>
