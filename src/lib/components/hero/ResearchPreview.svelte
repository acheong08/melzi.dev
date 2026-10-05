<script lang="ts">
  import ResearchForm from '../research/ResearchForm.svelte';
  let { open, onclose }: { open:boolean; onclose:()=>void } = $props();
  let dialog:HTMLDialogElement;
  let form:{focusCurrent:()=>Promise<void>};
  function trapFocus(event:KeyboardEvent){
    if(event.key!=='Tab'||event.ctrlKey||event.metaKey||event.altKey)return;
    const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], iframe, [tabindex="0"]')).filter(el=>el.getClientRects().length>0);
    const first=controls[0],last=controls[controls.length-1];
    if(!first)return;
    if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement as HTMLElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  $effect(()=>{
    if(!dialog)return;
    if(open&&!dialog.open){dialog.showModal();void form?.focusCurrent();}
    else if(!open&&dialog.open)dialog.close();
  });
</script>

<dialog bind:this={dialog} onclose={onclose} onkeydown={trapFocus} aria-labelledby="research-title">
  <button type="button" class="close" aria-label="Close research form" onclick={()=>dialog.close()}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.6"/></svg></button>
  <ResearchForm bind:this={form} onclose={()=>dialog.close()} />
</dialog>

<style>
  dialog{width:calc(100% - 32px);max-width:590px;max-height:calc(100dvh - 32px);border:1px solid #c5d6e1;border-radius:15px;background:#f5f8fa;padding:0;color:#1e3d52;box-shadow:0 25px 100px #051a3b70;overflow:hidden}
  dialog::backdrop{background:#041329a6;backdrop-filter:blur(6px)}
  .close{position:absolute;top:20px;right:20px;display:grid;place-items:center;width:32px;height:32px;padding:0;background:#e3ecf2;border:1px solid #b0c5d2;border-radius:6px;color:#274c67;cursor:pointer;z-index:1}.close:hover{background:#ccdfe9}
  @media(max-width:480px){dialog{width:calc(100% - 20px);border-radius:12px}.close{right:12px;top:16px;width:30px;height:30px}}
  @media(max-height:640px){.close{top:12px}}
</style>
