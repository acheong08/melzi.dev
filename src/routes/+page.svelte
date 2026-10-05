<script lang="ts">
  import { onMount } from 'svelte';
  import Hero from '#lib/components/hero/Hero.svelte';
  import HeroCopy from '#lib/components/hero/HeroCopy.svelte';
  import ResearchPreview from '#lib/components/hero/ResearchPreview.svelte';
  import DiagramSlides from '#lib/components/diagrams/DiagramSlides.svelte';
  import { heroContent, type SlideIndex } from '#lib/hero-content.js';

  let active = $state<SlideIndex>(0);
  let researchOpen = $state(false);
  let ready = $state(false);
  let hero: { goToSlide: (index: number)=>void } | undefined = $state();
  function updateProgress(value: number) {
    active=Math.min(2,Math.round(value*2)) as SlideIndex;
  }
  function select(index: number) {
    const next=((index+heroContent.features.length)%heroContent.features.length) as SlideIndex;
    hero?.goToSlide(next);
  }
  onMount(()=>{ready=true;});
</script>
<svelte:head>
  <title>Melzi | {heroContent.tagline}</title>
  <meta name="description" content={heroContent.tagline} />
  <meta name="theme-color" content="#0c244c" />
  <link rel="preload" as="image" href="/images/cloudscape.webp" />
</svelte:head>
<main data-ready={ready}>
  {#snippet copyContent()}<HeroCopy {active} onselect={select} onaction={()=>researchOpen=true} />{/snippet}
  {#snippet diagramContent()}<DiagramSlides slide={active} />{/snippet}
  <Hero bind:this={hero} copy={copyContent} diagram={diagramContent} onprogress={updateProgress} />
  <ResearchPreview open={researchOpen} onclose={()=>researchOpen=false} />
</main>
