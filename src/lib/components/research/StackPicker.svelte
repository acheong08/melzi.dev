<script lang="ts">
  import { tick } from 'svelte';
  import { stackCatalog, matchingTools, canonicalTool, normalizeTool, addStackTool } from '#lib/research/stack-tools.js';
  let { selected=$bindable<string[]>([]), details=$bindable('') } = $props();
  let query=$state('');
  let notice=$state('');
  let search:HTMLInputElement;
  const results=$derived(matchingTools(query));
  const candidate=$derived(canonicalTool(query));
  const exactKnown=$derived(stackCatalog.some(tool=>normalizeTool(tool.name)===normalizeTool(candidate)));
  const alreadySelected=$derived(selected.some(tool=>normalizeTool(tool)===normalizeTool(candidate)));
  function toggle(name:string){
    if(selected.includes(name)){selected=selected.filter(tool=>tool!==name);notice=`${name} removed.`;}
    else add(name,false);
  }
  function add(name:string,clear=true){
    const updated=addStackTool(selected,name);
    if(updated===selected){notice=selected.length>=32?'You can select up to 32 tools.':'That tool is already selected.';return;}
    selected=updated;notice=`${canonicalTool(name)} added.`;
    if(clear){query='';search.focus({preventScroll:true});}
  }
  async function remove(name:string){selected=selected.filter(tool=>tool!==name);notice=`${name} removed.`;await tick();search.focus({preventScroll:true});}
  function onSearchKey(event:KeyboardEvent){
    if(event.key!=='Enter'||event.isComposing)return;
    event.preventDefault();event.stopPropagation();
    if(!query.trim())return;
    if(exactKnown)add(candidate);
    else if(results.length===1)add(results[0].name);
    else if(results.length===0)add(candidate);
    else notice='Choose a matching tool, or add your own below.';
  }
</script>

<div class="stack-picker">
  <label class="field-label" for="stack-search">Search tools</label>
  <input bind:this={search} id="stack-search" type="search" name="stackSearch" bind:value={query} oninput={()=>notice=''} onkeydown={onSearchKey} maxlength="80" autocomplete="off" placeholder="Search or add a tool" aria-describedby="stack-search-help" aria-controls="stack-results" />
  <p id="stack-search-help" class="hint">Choose any that apply. You can add something that isn’t listed.</p>
  {#if selected.length}
    <div class="selected-tools" aria-label="Selected tools">
      {#each selected as name}<button type="button" aria-label={`Remove ${name}`} onclick={()=>remove(name)}><span>{name}</span><span aria-hidden="true">×</span></button>{/each}
    </div>
  {/if}
  <fieldset id="stack-results">
    <legend>{query.trim()?'Matching tools':'Suggestions'}</legend>
    <div class="tool-grid">
      {#each results as tool}
        <label class:chosen={selected.includes(tool.name)}><input type="checkbox" name="stackTools" value={tool.name} checked={selected.includes(tool.name)} onchange={()=>toggle(tool.name)} /><span>{tool.name}</span></label>
      {/each}
    </div>
    {#if !results.length}<p class="no-results">No matching suggestions.</p>{/if}
    {#if query.trim() && !exactKnown && !alreadySelected}<button class="add-tool" type="button" onclick={()=>add(candidate)}>Add “{candidate}”</button>{/if}
    {#if query.trim() && alreadySelected}<p class="hint">Already selected.</p>{/if}
  </fieldset>
  <p class="sr-only" role="status" aria-live="polite">{notice}</p>
  <div class="stack-details">
    <label class="field-label" for="stack-details">Anything else in your stack? <span>(optional)</span></label>
    <p class="hint" id="stack-details-help">Frameworks, databases, tools, scripts, or anything missing above.</p>
    <textarea id="stack-details" name="stack" bind:value={details} maxlength="2000" rows="3" aria-describedby="stack-details-help"></textarea>
  </div>
</div>
<style>
  .field-label{display:block;font-size:13px;font-weight:600;line-height:1.5;color:#294c63;margin-bottom:8px}.field-label>span{font-weight:400;color:#567183}
  input[type=search],textarea{display:block;width:100%;font:inherit;font-size:16px;line-height:1.5;padding:11px 13px;border:1px solid #91acbd;border-radius:8px;background:#fff;color:#183a51}input::placeholder{color:#657f90}input[type=search]:focus-visible,textarea:focus-visible{outline:3px solid #4b93c4;outline-offset:3px}
  .hint{font-size:12px;line-height:1.6;color:#526e80;margin:8px 0 13px}.selected-tools{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0}.selected-tools button{display:flex;align-items:center;gap:9px;max-width:100%;min-height:36px;padding:6px 10px;border:1px solid #527d98;border-radius:6px;background:#dceaf3;color:#1d425b;font:inherit;font-size:12px;cursor:pointer}.selected-tools button>span:first-child{overflow-wrap:anywhere;min-width:0}.selected-tools button>span:last-child{font-size:17px}.selected-tools button:hover{background:#cadfec}
  fieldset{margin:0;padding:0;border:0;min-width:0}legend{font-size:12px;color:#48687c;margin-bottom:9px;padding:0}.tool-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.tool-grid label{display:flex;align-items:center;gap:9px;padding:10px 12px;min-height:43px;border:1px solid #bbceda;border-radius:7px;background:#fff;color:#264b64;font-size:13px;cursor:pointer}.tool-grid label:hover{border-color:#537f9b;background:#edf4f8}.tool-grid label.chosen{border-color:#315d79;background:#e3eef5;box-shadow:inset 0 0 0 1px #315d79}.tool-grid input{width:16px;height:16px;margin:0;accent-color:#214c6b;flex-shrink:0}.tool-grid label:has(input:focus-visible){outline:3px solid #4b93c4;outline-offset:2px}.tool-grid input:focus-visible{outline:none}
  .add-tool{font:inherit;font-size:13px;line-height:1.5;text-align:left;overflow-wrap:anywhere;max-width:100%;min-height:42px;background:#123c5b;border:1px solid #123c5b;border-radius:7px;color:#fff;padding:9px 13px;margin-top:10px;cursor:pointer}.add-tool:hover{background:#205879}.no-results{font-size:13px;color:#526e80;margin:5px 0}.stack-details{margin-top:22px}textarea{resize:vertical;min-height:90px;max-height:240px}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:480px){.tool-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tool-grid label{padding:9px;font-size:12px;gap:7px}.hint{font-size:11px}.stack-details{margin-top:18px}}
</style>
