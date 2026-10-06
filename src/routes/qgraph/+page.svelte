<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { choices, experiencedPain, stepsFor, type Answers, type SingleField } from '#lib/research/form.js';
  import { graphNodes, graphEdges, graphPath, nodeTitle, nodeOptional, edgePath, nodeWidth, nodeHeight, graphWidth, graphHeight, presets, type GraphNode } from '#lib/research/question-graph.js';
import { problemCategoryOptions } from '#lib/research/form.js';
  let answers=$state<Answers>({...presets[0].answers,stackTools:[]});
  let ready=$state(false);
  let zoom=$state(.75);
  let showSkipped=$state(true);
  let viewport:HTMLDivElement;
  const path=$derived(graphPath(answers));
  const steps=$derived(stepsFor(answers));
  const activeEdges=$derived(new Set(path.slice(1).map((id,index)=>`${path[index]}:${id}`)));
  const edges=$derived([...graphEdges].sort((a,b)=>Number(activeEdges.has(a.id))-Number(activeEdges.has(b.id))));
  const experienced=$derived(experiencedPain(answers));
  const primaryControls: {field:SingleField;label:string}[]=[{field:'context',label:'Project context'},{field:'stage',label:'Project stage'},{field:'burden',label:'Infrastructure burden'}];
  function setAnswer(field:'problemCategory'|SingleField,value:string){
    if(field==='problemCategory'){answers={...answers,problemCategory:value?[value]:[]};}
    else answers={...answers,[field]:value};
    if(!experiencedPain(answers)){answers.workaround='';answers.problemCategory=[];}
  }
  function selectPreset(id:string){const preset=presets.find(p=>p.id===id)!;answers={...preset.answers,stackTools:[]};}
  onMount(()=>{ready=true;viewport.scrollLeft=Math.max(0,(graphWidth*zoom+32-viewport.clientWidth)/2);});
  async function setZoom(value:number){
    const x=(viewport.scrollLeft+viewport.clientWidth/2-16)/zoom;
    const y=(viewport.scrollTop+viewport.clientHeight/2-16)/zoom;
    zoom=value;await tick();
    viewport.scrollLeft=x*zoom+16-viewport.clientWidth/2;
    viewport.scrollTop=y*zoom+16-viewport.clientHeight/2;
  }
  function fit(){void setZoom(Math.max(.2,Math.min(1,(viewport.clientWidth-32)/graphWidth)));}
  function isActive(node:GraphNode){return path.includes(node.id);}
</script>

