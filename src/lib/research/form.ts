export type Option = { value: string; label: string };
const options = (items: [string, string][]): Option[] => items.map(([value, label]) => ({ value, label }));
export const choices = {
  context: options([['self-host','Self-hosting tools or services'],['side-project','A side project'],['startup','A startup'],['company','Engineering at an established company'],['other','Something else']]),
  stage: options([['idea','Exploring an idea'],['building','Building, but not deployed yet'],['changing','Already running and changing frequently'],['stable','Mostly stable, keeping it running']]),
  burden: options([['none','Not a problem'],['time','Takes more time than it should'],['slows','Slows down or blocks development'],['early','Too early to tell']]),
  problemCategory: options([['setup','Setup and configuration'],['maintenance','Maintenance and security'],['testing','Testing and deployments'],['cost','Costs'],['other','Something else']]),
  workaround: options([['tried','I’ve tried something'],['nothing','Haven’t tried anything yet'],['someone','Someone else handles it']]),
  outcome: options([['solved','Solved it'],['partly','Helped, but there’s still a problem'],['no','Didn’t help'],['early','Too early to tell']]),
  timeSpent: options([['none','Almost none'],['1-3','1 to 3 hours'],['4-8','4 to 8 hours'],['over-day','More than a day'],['varies','Varies too much to say']]),
  role: options([['founder','Founder'],['engineering','Engineering'],['platform','Platform or operations'],['other','Another role']]),
  owner: options([['me','Me'],['shared','Shared across the team'],['dedicated','A dedicated person or team'],['external','External help'],['undecided','Not decided yet']]),
  spend: options([['under-50','Under $50'],['50-249','$50 to $249'],['250-999','$250 to $999'],['1000-4999','$1,000 to $4,999'],['5000-plus','$5,000 or more'],['unsure','Not sure']]),
  next: options([['try','Try an early version'],['chat','Talk through my infrastructure setup'],['updates','Just get updates'],['none','Nothing yet, just sharing feedback']])
};
export type SingleField = keyof typeof choices;
export type TextField = 'contextDetails' | 'stack' | 'problem' | 'workingWell' | 'workaroundDetails' | 'hate';
export type Answers = Record<SingleField | TextField | 'email', string> & { stackTools: string[] };
export type Step = 'context' | 'stage' | 'stack' | 'burden' | 'problem' | 'workingWell' | 'workaround' | 'outcome' | 'timeSpent' | 'spend' | 'startup' | 'hate' | 'next' | 'contact';
export function emptyAnswers(): Answers {
  return {context:'',contextDetails:'',stage:'',stack:'',stackTools:[],burden:'',problemCategory:'',problem:'',workingWell:'',workaround:'',workaroundDetails:'',outcome:'',timeSpent:'',role:'',owner:'',spend:'',hate:'',next:'',email:''};
}
export function isBuilding(a: Answers) { return ['building','changing','stable'].includes(a.stage); }
export function isTeam(a: Answers) { return ['startup','company'].includes(a.context); }
export function experiencedPain(a: Answers) { return isBuilding(a) && ['time','slows'].includes(a.burden); }
export function showsProblem(a: Answers) { return !!a.burden && a.burden !== 'none'; }
export function showsSpend(a: Answers) { return experiencedPain(a) && a.problemCategory === 'cost'; }
export function showsProblemText(a: Answers) { return showsProblem(a) && (!experiencedPain(a) || a.problemCategory === 'other'); }
export function stepsFor(a: Answers): Step[] {
  const steps: Step[] = ['context','stage'];
  if(isBuilding(a)) steps.push('stack');
  steps.push('burden');
  if(a.burden === 'none' && isBuilding(a)) steps.push('workingWell');
  else if(showsProblem(a)) steps.push('problem');
  if(experiencedPain(a)) {
    steps.push('workaround');
    if(a.workaround === 'tried') steps.push('outcome');
  }
  if(isBuilding(a)) steps.push('timeSpent');
  if(showsSpend(a)) steps.push('spend');
  if(isTeam(a)) steps.push('startup');
  steps.push('next');
  if(a.next && a.next !== 'none') steps.push('contact');
  steps.push('hate');
  return steps;
}
export function isOptional(step: Step) { return !['context','stage','burden','next','contact'].includes(step); }
export function questionFor(step: Step, a?: Answers): {title:string;field:SingleField;options:Option[]}|undefined {
  if(step === 'problem' && a && experiencedPain(a)) return {title:'What’s the most frustrating part of infrastructure work?',field:'problemCategory',options:choices.problemCategory};
  const titles: Partial<Record<Step, string>> = {
    context:'What are you working on?', stage:'Where are you today?',
    burden:'How much of a problem is infrastructure work for you right now?',
    workaround:'What have you done to make infrastructure work less painful?',
    outcome:'How well is that working?',
    timeSpent:'In a typical week, roughly how much of your time goes into infrastructure work?',
    spend:'Roughly what do you spend on infrastructure each month?', next:'What would you like next?'
  };
  if(titles[step] && step in choices) { const field = step as SingleField; return {title:titles[step]!,field,options:choices[field]}; }
}
export function textQuestionFor(step: Step, a: Answers): {title:string;field:TextField;hint:string;placeholder:string}|undefined {
  if(step === 'stack') return {title:'What are you building with today?',field:'stack',hint:'Frameworks, hosting, databases, tools. Whatever you’ve already chosen.',placeholder:'Your current stack'};
  if(step === 'problem' && !experiencedPain(a)) return {title:'What, if anything, do you expect to slow you down?',field:'problem',hint:'It’s fine if you’re not sure yet.',placeholder:'What’s on your mind?'};
  if(step === 'workingWell') return {title:'What makes it work well for you?',field:'workingWell',hint:'What keeps infrastructure from becoming a problem?',placeholder:'What’s working well?'};
  if(step === 'hate') return {title:'Anything you currently use that you absolutely HATE?',field:'hate',hint:'Doesn’t have to be infrastructure-related. We’re curious.',placeholder:'Go on…'};
}
export function changeAnswer(a: Answers, field: SingleField, value: string): Answers {
  const next = {...a, [field]:value};
  if(a[field] === value) return next;
  if(field === 'context') {
    if(!isTeam(next)) { next.role=''; next.owner=''; }
    if(value !== 'other') next.contextDetails='';
  }
  if(field === 'stage' && isBuilding(a) !== isBuilding(next)) {
    next.burden=''; next.problemCategory=''; next.problem=''; next.workingWell=''; next.workaround=''; next.workaroundDetails=''; next.outcome=''; next.timeSpent=''; next.spend='';
    if(!isBuilding(next)) { next.stack=''; next.stackTools=[]; }
  }
  if(field === 'burden') {
    if(experiencedPain(a) !== experiencedPain(next) || value === 'none') { next.problem=''; next.problemCategory=''; }
    if(value !== 'none') next.workingWell='';
    if(!experiencedPain(next)) { next.workaround=''; next.workaroundDetails=''; next.outcome=''; next.spend=''; }
  }
  if(field === 'problemCategory') { next.problem=''; if(value !== 'cost') next.spend=''; }
  if(field === 'workaround' && value !== 'tried') { next.workaroundDetails=''; next.outcome=''; }
  if(field === 'next' && value === 'none') next.email='';
  return next;
}
export function skipAnswer(a: Answers, step: Step): Answers {
  if(!isOptional(step)) return a;
  const next = {...a};
  const text = textQuestionFor(step,a);
  const question = questionFor(step,a);
  if(text) next[text.field]='';
  else if(question) next[question.field]='';
  if(step === 'stack') { next.stack=''; next.stackTools=[]; }
  if(step === 'problem') { next.problem=''; next.problemCategory=''; next.spend=''; }
  if(step === 'workaround') { next.workaroundDetails=''; next.outcome=''; }
  if(step === 'startup') { next.role=''; next.owner=''; }
  return next;
}
export function labelFor(field: SingleField, value: string) { return choices[field].find(o=>o.value===value)?.label??value; }
export function responseFor(a: Answers) {
  return {
    schemaVersion:4, context:a.context, ...(a.context === 'other' && a.contextDetails.trim()?{contextDetails:a.contextDetails.trim()}:{}), stage:a.stage, infrastructureBurden:a.burden,
    ...(isBuilding(a) && a.stackTools.length?{stackTools:[...a.stackTools]}:{}),
    ...(isBuilding(a) && a.stack.trim()?{stack:a.stack.trim()}:{}),
    ...(showsProblem(a)?{problemEvidence:experiencedPain(a)?'experienced':'anticipated'}:{}),
    ...(experiencedPain(a) && a.problemCategory?{problemCategory:a.problemCategory}:{}),
    ...(showsProblemText(a) && a.problem.trim()?{problem:a.problem.trim()}:{}),
    ...(isBuilding(a) && a.burden === 'none' && a.workingWell.trim()?{whatWorksWell:a.workingWell.trim()}:{}),
    ...(experiencedPain(a) && a.workaround?{workaroundStatus:a.workaround}:{}),
    ...(experiencedPain(a) && a.workaround === 'tried'?{...(a.workaroundDetails.trim()?{workaroundDetails:a.workaroundDetails.trim()}:{}),...(a.outcome?{workaroundOutcome:a.outcome}:{})}:{}),
    ...(isBuilding(a) && a.timeSpent?{weeklyInfrastructureTime:a.timeSpent}:{}),
    ...(showsSpend(a)?{costIsPartOfProblem:true,...(a.spend?{monthlySpendUsd:a.spend}:{})}:{}),
    ...(isTeam(a)?{role:a.role||null,infrastructureOwner:a.owner||null}:{}),
    nextStep:a.next,...(a.next && a.next !== 'none' && a.email.trim()?{email:a.email.trim()}:{}),
    ...(a.hate.trim()?{anythingYouHate:a.hate.trim()}:{})
  };
}
export function summaryFor(a: Answers): [string,string][] {
  const rows: [string,string][] = [['Project',labelFor('context',a.context)]];
  if(a.context === 'other' && a.contextDetails.trim()) rows.push(['Project details',a.contextDetails.trim()]);
  rows.push(['Stage',labelFor('stage',a.stage)]);
  if(isBuilding(a) && a.stackTools.length) rows.push(['Selected tools',a.stackTools.join(', ')]);
  if(isBuilding(a) && a.stack.trim()) rows.push(['Stack details',a.stack.trim()]);
  rows.push(['Infrastructure burden',labelFor('burden',a.burden)]);
  if(experiencedPain(a) && a.problemCategory) rows.push(['Main frustration',labelFor('problemCategory',a.problemCategory)]);
  if(showsProblemText(a) && a.problem.trim()) rows.push([experiencedPain(a)?'Frustration details':'Expected obstacle',a.problem.trim()]);
  if(isBuilding(a) && a.burden === 'none' && a.workingWell.trim()) rows.push(['What works well',a.workingWell.trim()]);
  if(experiencedPain(a) && a.workaround) rows.push(['What you have tried',labelFor('workaround',a.workaround)]);
  if(experiencedPain(a) && a.workaround === 'tried') {
    if(a.workaroundDetails.trim()) rows.push(['Workaround details',a.workaroundDetails.trim()]);
    if(a.outcome) rows.push(['How well it works',labelFor('outcome',a.outcome)]);
  }
  if(isBuilding(a) && a.timeSpent) rows.push(['Your weekly infrastructure time',labelFor('timeSpent',a.timeSpent)]);
  if(showsSpend(a) && a.spend) rows.push(['Monthly spend (USD)',labelFor('spend',a.spend)]);
  if(isTeam(a)) { if(a.role) rows.push(['Role',labelFor('role',a.role)]); if(a.owner) rows.push(['Infrastructure handled by',labelFor('owner',a.owner)]); }
  rows.push(['Next step',labelFor('next',a.next)]);
  if(a.next && a.next !== 'none' && a.email.trim()) rows.push(['Email',a.email.trim()]);
  if(a.hate.trim()) rows.push(['Anything you hate',a.hate.trim()]);
  return rows;
}
