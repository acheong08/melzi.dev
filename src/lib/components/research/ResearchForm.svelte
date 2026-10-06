<script lang="ts">
import { tick, onMount, untrack } from "svelte";
import {
	getDraftPersistence,
	finalValidation,
	saveStatus,
	type DraftPersistence,
	type PersistenceView,
} from "#lib/research/persistence.js";
import { ManagedTurnstile } from "#lib/research/turnstile.js";
import { securityProviderFor } from "#lib/research/provider-config.js";
import ChoiceField from "./ChoiceField.svelte";
import StackPicker from "./StackPicker.svelte";
import {
	choices,
	emptyAnswers,
	stepsFor,
	questionFor,
	textQuestionFor,
	isOptional,
	changeAnswer,
	changeMultiAnswer,
	problemFieldQuestion,
	skipAnswer,
	type SingleField,
	type Step,
} from "#lib/research/form.js";
let { onclose }: { onclose: () => void } = $props();
let answers = $state(emptyAnswers());
let step = $state<Step>("context");
let complete = $state(false);
let hydrated = $state(false);
let persistence: DraftPersistence;
const usesTurnstile =
	securityProviderFor(import.meta.env.VITE_RESEARCH_SECURITY_PROVIDER) ===
	"turnstile";
let verification: ManagedTurnstile | undefined;
let verificationContainer = $state<HTMLDivElement>();
let verificationActive = $state(false);
let save = $state<PersistenceView>({
	draft: null,
	state: "idle",
	warning: "",
	submitted: false,
	submitting: false,
});
let submissionRequested = $state(false);
onMount(() => {
	if (usesTurnstile)
		verification = new ManagedTurnstile(
			() => verificationContainer,
			(active) => (verificationActive = active),
		);
	persistence = getDraftPersistence(() =>
		verification
			? verification.token()
			: Promise.reject(
					new Error(
						"Verification is not configured",
					),
				),
	);
	const unsubscribe = persistence.subscribe((view) => {
		const newlySubmitted = view.submitted && !complete;
		save = view;
		complete = view.submitted;
		submissionRequested = view.submitting;
		if (newlySubmitted) void focusCurrent();
	});
	const draft = persistence.view.draft;
	if (draft) {
		answers = draft.answers;
		step = draft.step;
	}
	hydrated = true;
	const dialog = body.closest("dialog");
	const flush = () => {
		void persistence.flush(true);
	};
	dialog?.addEventListener("close", flush);
	return () => {
		unsubscribe();
		dialog?.removeEventListener("close", flush);
	};
});
$effect(() => {
	const current = JSON.stringify(answers),
		currentStep = step,
		ready = hydrated;
	if (ready)
		untrack(() =>
			persistence.update(
				JSON.parse(current),
				currentStep,
				submissionRequested,
			),
		);
});
let error = $state("");
let errorEl = $state<HTMLParagraphElement>();
$effect(() => {
	if (error) void scrollToError();
});
async function scrollToError() {
	await tick();
	errorEl?.scrollIntoView({ block: "nearest" });
}
let body: HTMLDivElement;
let heading: HTMLHeadingElement;
let emailInput = $state<HTMLInputElement>();
const steps = $derived(stepsFor(answers));
const index = $derived(steps.indexOf(step));
const left = $derived(steps.length - index);
const question = $derived(questionFor(step, answers));
const problemMulti = $derived(
	step === "problem" ? problemFieldQuestion(answers) : undefined,
);
const textQuestion = $derived(textQuestionFor(step, answers));
const optional = $derived(isOptional(step));
const note = $derived.by(() => {
	if (complete) return "Response saved.";
	if (
		[
			"offline",
			"retrying",
			"conflict",
			"expired",
			"invalid",
			"storage",
			"verification",
		].includes(save.state)
	)
		return saveStatus(save);
	return left < 5
		? left === 1
			? "Only 1 question left :)"
			: `Just a few questions left :)`
		: "This should only take 2 mins :)";
});
const title = $derived(
	complete
		? "Thanks for helping shape Melzi."
		: (question?.title ??
				problemMulti?.title ??
				textQuestion?.title ??
				(step === "stack"
					? "What are you building with today?"
					: step === "startup"
						? "A little about your team"
						: "Where can we reach you?")),
);

