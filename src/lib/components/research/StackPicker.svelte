<script lang="ts">
  import { tick } from 'svelte';
  import { stackCatalog, matchingTools, canonicalTool, normalizeTool, addStackTool } from '#lib/research/stack-tools.js';
  import { stackWhyOptions } from '#lib/research/form.js';
  let { selected=$bindable<string[]>([]), details=$bindable(''), why=$bindable<string[]>([]), whyOther=$bindable('') } = $props();
  let query=$state('');
  let notice=$state('');
  let search:HTMLInputElement;
  const results=$derived(matchingTools(query));
  const candidate=$derived(canonicalTool(query));
  const exactKnown=$derived(stackCatalog.some(tool=>normalizeTool(tool.name)===normalizeTool(candidate)));
  const alreadySelected=$derived(selected.some(tool=>normalizeTool(tool)===normalizeTool(candidate)) || (normalizeTool(candidate)==='other' && selected.includes('Other')));
  const otherSelected=$derived(selected.includes('Other'));
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
  async function remove(name:string){selected=selected.filter(tool=>tool!==name);await tick();search.focus({preventScroll:true});}
  function onSearchKey(event:KeyboardEvent){
    if(event.key!=='Enter'||event.isComposing)return;
    event.preventDefault();event.stopPropagation();
    if(!query.trim())return;
    if(exactKnown)add(candidate);
    else if(results.length===1)add(results[0].name);
    else if(results.length===0)add(candidate);
    else notice='Choose a matching tool, or add your own below.';
  }
  function toggleWhy(value:string){
    why=why.includes(value)?why.filter(reason=>reason!==value):[...why,value];
    if(!why.includes('other'))whyOther='';
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
  <div class="other-tool">
    <label class="tool-chip" class:chosen={otherSelected}><input type="checkbox" name="stackOther" checked={otherSelected} onchange={()=>otherSelected?remove('Other'):add('Other',false)} /><span>Other</span></label>
    {#if otherSelected}
      <div class="other-details">
        <label class="field-label" for="stack-other-details">What do you use that isn’t listed? <span>(optional)</span></label>
        <textarea id="stack-other-details" name="stack" bind:value={details} maxlength="2000" rows="3" placeholder="Name it, or describe it briefly"></textarea>
      </div>
    {/if}
  </div>
  <p class="sr-only" role="status" aria-live="polite">{notice}</p>
  {#if selected.length}
    <fieldset class="stack-why">
      <legend>Why did you choose this stack? <span>(choose any that apply)</span></legend>
      <div class="why-grid">
        {#each stackWhyOptions as option}
          <label class:chosen={why.includes(option.value)}><input type="checkbox" name="stackWhy" value={option.value} checked={why.includes(option.value)} onchange={()=>toggleWhy(option.value)} /><span>{option.label}</span></label>
        {/each}
      </div>
      {#if why.includes('other')}
        <div class="other-details">
          <label class="field-label" for="stack-why-other">What’s the other reason? <span>(optional)</span></label>
          <textarea id="stack-why-other" name="stackWhyOther" bind:value={whyOther} maxlength="2000" rows="2" placeholder="Tell us in your own words"></textarea>
        </div>
      {/if}
    </fieldset>
  {/if}
</div>
<style>
  .field-label{display:block;font-size:13px;font-weight:600;line-height:1.5;color:#294c63;margin-bottom:8px}.field-label>span{font-weight:400;color:#567183}
  input[type=search],textarea{display:block;width:100%;font:inherit;font-size:16px;line-height:1.5;padding:11px 13px;border:1px solid #91acbd;border-radius:8px;background:#fff;color:#183a51}input::placeholder,textarea::placeholder{color:#657f90}input[type=search]:focus-visible,textarea:focus-visible{outline:3px solid #4b93c4;outline-offset:3px}
  .hint{font-size:12px;line-height:1.6;color:#526e80;margin:8px 0 13px}.selected-tools{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0}.selected-tools button{display:flex;align-items:center;gap:9px;max-width:100%;min-height:36px;padding:6px 10px;border:1px solid #527d98;border-radius:6px;background:#dceaf3;color:#1d425b;font:inherit;font-size:12px;cursor:pointer}.selected-tools button>span:first-child{overflow-wrap:anywhere;min-width:0}.selected-tools button>span:last-child{font-size:17px}.selected-tools button:hover{background:#cadfec}
  fieldset{margin:0;padding:0;border:0;min-width:0}legend{font-size:12px;color:#48687c;margin-bottom:9px;padding:0}legend>span{color:#567183}.tool-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.tool-grid label{display:flex;align-items:center;gap:9px;padding:10px 12px;min-height:43px;border:1px solid #bbceda;border-radius:7px;background:#fff;color:#264b64;font-size:13px;cursor:pointer}.tool-grid label:hover{border-color:#537f9b;background:#edf4f8}.tool-grid label.chosen{border-color:#315d79;background:#e3eef5;box-shadow:inset 0 0 0 1px #315d79}.tool-grid input{width:16px;height:16px;margin:0;accent-color:#214c6b;flex-shrink:0}.tool-grid label:has(input:focus-visible){outline:3px solid #4b93c4;outline-offset:2px}.tool-grid input:focus-visible{outline:none}
  .add-tool{font:inherit;font-size:13px;line-height:1.5;text-align:left;overflow-wrap:anywhere;max-width:100%;min-height:42px;background:#123c5b;border:1px solid #123c5b;border-radius:7px;color:#fff;padding:9px 13px;margin-top:10px;cursor:pointer}.add-tool:hover{background:#205879}.no-results{font-size:13px;color:#526e80;margin:5px 0}
  .other-tool{margin-top:14px}.tool-chip{display:inline-flex;align-items:center;gap:9px;padding:10px 14px;min-height:43px;border:1px solid #bbceda;border-radius:7px;background:#fff;color:#264b64;font-size:13px;cursor:pointer}.tool-chip:hover{border-color:#537f9b;background:#edf4f8}.tool-chip.chosen{border-color:#315d79;background:#e3eef5;box-shadow:inset 0 0 0 1px #315d79}.tool-chip input{width:16px;height:16px;margin:0;accent-color:#214c6b}.tool-chip:has(input:focus-visible){outline:3px solid #4b93c4;outline-offset:2px}.tool-chip input:focus-visible{outline:none}
  .stack-why{margin-top:22px}.why-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.why-grid label{display:flex;align-items:center;gap:9px;padding:10px 12px;min-height:43px;border:1px solid #bbceda;border-radius:7px;background:#fff;color:#264b64;font-size:13px;cursor:pointer}.why-grid label:hover{border-color:#537f9b;background:#edf4f8}.why-grid label.chosen{border-color:#315d79;background:#e3eef5;box-shadow:inset 0 0 0 1px #315d79}.why-grid input{width:16px;height:16px;margin:0;accent-color:#214c6b;flex-shrink:0}.why-grid label:has(input:focus-visible){outline:3px solid #4b93c4;outline-offset:2px}.why-grid input:focus-visible{outline:none}
  .other-details{margin-top:14px}textarea{resize:vertical;min-height:90px;max-height:240px}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:480px){.tool-grid,.why-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tool-grid label,.why-grid label{padding:9px;font-size:12px;gap:7px}.hint{font-size:11px}.other-tool{margin-top:10px}.stack-why{margin-top:18px}}
</style>