<svelte:head><title>Melzi | Question branching map</title><meta name="robots" content="noindex" /></svelte:head>
<main class="qgraph" data-ready={ready}>
  <header class="page-header"><div><a href="/" class="brand">Melzi</a><h1>Question branching map</h1><p>Change the answers to see which questions appear, which are skipped, and why.</p></div><a class="back-link" href="/">Back to the form</a></header>
  <div class="workspace">
    <aside>
      <details class="scenario" open>
        <summary>Try an answer path</summary>
        <fieldset class="scenario-content" disabled={!ready} aria-label="Branching answers">
          <div class="presets" aria-label="Example paths">{#each presets as preset}<button type="button" onclick={()=>selectPreset(preset.id)}>{preset.label}</button>{/each}</div>
          {#each primaryControls as control}<label class="control" for={`graph-${control.field}`}><span>{control.label}</span><select id={`graph-${control.field}`} value={answers[control.field]} onchange={event=>setAnswer(control.field,event.currentTarget.value)}>{#each choices[control.field] as option}<option value={option.value}>{option.label}</option>{/each}</select></label>{/each}
          <label class="control" for="graph-workaround"><span>What have they tried?</span><select id="graph-workaround" disabled={!experienced} value={answers.workaround} onchange={event=>setAnswer('workaround',event.currentTarget.value)}><option value="">Skipped / no answer</option>{#each choices.workaround as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
          <label class="control" for="graph-problem"><span>Main frustration</span><select id="graph-problem" disabled={!experienced} value={answers.problemCategory[0]??''} onchange={event=>setAnswer('problemCategory',event.currentTarget.value)}><option value="">Skipped / no answer</option>{#each problemCategoryOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
          <p class="scenario-note">Only these choices affect branching. Written answers, role, owner, outcome, spend, and tool selections do not add questions.</p>
        </fieldset>
      </details>
      <section class="route-panel" aria-labelledby="path-heading"><h2 id="path-heading">This answer path <span aria-live="polite">{steps.length} steps</span></h2><ol aria-label="Current question order">{#each path as id,index}{@const node=graphNodes.find(n=>n.id===id)!}<li data-path-step={node.step}><span class="number">{index+1}</span><span>{nodeTitle(node,answers)}{#if node.step==='context' && answers.context==='other'}<small>Includes an optional project-description textbox.</small>{/if}{#if node.id==='problem-experienced' && answers.problemCategory.includes('other')}<small>Includes the “What’s frustrating you?” textbox.</small>{/if}{#if node.step==='workaround' && answers.workaround==='tried'}<small>Includes the “What have you tried?” textbox.</small>{/if}{#if node.step==='startup'}<small>Infrastructure owner.</small>{/if}</span></li>{/each}</ol></section>
    </aside>
    <section class="map-panel" aria-labelledby="map-heading">
      <div class="map-toolbar"><div><h2 id="map-heading">All possible branches</h2><div class="legend"><span><i class="selected-key"></i>Selected path</span><span><i></i>Not in this path</span></div></div><div class="zoom-controls" aria-label="Map zoom"><button type="button" aria-label="Zoom out" disabled={zoom<=.25} onclick={()=>setZoom(Math.max(.25,zoom-.15))}>−</button><output aria-label="Zoom level">{Math.round(zoom*100)}%</output><button type="button" aria-label="Zoom in" disabled={zoom>=1.3} onclick={()=>setZoom(Math.min(1.3,zoom+.15))}>+</button><button type="button" onclick={fit}>Fit width</button></div></div>
      <div class="map-options"><label class="check"><input type="checkbox" bind:checked={showSkipped} /><span>Show questions outside this path</span></label><span>Scroll inside the map to explore.</span></div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need focus here to scroll the map.) -->
      <div class="map-viewport" bind:this={viewport} tabindex="0" role="region" aria-label="Scrollable question branching graph">
        <div class="scale-space" style:width={`${graphWidth*zoom}px`} style:height={`${graphHeight*zoom}px`}>
          <div class="graph-stage" style:width={`${graphWidth}px`} style:height={`${graphHeight}px`} style:transform={`scale(${zoom})`}>
            <svg class="edges" viewBox={`0 0 ${graphWidth} ${graphHeight}`} width={graphWidth} height={graphHeight} aria-hidden="true"><defs><marker id="arrow-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="m0 0 10 5-10 5Z" fill="#176d91"/></marker><marker id="arrow-other" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="m0 0 10 5-10 5Z" fill="#a6b8c3"/></marker></defs>{#each edges as edge}{@const active=activeEdges.has(edge.id)}{#if showSkipped||active}<path data-edge={edge.id} data-active={active} d={edgePath(edge,graphEdges.indexOf(edge))} class:active marker-end={`url(#arrow-${active?'selected':'other'})`} />{/if}{/each}</svg>
            {#each graphNodes as node}{@const active=isActive(node)}
              <article class="node" class:active class:outside={!active} hidden={!showSkipped&&!active} data-node={node.id} data-active={active} style:left={`${node.x}px`} style:top={`${node.y}px`} style:width={`${nodeWidth}px`} style:height={`${nodeHeight}px`}>
                <div class="node-meta"><span>{active?`Step ${path.indexOf(node.id)+1}`:'Not in this path'}</span><span>{nodeOptional(node)?'Optional':'Required'}</span></div>
                <h3>{nodeTitle(node,answers)}</h3><p>{node.rule}</p>{#if node.detail}<p class="detail">{node.detail}</p>{/if}
              </article>
            {/each}
          </div>
        </div>
      </div>
      <div class="map-notes"><p><strong>Same rules as the form.</strong> Highlighted steps come directly from its branch model. Every connector is generated from a possible answer combination.</p><p>Skipping an optional question normally continues along the same path. The required questions branch on their answers instead. The HATE question is always last.</p><p>This page is an inspection tool. Changing a scenario does not edit or submit a real form response.</p></div>
    </section>
  </div>
</main>

<style>
  .qgraph{min-height:100svh;background:#edf2f6;color:#1d3c50;padding:32px clamp(18px,3vw,48px) 48px}
  .page-header{max-width:1600px;margin:0 auto 27px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-family:'DM Serif Display',Georgia,serif;font-size:30px;text-decoration:none;display:block;margin-bottom:11px}h1{font-size:28px;letter-spacing:-.7px;font-weight:600}.page-header p{font-size:14px;line-height:1.65;color:#4e6b7e;margin-top:8px}.back-link{font-size:13px;white-space:nowrap;text-underline-offset:4px}
  .workspace{max-width:1600px;margin:auto;display:grid;grid-template-columns:300px minmax(0,1fr);gap:24px;align-items:start}aside{min-width:0}.scenario,.route-panel,.map-panel{border:1px solid #bdceda;border-radius:12px;background:#fff}.scenario summary{padding:17px 18px;font-size:15px;font-weight:600;cursor:pointer}.scenario-content{padding:0 18px 20px;border:0;margin:0;min-width:0}.presets{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 20px}.presets button{font-size:11px;min-height:34px;padding:7px 9px;background:#e4edf3;border:1px solid #9fb9c9;border-radius:5px;color:#264d67;cursor:pointer}.presets button:hover{background:#cfe2ed}
  .control{display:block;margin-top:17px}.control>span{display:block;font-size:12px;font-weight:600;margin-bottom:7px}.control select{width:100%;min-width:0;padding:10px 8px;border:1px solid #8da9bb;border-radius:5px;background:#fff;color:#23485f;font-size:12px;min-height:40px}.control select:disabled{background:#edf1f4;color:#6a7d89}.check{display:flex;align-items:center;gap:9px;font-size:12px;line-height:1.5;cursor:pointer}.check input{width:16px;height:16px;accent-color:#176d91;flex-shrink:0}.check:has(input:disabled){color:#687e8c;cursor:default}input:focus-visible{outline:3px solid #4b93c4;outline-offset:3px}.scenario-note{font-size:11px;line-height:1.65;color:#536e80;margin-top:19px}
  .route-panel{margin-top:18px;padding:18px}.route-panel h2{font-size:14px;display:flex;justify-content:space-between;align-items:center;gap:8px}.route-panel h2>span{font-size:11px;color:#416983;font-weight:400}.route-panel ol{list-style:none;margin:19px 0 0;padding:0}.route-panel li{display:flex;gap:10px;align-items:start;font-size:12px;line-height:1.5;position:relative;padding-bottom:16px}.route-panel li:not(:last-child):before{content:'';position:absolute;left:10px;top:23px;bottom:3px;width:1px;background:#b7cdd9}.number{display:grid;place-items:center;min-width:22px;height:22px;border-radius:50%;background:#dcecf5;color:#1e607f;font-size:10px}.route-panel small{display:block;font-size:10px;color:#536e80;margin-top:4px}.route-panel li:last-child{padding-bottom:0}
  .map-panel{overflow:hidden;min-width:0}.map-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 20px}.map-toolbar h2{font-size:16px;font-weight:600}.legend{display:flex;gap:17px;margin-top:8px}.legend>span{display:flex;align-items:center;gap:6px;font-size:11px;color:#4b697d}.legend i{width:9px;height:9px;border:1px dashed #718c9c;background:#fff;border-radius:2px}.legend .selected-key{border:1px solid #176d91;background:#d4eaf4}.zoom-controls{display:flex;align-items:center;gap:6px}.zoom-controls button{height:34px;min-width:32px;border:1px solid #9db6c6;border-radius:5px;color:#244c67;background:#f6f9fb;cursor:pointer;font-size:12px;padding:5px 9px}.zoom-controls button:disabled{opacity:.45;cursor:default}.zoom-controls output{font-family:var(--font-mono);font-size:11px;min-width:38px;text-align:center}.map-options{padding:0 20px 14px;display:flex;gap:15px;justify-content:space-between;align-items:center}.map-options>span{font-size:11px;color:#567283}
  .map-viewport{overflow:auto;height:76vh;min-height:430px;max-height:950px;overscroll-behavior:contain;border-block:1px solid #c7d7e0;background-color:#f5f8fa;background-image:radial-gradient(#a3bbc644 1px,transparent 1px);background-size:18px 18px}.map-viewport:focus-visible{outline:3px solid #4b93c4;outline-offset:-3px}.scale-space{position:relative;margin:16px}.graph-stage{position:absolute;left:0;top:0;transform-origin:top left}.edges{position:absolute;inset:0;overflow:visible;pointer-events:none}.edges>path{fill:none;stroke:#a6b8c3;stroke-width:1.5;stroke-dasharray:5 4;stroke-linecap:round;stroke-linejoin:round}.edges>path.active{stroke:#176d91;stroke-width:3;stroke-dasharray:none}
  .node{position:absolute;border:1px dashed #9db3c1;border-radius:9px;background:#fff;padding:14px 16px;color:#365669;box-shadow:0 3px 10px #183c5005}.node.active{border:2px solid #237294;background:#e7f2f8;padding:13px 15px;color:#163e56;box-shadow:0 3px 13px #183c500d}.node-meta{display:flex;justify-content:space-between;gap:12px;font-family:var(--font-mono);font-size:10px;line-height:1.4;margin-bottom:9px;color:#526f82}.node.active .node-meta{color:#1d6383}.node h3{font-size:16px;font-weight:600;line-height:1.3;letter-spacing:-.2px}.node p{font-size:12px;line-height:1.45;margin-top:9px}.node .detail{font-size:11px;line-height:1.4;margin-top:6px;color:#496b80}
  .map-notes{padding:18px 20px}.map-notes p{font-size:12px;line-height:1.7;color:#4f6c7f}.map-notes p+p{margin-top:8px}.map-notes strong{font-weight:600;color:#244b63}
  @media(max-width:1100px){.workspace{grid-template-columns:260px minmax(0,1fr);gap:16px}.map-toolbar{flex-wrap:wrap}.map-options{align-items:start;flex-direction:column;gap:7px}}
  @media(max-width:800px){.qgraph{padding-top:24px}.page-header{align-items:start}.page-header p{font-size:13px}h1{font-size:24px}.workspace{grid-template-columns:1fr}aside{display:contents}.scenario{grid-row:1}.map-panel{grid-row:2}.route-panel{grid-row:3;margin-top:0}.scenario-content{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}.presets,.scenario-note{grid-column:1/-1;margin:0}.control{margin:0}.map-viewport{height:70svh;min-height:360px}.map-toolbar{padding:16px}.map-options{padding-inline:16px}.back-link{font-size:12px}}
  @media(max-width:420px){.page-header{flex-direction:column;gap:14px}.scenario-content{grid-template-columns:1fr}.presets,.scenario-note{grid-column:auto}.legend{gap:12px}.map-toolbar{gap:14px}}
</style>
