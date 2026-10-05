<script lang="ts">
  import { tick, onMount, untrack } from 'svelte';
  import { getDraftPersistence, finalValidation, saveStatus, type DraftPersistence, type PersistenceView } from '#lib/research/persistence.js';
  import { ManagedTurnstile } from '#lib/research/turnstile.js';
  import { securityProviderFor } from '#lib/research/provider-config.js';
  import ChoiceField from './ChoiceField.svelte';
  import StackPicker from './StackPicker.svelte';
  import { choices, emptyAnswers, stepsFor, questionFor, textQuestionFor, isOptional, changeAnswer, skipAnswer, responseFor, summaryFor, type SingleField, type Step } from '#lib/research/form.js';
  let { onclose }: { onclose:()=>void } = $props();
  let answers=$state(emptyAnswers());
  let step=$state<Step>('context');
  let complete=$state(false);
  let hydrated=$state(false);
  let persistence:DraftPersistence;
  const usesTurnstile=securityProviderFor(import.meta.env.VITE_RESEARCH_SECURITY_PROVIDER)==='turnstile';
  let verification:ManagedTurnstile|undefined;
  let verificationContainer=$state<HTMLDivElement>();
  let verificationActive=$state(false);
  let save=$state<PersistenceView>({draft:null,state:'idle',warning:'',submitted:false,submitting:false});
  let submissionRequested=$state(false);
  onMount(()=>{
    if(usesTurnstile)verification=new ManagedTurnstile(()=>verificationContainer,active=>verificationActive=active);
    persistence=getDraftPersistence(()=>verification?verification.token():Promise.reject(new Error('Verification is not configured')));
    const unsubscribe=persistence.subscribe(view=>{
      const newlySubmitted=view.submitted&&!complete;
      save=view;
      complete=view.submitted;
      submissionRequested=view.submitting;
      if(newlySubmitted)void focusCurrent();
    });
    const draft=persistence.view.draft;
    if(draft){answers=draft.answers;step=draft.step;}
    hydrated=true;
    const dialog=body.closest('dialog');
    const flush=()=>{void persistence.flush(true);};
    dialog?.addEventListener('close',flush);
    return ()=>{unsubscribe();dialog?.removeEventListener('close',flush);};
  });
  $effect(()=>{
    const current=JSON.stringify(answers),currentStep=step,ready=hydrated;
    if(ready)untrack(()=>persistence.update(JSON.parse(current),currentStep,submissionRequested));
  });
  let error=$state('');
  let body:HTMLDivElement;
  let heading:HTMLHeadingElement;
  let emailInput=$state<HTMLInputElement>();
  const steps=$derived(stepsFor(answers));
  const index=$derived(steps.indexOf(step));
  const question=$derived(questionFor(step,answers));
  const textQuestion=$derived(textQuestionFor(step,answers));
  const optional=$derived(isOptional(step));
  const title=$derived(complete?'Thanks for helping shape Melzi.':question?.title??textQuestion?.title??(step==='startup'?'A little about your team':'Where can we reach you?'));

  export async function focusCurrent(){await tick();if(body)body.scrollTop=0;heading?.focus({preventScroll:true});}
  function choose(field:SingleField,value:string){answers=changeAnswer(answers,field,value);error='';}
  function advance(){
    const current=stepsFor(answers);const next=current[current.indexOf(step)+1];
    error='';
    if(next){step=next;persistence.update(answers,step,false);void persistence.flush();}
    else {
      const invalid=finalValidation(answers);
      if(invalid){step=invalid;error=invalid==='contact'?'Enter a valid email address.':'Choose an option to continue.';}
      else {submissionRequested=true;persistence.update(answers,step,true);void persistence.flush();}
    }
    void focusCurrent();
  }
  function submit(event:SubmitEvent){
    event.preventDefault();
    if(question&&!optional&&!answers[question.field]){error='Choose an option to continue.';return;}
    if(step==='contact'&&(!answers.email.trim()||!emailInput?.validity.valid)){error=answers.email.trim()?'Enter a valid email address.':'Enter your email address.';emailInput?.focus();return;}
    advance();
  }
  function skip(){answers=skipAnswer(answers,step);advance();}
  function back(){error='';submissionRequested=false;if(complete)complete=false;else if(index>0)step=steps[index-1];persistence.update(answers,step,false);void persistence.flush();void focusCurrent();}
  function restart(){
    if(!window.confirm('Clear the draft on this device? This does not delete any responses already saved to the server. Download your answers first if you want a copy.'))return;
    verification?.reset();persistence.clearLocal();answers=emptyAnswers();step='context';complete=false;submissionRequested=false;error='';void focusCurrent();
  }
  async function reloadSaved(){
    if(!window.confirm('Replace the answers shown here with the saved draft? Download your current answers first if you want to keep them.'))return;
    await persistence.reloadSaved();const draft=persistence.view.draft;
    answers=draft?.answers??emptyAnswers();step=draft?.step??'context';error='';void focusCurrent();
  }
  function freshSession(){verification?.reset();persistence.freshSession();submissionRequested=false;complete=false;}
  function close(){void persistence.flush(true);onclose();}
  function download(){
    const url=URL.createObjectURL(new Blob([JSON.stringify(responseFor(answers),null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='melzi-research-response.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
</script>

<form class="research-form" onsubmit={submit} novalidate>
  <div class="form-header"><span class="wordmark">Melzi</span><span class="save-note" role="status" aria-live="polite">{saveStatus(save)}</span></div>
  <div class="question-body" bind:this={body}>
    {#if step==='context' && !complete}<p class="privacy-note">Responses save as you go, including unfinished responses. Server drafts are kept for 30 days after activity and completed responses for 365 days. This device also keeps a draft unless you or your browser clear its storage. Email is only used for the follow-up you select. <a href="/privacy" target="_blank" rel="noopener">Privacy details</a></p>{/if}
    {#if !complete}<p class="step-label">Question {index+1}{#if optional}<span>Optional</span>{/if}</p>{/if}
    <h2 id="research-title" bind:this={heading} tabindex="-1">{title}</h2>
    {#if complete}
      <p class="helper">Your feedback has been saved. Download your answers to keep a copy, or go back to edit them.</p>
      <dl class="response-summary">{#each summaryFor(answers) as [label,value]}<div><dt>{label}</dt><dd>{value}</dd></div>{/each}</dl>
    {:else if question}
      {#if step==='spend'}<p class="helper">A rough estimate in USD is fine.</p>{/if}
      <ChoiceField name={question.field} label="Choose one" options={question.options} value={answers[question.field]} onchange={value=>choose(question.field,value)} />
      {#if step==='context' && answers.context==='other'}
        <div class="workaround-details"><label class="input-label" for="context-details">What are you working on? <span>(optional)</span></label><textarea id="context-details" name="contextDetails" bind:value={answers.contextDetails} maxlength="2000" rows="3" placeholder="Tell us a little about it"></textarea></div>
      {/if}
      {#if step==='problem' && answers.problemCategory==='other'}
        <div class="workaround-details"><label class="input-label" for="problem-details">What’s frustrating you? <span>(optional)</span></label><textarea id="problem-details" name="problem" bind:value={answers.problem} maxlength="2000" rows="4" placeholder="Tell us in your own words"></textarea></div>
      {/if}
      {#if step==='workaround' && answers.workaround==='tried'}
        <div class="workaround-details"><label class="input-label" for="workaround-details">What have you tried? <span>(optional)</span></label><textarea id="workaround-details" name="workaroundDetails" bind:value={answers.workaroundDetails} maxlength="2000" rows="4" placeholder="Tools, changes, workarounds, or help you’ve brought in"></textarea></div>
      {/if}
    {:else if step==='stack'}
      <StackPicker bind:selected={answers.stackTools} bind:details={answers.stack} />
    {:else if textQuestion}
      <p class="helper" id="text-help">{textQuestion.hint}</p>
      <label class="sr-only" for="open-answer">{textQuestion.title}</label>
      <textarea id="open-answer" name={textQuestion.field} bind:value={answers[textQuestion.field]} maxlength="2000" rows="6" aria-describedby="text-help" placeholder={textQuestion.placeholder}></textarea>
    {:else if step==='startup'}
      <div class="team-fields"><ChoiceField name="role" label="What’s your role?" options={choices.role} value={answers.role} onchange={value=>choose('role',value)} /><ChoiceField name="owner" label="Who handles infrastructure?" options={choices.owner} value={answers.owner} onchange={value=>choose('owner',value)} /></div>
    {:else if step==='contact'}
      <label class="input-label" for="research-email">Email address</label>
      <input bind:this={emailInput} id="research-email" name="email" type="email" required autocomplete="email" maxlength="254" bind:value={answers.email} aria-invalid={error?true:undefined} aria-describedby={error?'form-error':undefined} oninput={()=>error=''} placeholder="you@example.com" />
    {/if}
    {#if error}<p id="form-error" class="error" role="alert">{error}</p>{/if}
    {#if save.submitting}<p class="save-help" role="status">Submission pending. Your feedback is not submitted until the server confirms it. {save.state==='offline'?'Connect to the internet to submit.':'You can keep this form open or return later.'}</p>{/if}
    {#if save.warning}<p class="save-warning" role="alert">{save.warning}</p>{/if}
    {#if ['retrying','offline','storage','verification'].includes(save.state)}<button class="secondary" type="button" onclick={()=>persistence.retry()}>Retry save</button>{/if}
    {#if save.state==='conflict'}<button class="secondary" type="button" onclick={reloadSaved}>Reload saved draft</button>{/if}
    {#if ['expired','invalid'].includes(save.state)}<button class="secondary" type="button" onclick={freshSession}>Start a fresh session with these answers</button>{/if}
    {#if usesTurnstile}<div class="verification" aria-label="Save verification">
      {#if verificationActive}<p class="save-help">Complete the verification below to save your responses. If you close this form, return here if verification needs your attention.</p>{/if}
      <div bind:this={verificationContainer}></div>
    </div>{/if}
  </div>
  <footer>
    {#if complete}
      <div class="footer-row"><button class="secondary" type="button" onclick={back}>Back to edit</button><button class="primary" type="button" onclick={download}>Download answers <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v11m-4-4 4 4 4-4M3 14v4h14v-4"/></svg></button></div>
      <div class="finish-links"><button type="button" onclick={restart}>Clear local draft</button><button type="button" onclick={close}>Close</button></div>
    {:else}
      <div class="footer-row"><button class="secondary" type="button" onclick={back} disabled={!hydrated||index===0}>Back</button><div class="forward-actions">{#if optional && index!==steps.length-1}<button class="skip" type="button" onclick={skip} disabled={!hydrated}>Skip</button>{/if}<button class="primary" type="submit" disabled={!hydrated}>{index===steps.length-1?'Submit feedback':'Continue'}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14m-5-5 5 5-5 5"/></svg></button></div></div>
      <div class="finish-links"><button type="button" onclick={download}>Download answers</button><button type="button" onclick={restart}>Clear local draft</button></div>
    {/if}
  </footer>
</form>
<style>
  .research-form{display:flex;flex-direction:column;max-height:calc(100dvh - 32px);min-height:0;color:#1e3d52}
  .form-header{padding:22px 64px 20px 30px;display:flex;align-items:center;gap:18px;border-bottom:1px solid #d5e0e6;flex-shrink:0}.wordmark{font-family:'DM Serif Display',Georgia,serif;font-size:29px;line-height:1}.save-note{font-size:11px;line-height:1.5;color:#526c7d}
  .question-body{padding:25px 30px 28px;overflow-y:auto;min-height:0;overscroll-behavior:contain}.step-label{font-size:11px;color:#4f6d81;margin-bottom:13px;display:flex;gap:11px;align-items:center}.step-label span{border-left:1px solid #a8bdca;padding-left:11px}
  h2{font-size:clamp(23px,3vw,30px);font-weight:500;letter-spacing:-.7px;line-height:1.23;margin:0 0 23px;outline:none;text-wrap:balance}.helper{font-size:13px;line-height:1.65;color:#506b7e;margin:-10px 0 22px}.team-fields{display:grid;gap:27px}
  textarea,input[type=email]{width:100%;border:1px solid #91acbd;border-radius:8px;background:#fff;color:#183a51;font:inherit;font-size:15px;line-height:1.6;padding:13px 15px}textarea{resize:vertical;min-height:150px;max-height:300px}textarea::placeholder,input::placeholder{color:#657f90}textarea:focus-visible,input[type=email]:focus-visible{outline:3px solid #4b93c4;outline-offset:3px}.input-label{display:block;font-size:13px;font-weight:600;margin-bottom:10px}.input-label span{font-weight:400;color:#526c7d}.error{color:#9b2e35;font-size:13px;line-height:1.5;margin-top:16px}
  footer{border-top:1px solid #d5e0e6;padding:18px 30px;background:#edf3f6;flex-shrink:0}.footer-row{display:flex;justify-content:space-between;gap:12px;align-items:center}.forward-actions{display:flex;gap:10px;align-items:center}
  button{font:inherit;font-size:13px;cursor:pointer;min-height:44px;border-radius:7px;padding:11px 15px}.primary{display:flex;align-items:center;justify-content:center;gap:15px;background:#123c5b;color:#fff;border:1px solid #123c5b;font-weight:500}.primary:hover{background:#205879}.primary svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}.secondary{border:1px solid #a9bfcd;color:#264a64;background:#f9fcfd}.secondary:hover{background:#e0ebf2}.secondary:disabled{opacity:.45;cursor:default}.skip,.finish-links button{border:0;background:transparent;color:#355d77;text-decoration:underline;text-underline-offset:3px}.skip:hover,.finish-links button:hover{color:#102f45}
  .finish-links{display:flex;justify-content:space-between;margin-top:9px}.finish-links button{padding:6px 0;font-size:12px;min-height:36px}.response-summary{margin:0;display:grid;gap:0}.response-summary>div{padding:13px 0;border-top:1px solid #d4e0e7}dt{font-size:11px;color:#567184;margin-bottom:5px}dd{font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
  .workaround-details{margin-top:22px}
  .privacy-note,.save-help,.save-warning{font-size:12px;line-height:1.6;color:#506b7e;margin:0 0 18px}.privacy-note a{color:#123c5b;text-underline-offset:3px}.save-warning{color:#9b2e35;margin-top:16px}.save-help{margin-top:16px}.verification{max-width:100%;margin-top:12px}.verification:empty{display:none}button:disabled{opacity:.5;cursor:default}
  @media(max-width:480px){textarea,input[type=email]{font-size:16px}}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:480px){.form-header{padding:20px 50px 18px 19px;gap:12px}.wordmark{font-size:25px}.save-note{font-size:10px;max-width:140px}.question-body{padding:20px 19px 23px}h2{font-size:25px;margin-bottom:20px}.helper{font-size:12px}footer{padding:14px 16px}button{padding:10px 12px;font-size:12px}.primary{gap:9px}.forward-actions{gap:5px}}
  @media(max-height:640px){textarea{height:140px;min-height:120px}.form-header{padding-top:15px;padding-bottom:14px}.question-body{padding-top:18px;padding-bottom:18px}footer{padding-top:12px;padding-bottom:12px}}
</style>