export async function focusCurrent() {
	await tick();
	if (body) body.scrollTop = 0;
	heading?.focus({ preventScroll: true });
}
function toggleProblemCategory(value: string) {
	const next = answers.problemCategory.includes(value)
		? answers.problemCategory.filter((v) => v !== value)
		: [...answers.problemCategory, value];
	answers = changeMultiAnswer(answers, next);
	error = "";
}
function choose(field: SingleField, value: string) {
	answers = changeAnswer(answers, field, value);
	error = "";
}
function advance() {
	const current = stepsFor(answers);
	const next = current[current.indexOf(step) + 1];
	error = "";
	if (next) {
		step = next;
		persistence.update(answers, step, false);
		void persistence.flush();
	} else {
		const invalid = finalValidation(answers);
		if (invalid) {
			step = invalid;
			error =
				invalid === "contact"
					? "Enter a valid email address."
					: "Choose an option to continue.";
		} else {
			submissionRequested = true;
			persistence.update(answers, step, true);
			void persistence.flush();
		}
	}
	void focusCurrent();
}
function submit(event: SubmitEvent) {
	event.preventDefault();
	if (question && !optional && !answers[question.field]) {
		error = "Choose an option to continue.";
		return;
	}
	if (problemMulti && !answers.problemCategory.length) {
		error = "Choose an option to continue.";
		return;
	}
	if (
		step === "stack" &&
		(!answers.stackTools.length || !answers.stackWhy.length)
	) {
		error = answers.stackTools.length
			? "Choose at least one reason to continue."
			: "Select at least one tool to continue.";
		return;
	}
	if (step === "startup" && !answers.owner) {
		error = "Choose an option to continue.";
		return;
	}
	if (
		step === "contact" &&
		(!answers.email.trim() || !emailInput?.validity.valid)
	) {
		error = answers.email.trim()
			? "Enter a valid email address."
			: "Enter your email address.";
		emailInput?.focus();
		return;
	}
	advance();
}
function skip() {
	answers = skipAnswer(answers, step);
	advance();
}
function back() {
	error = "";
	submissionRequested = false;
	if (index > 0) step = steps[index - 1];
	persistence.update(answers, step, false);
	void persistence.flush();
	void focusCurrent();
}
function restart() {
	if (
		!window.confirm(
			"Clear the draft on this device? This does not delete any responses already saved to the server.",
		)
	)
		return;
	verification?.reset();
	persistence.clearLocal();
	answers = emptyAnswers();
	step = "context";
	complete = false;
	submissionRequested = false;
	error = "";
	void focusCurrent();
}
async function reloadSaved() {
	if (
		!window.confirm(
			"Replace the answers shown here with the saved draft?",
		)
	)
		return;
	await persistence.reloadSaved();
	const draft = persistence.view.draft;
	answers = draft?.answers ?? emptyAnswers();
	step = draft?.step ?? "context";
	error = "";
	void focusCurrent();
}
function freshSession() {
	verification?.reset();
	persistence.freshSession();
	submissionRequested = false;
	complete = false;
}
function close() {
	void persistence.flush(true);
	onclose();
}
</script>

