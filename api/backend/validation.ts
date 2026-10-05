import { choices, emptyAnswers, experiencedPain, isBuilding, isTeam, responseFor, showsProblem, showsSpend, stepsFor, type Answers, type Step } from '../../src/lib/research/form.js';
import { MAX_REQUEST_BYTES, type SaveRequest } from '../../src/lib/research/persistence-contract.js';

export class ApiFailure extends Error {
  constructor(public status:number, public code:string, message:string, public revision?:number, public retryAfter?:number){super(message);}
}
const emailPattern=/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export function parseMutation(raw:string):SaveRequest {
  if(Buffer.byteLength(raw,'utf8')>MAX_REQUEST_BYTES)throw new ApiFailure(413,'too_large','The response is too large.');
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new ApiFailure(400,'invalid_json','Send a JSON object.');}
  if(!object(value)||Object.keys(value).sort().join(',')!=='answers,completed,expectedRevision,mutationId,schemaVersion,step')throw new ApiFailure(400,'invalid_request','Invalid save request.');
  if(value.schemaVersion!==4||typeof value.completed!=='boolean'||!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<0||Number(value.expectedRevision)>1_000_000||typeof value.mutationId!=='string'||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b$/i.test(value.mutationId))throw new ApiFailure(400,'invalid_request','Invalid save request.');
  const answers=validateAnswers(value.answers);
  if(typeof value.step!=='string'||!stepsFor(answers).includes(value.step as Step))throw new ApiFailure(400,'invalid_step','This question does not belong to the current answer path.');
  if(value.completed){
    for(const key of ['context','stage','burden','next'] as const)if(!answers[key])throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(value.step!=='hate')throw new ApiFailure(400,'incomplete','Finish the form before submitting.');
    if(answers.next!=='none'&&!emailPattern.test(answers.email.trim()))throw new ApiFailure(400,'invalid_email','Enter a valid email address.');
  }
  return {schemaVersion:4,answers,step:value.step as Step,completed:value.completed,expectedRevision:Number(value.expectedRevision),mutationId:value.mutationId};
}
export function validateAnswers(value:unknown):Answers {
  const base=emptyAnswers();
  if(!object(value)||Object.keys(value).sort().join(',')!==Object.keys(base).sort().join(','))throw new ApiFailure(400,'invalid_answers','Invalid answer fields.');
  for(const key of Object.keys(base) as (keyof Answers)[]){
    const item=value[key];
    if(key==='stackTools'){
      if(!Array.isArray(item)||item.length>32||item.some(tool=>typeof tool!=='string'||tool.length<1||tool.length>80||tool.includes('\0')||!tool.isWellFormed()))throw new ApiFailure(400,'invalid_answers','Invalid stack selection.');
      const tools=item.map(tool=>(tool as string).trim().replace(/\s+/g,' '));
      if(tools.some(tool=>!tool)||new Set(tools.map(tool=>tool.toLowerCase())).size!==tools.length)throw new ApiFailure(400,'invalid_answers','Stack selections must be distinct.');
      base.stackTools=tools;continue;
    }
    if(typeof item!=='string'||item.length>(key==='email'?254:2000)||item.includes('\0')||!item.isWellFormed())throw new ApiFailure(400,'invalid_answers','Invalid answer text.');
    if(key in choices&&item!==''&&!choices[key as keyof typeof choices].some(choice=>choice.value===item))throw new ApiFailure(400,'invalid_answers','Unknown answer choice.');
    base[key]=item;
  }
  // Enforce the same branch boundaries even if a caller bypasses the UI.
  if(base.context!=='other')base.contextDetails='';
  if(!isTeam(base)){base.role='';base.owner='';}
  if(!isBuilding(base)){base.stack='';base.stackTools=[];base.timeSpent='';base.workingWell='';}
  if(!showsProblem(base)){base.problem='';base.problemCategory='';}
  if(!experiencedPain(base)){base.problemCategory='';base.workaround='';base.workaroundDetails='';base.outcome='';}
  else if(base.problemCategory!=='other')base.problem='';
  if(base.burden!=='none')base.workingWell='';
  if(base.workaround!=='tried'){base.workaroundDetails='';base.outcome='';}
  if(!showsSpend(base))base.spend='';
  if(!base.next||base.next==='none')base.email='';
  return base;
}
export function projectedResponse(answers:Answers){return responseFor(answers);}
