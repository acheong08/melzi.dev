export type Option = { value: string; label: string };
const options = (items: [string, string][]): Option[] => items.map(([value, label]) => ({ value, label }));
export const choices = {
  context: options([['self-host','Self-hosting tools or services'],['side-project','A side project'],['startup','A startup'],['company','Engineering at an established company'],['other','Something else']]),
  stage: options([['idea','Exploring an idea'],['building','Building, but not deployed yet'],['changing','Already running and changing frequently'],['stable','Mostly stable, keeping it running']]),
  burden: options([['none','Not a problem'],['time','Takes more time than it should'],['slows','Slows down or blocks development'],['early','Too early to tell']]),
  problemCategory: options([['setup','Setup and configuration'],['maintenance','Maintenance and security'],['testing','Testing and deployments'],['cost','Costs'],['other','Something else']]),
  workaround: options([['tried','I’ve tried something'],['nothing','Haven’t tried anything yet'],['someone','Someone else handles it']]),
  outcome: options([['solved','Solved it'],['partly','Helped, but there’s still a problem'],['no','Didn’t help'],['early','Too early to tell']]),
  role: options([['founder','Founder'],['engineering','Engineering'],['platform','Platform or operations'],['other','Another role']]),
  owner: options([['me','Me'],['shared','Shared across the team'],['dedicated','A dedicated person or team'],['external','External help'],['undecided','Not decided yet']]),
  spend: options([['under-50','Under $50'],['50-249','$50 to $249'],['250-999','$250 to $999'],['1000-4999','$1,000 to $4,999'],['5000-plus','$5,000 or more'],['unsure','Not sure']]),
  anticipateIssues: options([['yes','Yes'],['no','No'],['unsure','Not sure']])
};
export const stackWhyOptions = options([['cost','Cost'],['ease','Ease of use'],['reputation','Reputation'],['ai','AI recommended'],['experience','Prior experience'],['other','Other']]);
export const sideContexts = ['side-project','self-host'];
export type SingleField = keyof typeof choices;
export type TextField = 'contextDetails' | 'stack' | 'problem' | 'workingWell' | 'workaroundDetails' | 'hate' | 'sideProject' | 'stackWhyOther' | 'phone';
export type Answers = Record<SingleField | TextField | 'email', string> & { stackTools: string[]; stackWhy: string[] };
export type Step = 'context' | 'role' | 'sideProject' | 'stage' | 'stack' | 'burden' | 'problem' | 'workingWell' | 'workaround' | 'outcome' | 'spend' | 'startup' | 'contact' | 'hate';
export function emptyAnswers(): Answers {
  return {context:'',contextDetails:'',role:'',sideProject:'',stage:'',stack:'',stackTools:[],stackWhy:[],stackWhyOther:'',burden:'',problemCategory:'',problem:'',anticipateIssues:'',workingWell:'',workaround:'',workaroundDetails:'',outcome:'',owner:'',spend:'',email:'',phone:'',hate:''};
}
export function isBuilding(a: Answers) { return ['building','changing','stable'].includes(a.stage); }
export function isTeam(a: Answers) { return ['startup','company'].includes(a.context); }
export function isSideContext(a: Answers) { return sideContexts.includes(a.context); }
export function experiencedPain(a: Answers) { return isBuilding(a) && ['time','slows'].includes(a.burden); }
export function showsProblem(a: Answers) { return !!a.burden && a.burden !== 'none'; }
export function showsSpend(a: Answers) { return experiencedPain(a) && a.problemCategory === 'cost'; }
export function stepsFor(a: Answers): Step[] {
  const steps: Step[] = ['context'];
  if(isTeam(a)) steps.push('role');
  else if(isSideContext(a)) steps.push('sideProject');
  steps.push('stage');
  if(isBuilding(a)) steps.push('stack');
  steps.push('burden');
  if(a.burden === 'none' && isBuilding(a)) steps.push('workingWell');
  else if(showsProblem(a)) steps.push('problem');
  if(experiencedPain(a)) {
    steps.push('workaround');
    if(a.workaround === 'tried') steps.push('outcome');
  }
  if(showsSpend(a)) steps.push('spend');
  if(isTeam(a)) steps.push('startup');
  steps.push('contact');
  steps.push('hate');
  return steps;
}
export function isOptional(step: Step) { return ['sideProject','workingWell','hate'].includes(step); }
export function questionFor(step: Step, a?: Answers): {title:string;field:SingleField;options:Option[]}|undefined {
  if(step === 'role') return {title:'What’s your role?',field:'role',options:choices.role};
  if(step === 'problem' && a && experiencedPain(a)) return {title:'What’s the most frustrating part of infrastructure work?',field:'problemCategory',options:choices.problemCategory};
  if(step === 'problem' && a) return {title:'Do you anticipate any issues with infrastructure?',field:'anticipateIssues',options:choices.anticipateIssues};
  const titles: Partial<Record<Step, string>> = {
    context:'What are you working on?', stage:'Where are you today?',
    burden:'How much of a problem is infrastructure work for you right now?',
    workaround:'What have you done to make infrastructure work less painful?',
    outcome:'How well is that working?',
    spend:'Roughly what do you spend on infrastructure each month?'
  };
  if(titles[step] && step in choices) { const field = step as SingleField; return {title:titles[step]!,field,options:choices[field]}; }
}
export function textQuestionFor(step: Step, a: Answers): {title:string;field:TextField;hint:string;placeholder:string}|undefined {
  if(step === 'sideProject') return {title:'Tell us a few words about your side project',field:'sideProject',hint:'What is it, and what does it run on today?',placeholder:'A few words about it'};
  if(step === 'workingWell') return {title:'What makes it work well for you?',field:'workingWell',hint:'What keeps infrastructure from becoming a problem?',placeholder:'What’s working well?'};
  if(step === 'hate') return {title:'Anything you currently use that you absolutely HATE?',field:'hate',hint:'Doesn’t have to be infrastructure-related. We’re curious.',placeholder:'Go on…'};
}
export function changeAnswer(a: Answers, field: SingleField, value: string): Answers {
  const next = {...a, [field]:value};
  if(a[field] === value) return next;
  if(field === 'context') {
    if(!isTeam(next)) { next.role=''; next.owner=''; }
    if(!isSideContext(next)) next.sideProject='';
    if(value !== 'other') next.contextDetails='';
  }
  if(field === 'stage' && isBuilding(a) !== isBuilding(next)) {
    next.burden=''; next.problemCategory=''; next.problem=''; next.anticipateIssues=''; next.workingWell=''; next.workaround=''; next.workaroundDetails=''; next.outcome=''; next.spend='';
    if(!isBuilding(next)) { next.stack=''; next.stackTools=[]; next.stackWhy=[]; next.stackWhyOther=''; }
  }
  if(field === 'burden') {
    if(experiencedPain(a) !== experiencedPain(next) || value === 'none') { next.problem=''; next.problemCategory=''; next.anticipateIssues=''; }
    if(value !== 'none') next.workingWell='';
    if(!experiencedPain(next)) { next.workaround=''; next.workaroundDetails=''; next.outcome=''; next.spend=''; }
  }
  if(field === 'problemCategory') { next.problem=''; if(value !== 'cost') next.spend=''; }
  if(field === 'anticipateIssues' && value !== 'yes') next.problem='';
  if(field === 'workaround' && value !== 'tried') { next.workaroundDetails=''; next.outcome=''; }
  return next;
}
export function skipAnswer(a: Answers, step: Step): Answers {
  if(!isOptional(step)) return a;
  const next = {...a};
  const text = textQuestionFor(step,a);
  const question = questionFor(step,a);
  if(text) next[text.field]='';
  else if(question) next[question.field]='';
  return next;
}
export function labelFor(field: SingleField, value: string) { return choices[field].find(o=>o.value===value)?.label??value; }
export function responseFor(a: Answers) {
  return {
    schemaVersion:5, context:a.context, ...(a.context === 'other' && a.contextDetails.trim()?{contextDetails:a.contextDetails.trim()}:{}),
    ...(isTeam(a)?{role:a.role||null}:{}) ,
    ...(isSideContext(a) && a.sideProject.trim()?{sideProjectNotes:a.sideProject.trim()}:{}),
    stage:a.stage, infrastructureBurden:a.burden,
    ...(isBuilding(a) && a.stackTools.length?{stackTools:a.stackTools.filter(tool=>tool!=='Other')}:{}),
    ...(isBuilding(a) && a.stackTools.includes('Other') && a.stack.trim()?{stackOtherDetails:a.stack.trim()}:{}),
    ...(isBuilding(a) && a.stackTools.length && a.stackWhy.length?{stackWhy:[...a.stackWhy]}:{}),
    ...(isBuilding(a) && a.stackWhy.includes('other') && a.stackWhyOther.trim()?{stackWhyOther:a.stackWhyOther.trim()}:{}),
    ...(showsProblem(a)?{problemEvidence:experiencedPain(a)?'experienced':'anticipated'}:{}),
    ...(experiencedPain(a) && a.problemCategory?{problemCategory:a.problemCategory}:{}),
    ...(experiencedPain(a) && a.problemCategory === 'other' && a.problem.trim()?{problem:a.problem.trim()}:{}),
    ...(showsProblem(a) && !experiencedPain(a) && a.anticipateIssues?{anticipatedIssues:a.anticipateIssues}:{}),
    ...(showsProblem(a) && !experiencedPain(a) && a.anticipateIssues === 'yes' && a.problem.trim()?{anticipatedIssueDetails:a.problem.trim()}:{}),
    ...(isBuilding(a) && a.burden === 'none' && a.workingWell.trim()?{whatWorksWell:a.workingWell.trim()}:{}),
    ...(experiencedPain(a) && a.workaround?{workaroundStatus:a.workaround}:{}),
    ...(experiencedPain(a) && a.workaround === 'tried'?{...(a.workaroundDetails.trim()?{workaroundDetails:a.workaroundDetails.trim()}:{}),...(a.outcome?{workaroundOutcome:a.outcome}:{})}:{}),
    ...(showsSpend(a)?{costIsPartOfProblem:true,...(a.spend?{monthlySpendUsd:a.spend}:{})}:{}),
    ...(isTeam(a)?{infrastructureOwner:a.owner||null}:{}),
    ...(a.email.trim()?{email:a.email.trim()}:{}),...(a.phone.trim()?{phone:a.phone.trim()}:{}),
    ...(a.hate.trim()?{anythingYouHate:a.hate.trim()}:{})
  };
}
export function summaryFor(a: Answers): [string,string][] {
  const rows: [string,string][] = [['Project',labelFor('context',a.context)]];
  if(a.context === 'other' && a.contextDetails.trim()) rows.push(['Project details',a.contextDetails.trim()]);
  if(isTeam(a) && a.role) rows.push(['Role',labelFor('role',a.role)]);
  if(isSideContext(a) && a.sideProject.trim()) rows.push(['Side project',a.sideProject.trim()]);
  rows.push(['Stage',labelFor('stage',a.stage)]);
  if(isBuilding(a) && a.stackTools.length) rows.push(['Selected tools',a.stackTools.filter(tool=>tool!=='Other').join(', ')]);
  if(isBuilding(a) && a.stackTools.includes('Other') && a.stack.trim()) rows.push(['Other tools',a.stack.trim()]);
  if(isBuilding(a) && a.stackWhy.length) rows.push(['Why this stack',a.stackWhy.map(value=>stackWhyOptions.find(option=>option.value===value)?.label??value).join(', ')]);
  if(isBuilding(a) && a.stackWhy.includes('other') && a.stackWhyOther.trim()) rows.push(['Other reason',a.stackWhyOther.trim()]);
  rows.push(['Infrastructure burden',labelFor('burden',a.burden)]);
  if(experiencedPain(a) && a.problemCategory) rows.push(['Main frustration',labelFor('problemCategory',a.problemCategory)]);
  if(experiencedPain(a) && a.problemCategory === 'other' && a.problem.trim()) rows.push(['Frustration details',a.problem.trim()]);
  if(showsProblem(a) && !experiencedPain(a) && a.anticipateIssues) rows.push(['Anticipated issues',labelFor('anticipateIssues',a.anticipateIssues)]);
  if(showsProblem(a) && !experiencedPain(a) && a.anticipateIssues === 'yes' && a.problem.trim()) rows.push(['Expected obstacle',a.problem.trim()]);
  if(isBuilding(a) && a.burden === 'none' && a.workingWell.trim()) rows.push(['What works well',a.workingWell.trim()]);
  if(experiencedPain(a) && a.workaround) rows.push(['What you have tried',labelFor('workaround',a.workaround)]);
  if(experiencedPain(a) && a.workaround === 'tried') {
    if(a.workaroundDetails.trim()) rows.push(['Workaround details',a.workaroundDetails.trim()]);
    if(a.outcome) rows.push(['How well it works',labelFor('outcome',a.outcome)]);
  }
  if(showsSpend(a) && a.spend) rows.push(['Monthly spend (USD)',labelFor('spend',a.spend)]);
  if(isTeam(a) && a.owner) rows.push(['Infrastructure handled by',labelFor('owner',a.owner)]);
  if(a.email.trim()) rows.push(['Email',a.email.trim()]);
  if(a.phone.trim()) rows.push(['Phone',a.phone.trim()]);
  if(a.hate.trim()) rows.push(['Anything you hate',a.hate.trim()]);
  return rows;
}
