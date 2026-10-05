<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  let { copy, diagram, onprogress }: { copy: Snippet; diagram: Snippet; onprogress: (value: number)=>void } = $props();
  let track: HTMLElement;
  let scene: HTMLElement;
  let sceneHeight = $state(0);
  let scrollDistance = $state(0);
  let stickyTop = $state(0);
  let initialized = $state(false);
  let scrollStart = 0;

  export function goToSlide(index: number) {
    if (!initialized) return;
    const progress = Math.max(0, Math.min(1, index / 2));
    // Native scrolling, with no wheel/touch interception or animated scroll jumps.
    window.scrollTo({ top: scrollStart + progress * scrollDistance, behavior: 'instant' });
    onprogress(progress);
  }

  onMount(()=>{
    let frame=0;
    const update=()=>{
      frame=0;
      onprogress(Math.max(0,Math.min(1,(window.scrollY-scrollStart)/scrollDistance)));
    };
    const measure=()=>{
      sceneHeight=scene.offsetHeight;
      scrollDistance=Math.round(window.innerHeight*1.6);
      // A tall mobile hero scrolls normally until the diagram fits in view.
      // Then only the lower, diagram portion stays pinned for the sequence.
      stickyTop=Math.min(0,window.innerHeight-sceneHeight);
      scrollStart=track.getBoundingClientRect().top+window.scrollY-stickyTop;
      initialized=true;
      update();
    };
    const onscroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const observer=new ResizeObserver(measure);
    observer.observe(scene);
    window.addEventListener('resize',measure);
    window.addEventListener('scroll',onscroll,{passive:true});
    measure();
    return ()=>{observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',onscroll);cancelAnimationFrame(frame);};
  });
</script>

<section bind:this={track} class="story-track" aria-label="Melzi infrastructure platform" data-scroll-ready={initialized} style:height={sceneHeight ? `${sceneHeight+scrollDistance}px` : undefined}>
  <div bind:this={scene} class="hero" style:top={`${stickyTop}px`}>
    <div class="hero-background" aria-hidden="true"></div>
    <div class="hero-layout">
      <div class="copy-slot">{@render copy()}</div>
      <div class="diagram-slot">{@render diagram()}</div>
    </div>
  </div>
</section>

<style>
  .story-track{position:relative}
  .hero{min-height:100svh;position:sticky;isolation:isolate;display:flex;align-items:center;padding:90px clamp(24px,5.5vw,90px) 75px;overflow:hidden}
  .hero-background{position:absolute;inset:0;z-index:-2;background:#0b204c url('/images/cloudscape.webp') center 45% / cover no-repeat}
  .hero-background::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#06193595 0%,#071b4580 49%,#06183a80 100%),linear-gradient(180deg,#081b3630,#071d471a 75%,#071c4550)}
  .hero-layout{max-width:1350px;width:100%;margin:auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);column-gap:clamp(40px,6vw,100px);align-items:center}
  .copy-slot{grid-column:1;grid-row:1;min-width:0}.diagram-slot{grid-column:2;grid-row:1;min-width:0}
  @media(min-width:1650px){.hero-layout{column-gap:105px}}
  @media(max-width:1100px){.hero{padding-left:36px;padding-right:36px}.hero-layout{column-gap:35px;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr)}}
  @media(max-width:800px){.hero{padding:90px 24px 24px;align-items:start;min-height:100svh}.hero-layout{display:flex;flex-direction:column;align-items:stretch;gap:34px;max-width:600px}.copy-slot{order:0}.diagram-slot{order:1}.hero-background{background-position:50% 50%}.hero-background::after{background:linear-gradient(180deg,#04183b65,#071b458a 37%,#061d4580 78%,#051d454a)}}
  @media(max-width:380px){.hero{padding-left:18px;padding-right:18px}}
  @media(max-height:760px){.hero{padding-top:24px;padding-bottom:20px}}
  @media(max-height:760px) and (max-width:800px){.hero{padding-top:48px;padding-bottom:16px}.hero-layout{gap:24px}}
</style>
