import { choices, emptyAnswers, experiencedPain, isBuilding, isSideContext, isTeam, responseFor, showsProblem, showsSpend, stackWhyOptions, stepsFor, type Answers, type Step } from '../../src/lib/research/form.js';
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
  if(value.schemaVersion!==5||typeof value.completed!=='boolean'||!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<0||Number(value.expectedRevision)>1_000_000||typeof value.mutationId!=='string'||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b$/i.test(value.mutationId))throw new ApiFailure(400,'invalid_request','Invalid save request.');
  const answers=validateAnswers(value.answers);
  if(typeof value.step!=='string'||!stepsFor(answers).includes(value.step as Step))throw new ApiFailure(400,'invalid_step','This question does not belong to the current answer path.');
  if(value.completed){
    if(!answers.context||!answers.stage||!answers.burden)throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(isTeam(answers)&&!answers.role)throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(isBuilding(answers)&&(!answers.stackTools.length||!answers.stackWhy.length))throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(showsProblem(answers)&&(experiencedPain(answers)?!answers.problemCategory:!answers.anticipateIssues))throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(experiencedPain(answers)&&(!answers.workaround||(answers.workaround==='tried'&&!answers.outcome)))throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(showsSpend(answers)&&!answers.spend)throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(isTeam(answers)&&!answers.owner)throw new ApiFailure(400,'incomplete','Please answer the remaining questions before submitting.');
    if(value.step!=='hate')throw new ApiFailure(400,'incomplete','Finish the form before submitting.');
    if(!emailPattern.test(answers.email.trim()))throw new ApiFailure(400,'invalid_email','Enter a valid email address.');
  }
  return {schemaVersion:5,answers,step:value.step as Step,completed:value.completed,expectedRevision:Number(value.expectedRevision),mutationId:value.mutationId};
}
function validateSelection(item:unknown,label:string,max:number):string[] {
  if(!Array.isArray(item)||item.length>max||item.some(tool=>typeof tool!=='string'||tool.length<1||tool.length>80||tool.includes('\0')||!tool.isWellFormed()))throw new ApiFailure(400,'invalid_answers',label);
  const tools=item.map(tool=>(tool as string).trim().replace(/\s+/g,' '));
  if(tools.some(tool=>!tool)||new Set(tools.map(tool=>tool.toLowerCase())).size!==tools.length)throw new ApiFailure(400,'invalid_answers',label);
  return tools;
}
export function validateAnswers(value:unknown):Answers {
  const base=emptyAnswers();
  if(!object(value)||Object.keys(value).sort().join(',')!==Object.keys(base).sort().join(','))throw new ApiFailure(400,'invalid_answers','Invalid answer fields.');
  for(const key of Object.keys(base) as (keyof Answers)[]){
    const item=value[key];
    if(key==='stackTools'){
      const tools=validateSelection(item,'Invalid stack selection.',32);
      base.stackTools=tools;continue;
    }
    if(key==='stackWhy'){
      const reasons=validateSelection(item,'Invalid stack reasons.',stackWhyOptions.length);
      if(reasons.some(reason=>!stackWhyOptions.some(option=>option.value===reason)))throw new ApiFailure(400,'invalid_answers','Unknown stack reason.');
      base.stackWhy=reasons;continue;
    }
    if(typeof item!=='string'||item.length>(key==='email'?254:key==='phone'?40:2000)||item.includes('\0')||!item.isWellFormed())throw new ApiFailure(400,'invalid_answers','Invalid answer text.');
    if(key in choices&&item!==''&&!choices[key as keyof typeof choices].some(choice=>choice.value===item))throw new ApiFailure(400,'invalid_answers','Unknown answer choice.');
    base[key]=item;
  }
  // Enforce the same branch boundaries even if a caller bypasses the UI.
  if(base.context!=='other')base.contextDetails='';
  if(!isTeam(base)){base.role='';base.owner='';}
  if(!isSideContext(base))base.sideProject='';
  if(!isBuilding(base)){base.stack='';base.stackTools=[];base.stackWhy=[];base.stackWhyOther='';base.workingWell='';}
  else if(!base.stackTools.includes('Other'))base.stack='';
  if(!isBuilding(base)||!base.stackTools.length){base.stackWhy=[];base.stackWhyOther='';}
  else if(!base.stackWhy.includes('other'))base.stackWhyOther='';
  if(!showsProblem(base)){base.problem='';base.problemCategory='';base.anticipateIssues='';}
  if(experiencedPain(base)){
    base.anticipateIssues='';
    if(base.problemCategory!=='other')base.problem='';
  } else {
    base.problemCategory='';base.workaround='';base.workaroundDetails='';base.outcome='';
    if(base.anticipateIssues!=='yes')base.problem='';
  }
  if(base.burden!=='none')base.workingWell='';
  if(base.workaround!=='tried'){base.workaroundDetails='';base.outcome='';}
  if(!showsSpend(base))base.spend='';
  return base;
}
export function projectedResponse(answers:Answers){return responseFor(answers);}