<form class="research-form" onsubmit={submit} novalidate>
  <div class="form-header"><span class="wordmark">Melzi</span><span class="save-note" role="status" aria-live="polite">{note}</span></div>
  <div class="question-body" bind:this={body}>
    {#if !complete}<p class="step-label">Question {index+1}{#if optional}<span>Optional</span>{/if}</p>{/if}
    <h2 id="research-title" bind:this={heading} tabindex="-1">{title}</h2>
    {#if complete}
      <p class="helper">Your feedback has been saved. Want to follow along as Melzi takes shape?</p>
      <a class="discord-badge" href="https://discord.com/invite/YXa8xaA4Gu" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 12.9 12.9 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.947 2.419-2.157 2.419Z"/></svg>
        Join us on Discord
      </a>
    {:else if problemMulti}
      <ChoiceField name="problemCategory" label="Choose any that apply" options={problemMulti.options} multiple value={answers.problemCategory} onchange={toggleProblemCategory} />
      {#if answers.problemCategory.includes("other")}
        <div class="workaround-details"><label class="input-label" for="problem-details">What’s frustrating you? <span>(optional)</span></label><textarea id="problem-details" name="problem" bind:value={answers.problem} maxlength="2000" rows="4" placeholder="Tell us in your own words"></textarea></div>
      {/if}
    {:else if question}
      {#if step==='spend'}<p class="helper">A rough estimate in USD is fine.</p>{/if}
      <ChoiceField name={question.field} label="Choose one" options={question.options} value={answers[question.field]} onchange={value=>choose(question.field,value)} />
      {#if step==='context' && answers.context==='other'}
        <div class="workaround-details"><label class="input-label" for="context-details">What are you working on? <span>(optional)</span></label><textarea id="context-details" name="contextDetails" bind:value={answers.contextDetails} maxlength="2000" rows="3" placeholder="Tell us a little about it"></textarea></div>
      {/if}
      {#if step==='problem' && answers.problemCategory.includes('other')}
        <div class="workaround-details"><label class="input-label" for="problem-details">What’s frustrating you? <span>(optional)</span></label><textarea id="problem-details" name="problem" bind:value={answers.problem} maxlength="2000" rows="4" placeholder="Tell us in your own words"></textarea></div>
      {/if}
      {#if question?.field==='anticipateIssues' && answers.anticipateIssues==='yes'}
        <div class="workaround-details"><label class="input-label" for="problem-details">What kind of issues do you expect? <span>(optional)</span></label><textarea id="problem-details" name="problem" bind:value={answers.problem} maxlength="2000" rows="4" placeholder="Slowdowns, surprises, anything on your mind"></textarea></div>
      {/if}
      {#if step==='workaround' && answers.workaround==='tried'}
        <div class="workaround-details"><label class="input-label" for="workaround-details">What have you tried? <span>(optional)</span></label><textarea id="workaround-details" name="workaroundDetails" bind:value={answers.workaroundDetails} maxlength="2000" rows="4" placeholder="Tools, changes, workarounds, or help you’ve brought in"></textarea></div>
      {/if}
    {:else if step==='stack'}
      <StackPicker bind:selected={answers.stackTools} bind:details={answers.stack} bind:why={answers.stackWhy} bind:whyOther={answers.stackWhyOther} />
    {:else if textQuestion}
      <p class="helper" id="text-help">{textQuestion.hint}</p>
      <label class="sr-only" for="open-answer">{textQuestion.title}</label>
      <textarea id="open-answer" name={textQuestion.field} bind:value={answers[textQuestion.field]} maxlength="2000" rows="3" aria-describedby="text-help" placeholder={textQuestion.placeholder}></textarea>
    {:else if step==='startup'}
      <div class="team-fields"><ChoiceField name="owner" label="Who handles infrastructure?" options={choices.owner} value={answers.owner} onchange={value=>choose('owner',value)} /></div>
    {:else if step==='contact'}
      <label class="input-label" for="research-email">Email address</label>
      <input bind:this={emailInput} id="research-email" name="email" type="email" required autocomplete="email" maxlength="254" bind:value={answers.email} aria-invalid={error?true:undefined} aria-describedby={error?'form-error':undefined} oninput={()=>error=''} placeholder="you@example.com" />
      <div class="phone-field">
        <label class="input-label" for="research-phone">Phone number <span>(optional - we'd love to keep you in the loop!)</span></label>
        <input id="research-phone" name="phone" type="tel" autocomplete="tel" maxlength="40" bind:value={answers.phone} placeholder="+1 555 000 0000" />
      </div>
    {/if}
    {#if error}<p id="form-error" class="error" role="alert" bind:this={errorEl}>{error}</p>{/if}
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
      <div class="footer-row"><span class="footer-spacer"></span><button class="primary" type="button" onclick={close}>Close</button></div>
    {:else}
      <div class="footer-row"><button class="secondary" type="button" onclick={back} disabled={!hydrated||index===0}>Back</button><div class="forward-actions">{#if optional && index!==steps.length-1}<button class="skip" type="button" onclick={skip} disabled={!hydrated}>Skip</button>{/if}<button class="primary" type="submit" disabled={!hydrated}>{index===steps.length-1?'Submit feedback':'Continue'}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14m-5-5 5 5-5 5"/></svg></button></div></div>
      <div class="finish-links"><button class="clear-draft" type="button" onclick={restart}>Clear local draft</button></div>
    {/if}
  </footer>
</form>
<style>
  .research-form{display:flex;flex-direction:column;max-height:calc(100dvh - 32px);min-height:0;color:#1e3d52}
  .form-header{padding:22px 64px 20px 30px;display:flex;align-items:center;gap:18px;border-bottom:1px solid #d5e0e6;flex-shrink:0}.wordmark{font-family:'DM Serif Display',Georgia,serif;font-size:29px;line-height:1}.save-note{font-size:11px;line-height:1.5;color:#526c7d}
  .question-body{padding:25px 30px 28px;overflow-y:auto;min-height:0;overscroll-behavior:contain}.step-label{font-size:11px;color:#4f6d81;margin-bottom:13px;display:flex;gap:11px;align-items:center}.step-label span{border-left:1px solid #a8bdca;padding-left:11px}
  h2{font-size:clamp(23px,3vw,30px);font-weight:500;letter-spacing:-.7px;line-height:1.23;margin:0 0 23px;outline:none;text-wrap:balance}.helper{font-size:13px;line-height:1.65;color:#506b7e;margin:-10px 0 22px}.team-fields{display:grid;gap:27px}
  textarea,input{width:100%;border:1px solid #91acbd;border-radius:8px;background:#fff;color:#183a51;font:inherit;font-size:15px;line-height:1.6;padding:13px 15px}textarea{resize:vertical;min-height:84px;max-height:200px}textarea::placeholder,input::placeholder{color:#657f90}textarea:focus-visible,input:focus-visible{outline:3px solid #4b93c4;outline-offset:3px}.input-label{display:block;font-size:13px;font-weight:600;margin-bottom:10px}.input-label span{font-weight:400;color:#526c7d}.error{color:#9b2e35;font-size:13px;line-height:1.5;margin-top:16px}
  .phone-field{margin-top:18px}
  .discord-badge{display:inline-flex;align-items:center;gap:10px;min-height:46px;padding:12px 18px;border-radius:8px;background:#5865f2;color:#fff;font-size:14px;font-weight:500;text-decoration:none}.discord-badge:hover{background:#4752c4}.discord-badge svg{width:22px;height:22px;fill:currentColor;flex-shrink:0}
  footer{border-top:1px solid #d5e0e6;padding:18px 30px;background:#edf3f6;flex-shrink:0}.footer-row{display:flex;justify-content:space-between;gap:12px;align-items:center}.forward-actions{display:flex;gap:10px;align-items:center}.footer-spacer{flex:1}.finish-links{display:flex;justify-content:flex-end;margin-top:6px}.finish-links .clear-draft{border:0;background:transparent;padding:2px 0;min-height:20px;font-size:11px;color:#5a7386;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.finish-links .clear-draft:hover{color:#102f45}
  button{font:inherit;font-size:13px;cursor:pointer;min-height:44px;border-radius:7px;padding:11px 15px}.primary{display:flex;align-items:center;justify-content:center;gap:15px;background:#123c5b;color:#fff;border:1px solid #123c5b;font-weight:500}.primary:hover{background:#205879}.primary svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}.secondary{border:1px solid #a9bfcd;color:#264a64;background:#f9fcfd}.secondary:hover{background:#e0ebf2}.secondary:disabled{opacity:.45;cursor:default}.skip{border:0;background:transparent;color:#355d77;text-decoration:underline;text-underline-offset:3px}.skip:hover{color:#102f45}
  .save-help,.save-warning{font-size:12px;line-height:1.6;color:#506b7e;margin:0 0 18px}.save-warning{color:#9b2e35;margin-top:16px}.save-help{margin-top:16px}.verification{max-width:100%;margin-top:12px}.verification:empty{display:none}button:disabled{opacity:.5;cursor:default}
  @media(max-width:480px){textarea,input{font-size:16px}}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:480px){.form-header{padding:20px 50px 18px 19px;gap:12px}.wordmark{font-size:25px}.save-note{font-size:10px;max-width:140px}.question-body{padding:20px 19px 23px}h2{font-size:25px;margin-bottom:20px}.helper{font-size:12px}footer{padding:14px 16px}button{padding:10px 12px;font-size:12px}.primary{gap:9px}.forward-actions{gap:5px}}
  @media(max-height:640px){textarea{height:96px;min-height:84px}.form-header{padding-top:15px;padding-bottom:14px}.question-body{padding-top:18px;padding-bottom:18px}footer{padding-top:12px;padding-bottom:12px}}
</style>
