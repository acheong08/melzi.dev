export type StackTool = { name: string; aliases: string[] };
export const stackShortlist = ['AWS','Azure','Google Cloud','Vercel','Railway','Supabase','Firebase','Cloudflare','Hetzner','Own hardware'];
export const stackCatalog: StackTool[] = [
  {name:'AWS',aliases:['Amazon Web Services','Amazon']},
  {name:'Azure',aliases:['Microsoft Azure']},
  {name:'Google Cloud',aliases:['GCP','Google Cloud Platform']},
  {name:'Vercel',aliases:[]},{name:'Railway',aliases:[]},{name:'Supabase',aliases:[]},
  {name:'Firebase',aliases:[]},{name:'Cloudflare',aliases:['Workers']},{name:'Hetzner',aliases:[]},
  {name:'Own hardware',aliases:['Homelab','Self-hosted','On-premises']},
  ...['DigitalOcean','Render','Fly.io','Netlify','Docker','Kubernetes','Terraform','Pulumi','Ansible','MySQL','MongoDB','Redis','SvelteKit','React','Django','Laravel','Bun'].map(name=>({name,aliases:[]})),
  {name:'PostgreSQL',aliases:['Postgres']},{name:'Next.js',aliases:['Nextjs']},
  {name:'Node.js',aliases:['Node','Nodejs']},{name:'Ruby on Rails',aliases:['Rails']},
  {name:'GitHub Actions',aliases:['Github CI']}
];
export function normalizeTool(value:string){return value.trim().replace(/\s+/g,' ').toLocaleLowerCase();}
export function canonicalTool(value:string){
  const normalized=normalizeTool(value);
  return stackCatalog.find(tool=>[tool.name,...tool.aliases].some(name=>normalizeTool(name)===normalized))?.name??value.trim().replace(/\s+/g,' ');
}
export function matchingTools(query:string):StackTool[]{
  const normalized=normalizeTool(query);
  return normalized?stackCatalog.filter(tool=>[tool.name,...tool.aliases].some(name=>normalizeTool(name).includes(normalized))):stackCatalog.filter(tool=>stackShortlist.includes(tool.name));
}
export function addStackTool(selected:string[],value:string):string[]{
  const name=canonicalTool(value);
  if(!name||name.length>80||selected.length>=32||selected.some(item=>normalizeTool(item)===normalizeTool(name)))return selected;
  return [...selected,name];
}
