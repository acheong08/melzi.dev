import { choices, emptyAnswers, experiencedPain, isOptional, problemCategoryOptions, questionFor, stepsFor, textQuestionFor, type Answers, type Step } from './form.js';

export type NodeId = Exclude<Step, 'problem'> | 'problem-experienced' | 'problem-anticipated';
export type GraphNode = {id:NodeId; step:Step; x:number; y:number; rule:string; detail?:string};
export const nodeWidth=320;
export const nodeHeight=190;
export const graphWidth=1152;
export const graphHeight=2864;
const node=(id:NodeId,row:number,rule:string,column=1,detail?:string):GraphNode=>({id,step:id.startsWith('problem-')?'problem':id as Step,x:24+column*392,y:16+row*240,rule,detail});
export const graphNodes:GraphNode[]=[
  node('context',0,'Always shown. Startup or company adds the role question next; side projects and self-hosting get a side-project note instead.',1,'“Something else” offers optional free text.'),
  node('role',1,'Startup or company contexts only.',1),
  node('sideProject',1,'Side project or self-hosting contexts only. Optional free text.',2),
  node('stage',2,'Always shown. Stage affects stack, problem wording, and workarounds.'),
  node('stack',3,'Building, running, or stable. Hidden for the idea stage.',1,'“Other” opens an optional free text box. Selecting any tool reveals why this stack was chosen.'),
  node('burden',4,'Always shown. Its effect also depends on the project stage.'),
  node('workingWell',5,'Already building + “Not a problem”.',0),
  node('problem-experienced',5,'Already building + lost time or blocked development.',1,'Required. Costs adds the spend step. Something else opens free text.'),
  node('problem-anticipated',5,'Any concern before building, or “Too early to tell”. Required. “Yes” opens an optional free text box.',2),
  node('workaround',6,'Only for experienced problems.',1,'“I’ve tried something” reveals a details textbox here and the outcome step next.'),
  node('outcome',7,'Workaround answer is “I’ve tried something”. Other answers bypass it.'),
  node('spend',8,'Experienced problem + Costs selected.'),
  node('startup',9,'Project context is Startup or engineering at a company.',1,'Who handles infrastructure.'),
  node('contact',10,'Always shown. Email is required; a phone number is optional.',1,'A valid email is needed to continue.'),
  node('hate',11,'Always the final step, after contact details. Optional free text.')
];
export function graphPath(a:Answers):NodeId[]{return stepsFor(a).map(step=>step==='problem'?(experiencedPain(a)?'problem-experienced':'problem-anticipated'):step);}
export function nodeTitle(n:GraphNode,a:Answers):string{
  const sample=n.id==='problem-experienced'?{...a,stage:'building',burden:'time'}:n.id==='problem-anticipated'?{...a,stage:'idea',burden:'early'}:a;
  return questionFor(n.step,sample)?.title??textQuestionFor(n.step,sample)?.title??(n.step==='stack'?'What are you building with today?':n.step==='startup'?'A little about your team':'Where can we reach you?');
}
export function nodeOptional(n:GraphNode){return isOptional(n.step);}
export type GraphEdge={id:string;from:NodeId;to:NodeId};
// Derive every possible connection from the actual form, rather than maintaining
// a second routing table. Blank optional workaround answers represent Skip.
export function allGraphEdges():GraphEdge[]{
  const found=new Map<string,GraphEdge>();
  for(const context of choices.context)for(const stage of choices.stage)for(const burden of choices.burden)for(const workaround of ['',...choices.workaround.map(o=>o.value)])for(const problemCategory of ['',...problemCategoryOptions.map(o=>o.value)]){
    const path=graphPath({...emptyAnswers(),context:context.value,stage:stage.value,burden:burden.value,workaround,problemCategory:problemCategory?[problemCategory]:[]});
    for(let i=1;i<path.length;i++){const from=path[i-1],to=path[i],id=`${from}:${to}`;found.set(id,{id,from,to});}
  }
  return [...found.values()];
}
export const graphEdges=allGraphEdges();
export function edgePath(edge:GraphEdge,index:number):string{
  const from=graphNodes.find(n=>n.id===edge.from)!;const to=graphNodes.find(n=>n.id===edge.to)!;
  const x1=from.x+nodeWidth/2,y1=from.y+nodeHeight,x2=to.x+nodeWidth/2,y2=to.y;
  if(to.y-from.y<=240)return `M ${x1} ${y1} C ${x1} ${y1+24}, ${x2} ${y2-24}, ${x2} ${y2}`;
  // Long skip paths travel between columns, not through intervening cards.
  const lane=from.x===416?362+(index%3)*16:x1;
  return `M ${x1} ${y1} V ${y1+20} H ${lane} V ${y2-24} H ${x2} V ${y2}`;
}
export const presets=[
  {id:'startup',label:'Startup with friction',answers:{...emptyAnswers(),context:'startup',stage:'building',burden:'slows',role:'founder',workaround:'tried',problemCategory:['cost']}},
  {id:'idea',label:'Early idea',answers:{...emptyAnswers(),context:'side-project',stage:'idea',burden:'early',workaround:''}},
  {id:'stable',label:'Stable, no problem',answers:{...emptyAnswers(),context:'self-host',stage:'stable',burden:'none',workaround:''}}
] satisfies {id:string;label:string;answers:Answers}[];
