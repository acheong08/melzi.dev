import { test, expect, type Page } from '@playwright/test';
import { choices, emptyAnswers, problemCategoryOptions, stepsFor } from '../src/lib/research/form';
import { graphEdges, graphNodes, graphPath, presets } from '../src/lib/research/question-graph';

async function expectPath(page:Page,steps:string[]){
  await expect(page.locator('[data-path-step]')).toHaveCount(steps.length);
  expect(await page.locator('[data-path-step]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-path-step')))).toEqual(steps);
  await expect(page.locator('.node[data-active="true"]')).toHaveCount(steps.length);
  await expect(page.locator('svg [data-active="true"]')).toHaveCount(steps.length-1);
}

test('qgraph renders independently and highlights the exact full startup route',async({page,request})=>{
  const response=await request.get('/qgraph');expect(response.status()).toBe(200);expect(await response.text()).toContain('Question branching map');
  await page.goto('/qgraph');await expect(page.getByRole('heading',{name:'Question branching map',exact:true})).toBeVisible();
  await expectPath(page,stepsFor(presets[0].answers));
  await expect(page.locator('[data-node="workingWell"]')).toHaveAttribute('data-active','false');
  await expect(page.locator('[data-node="problem-experienced"]')).toHaveAttribute('data-active','true');
  await expect(page.locator('[data-path-step]').last()).toHaveText(/Anything you currently use that you absolutely HATE/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('presets expose the side-project note, anticipated concerns, and the positive no-problem path',async({page})=>{
  await page.goto('/qgraph');await page.getByRole('button',{name:'Early idea',exact:true}).click();
  await expectPath(page,['context','sideProject','stage','burden','problem','contact','hate']);
  await expect(page.locator('[data-node="problem-anticipated"]')).toHaveAttribute('data-active','true');
  await expect(page.getByRole('combobox',{name:'What have they tried?',exact:true})).toBeDisabled();
  await expect(page.getByRole('combobox',{name:'Main frustration',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Stable, no problem',exact:true}).click();
  await expectPath(page,['context','sideProject','stage','stack','burden','workingWell','contact','hate']);
  await page.getByRole('combobox',{name:'Project stage',exact:true}).selectOption('idea');
  await expectPath(page,['context','sideProject','stage','burden','contact','hate']);
});

test('answer changes reveal outcome, spend, team, and contact steps independently',async({page})=>{
  await page.goto('/qgraph');
  await page.getByRole('combobox',{name:'What have they tried?',exact:true}).selectOption('nothing');
  await expect(page.locator('[data-node="outcome"]')).toHaveAttribute('data-active','false');
  await page.getByRole('combobox',{name:'What have they tried?',exact:true}).selectOption('tried');
  await expect(page.locator('[data-node="outcome"]')).toHaveAttribute('data-active','true');
  await page.getByRole('combobox',{name:'What have they tried?',exact:true}).selectOption('');
  await expect(page.locator('[data-node="outcome"]')).toHaveAttribute('data-active','false');
  await page.getByRole('combobox',{name:'Project context',exact:true}).selectOption('side-project');
  await expectPath(page,['context','sideProject','stage','stack','burden','problem','workaround','spend','contact','hate']);
  await page.getByRole('combobox',{name:'Infrastructure burden',exact:true}).selectOption('early');
  await expectPath(page,['context','sideProject','stage','stack','burden','problem','contact','hate']);
  await expect(page.locator('[data-node="problem-anticipated"]')).toHaveAttribute('data-active','true');
});

test('category and context answers expose fields within an existing step',async({page})=>{
  await page.goto('/qgraph');await page.getByRole('combobox',{name:'Main frustration',exact:true}).selectOption('other');
  await expect(page.locator('[data-path-step="problem"] small')).toContainText('What’s frustrating you?');
  await expect(page.locator('[data-node="spend"]')).toHaveAttribute('data-active','false');
  await page.getByRole('combobox',{name:'Main frustration',exact:true}).selectOption('cost');
  await expect(page.locator('[data-path-step="problem"] small')).toHaveCount(0);await expect(page.locator('[data-node="spend"]')).toHaveAttribute('data-active','true');
  await page.getByRole('combobox',{name:'Project context',exact:true}).selectOption('other');
  await expect(page.locator('[data-path-step="context"] small')).toContainText('project-description');await expect(page.locator('[data-node="startup"]')).toHaveAttribute('data-active','false');
  await page.getByRole('combobox',{name:'Project context',exact:true}).selectOption('company');
  await expect(page.locator('[data-path-step="context"] small')).toHaveCount(0);await expect(page.locator('[data-node="startup"]')).toHaveAttribute('data-active','true');
});

test('the map supports zoom and hiding inactive questions',async({page})=>{
  await page.goto('/qgraph');await page.getByRole('button',{name:'Early idea',exact:true}).click();
  await page.getByRole('checkbox',{name:'Show questions outside this path'}).uncheck();
  await expect(page.locator('[data-node="stack"]')).toBeHidden();await expect(page.locator('svg [data-edge]')).toHaveCount(6);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(page.getByLabel('Zoom level',{exact:true})).toHaveText('90%');
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();await expect(page.getByLabel('Zoom level',{exact:true})).toHaveText('75%');
  await page.getByRole('button',{name:'Fit width',exact:true}).click();
  expect(await page.locator('.map-viewport').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.getByRole('checkbox',{name:'Show questions outside this path'}).check();await expect(page.locator('[data-node="stack"]')).toBeVisible();
});

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
  test(`qgraph remains usable at ${viewport.width}px`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize(viewport);await page.goto('/qgraph');
    if(viewport.width<800)await expect.poll(()=>page.locator('.map-viewport').evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(await page.locator('.node').evaluateAll(nodes=>nodes.every(node=>node.scrollHeight<=node.clientHeight+1))).toBe(true);
    await page.getByRole('button',{name:'Fit width',exact:true}).click();
    expect(await page.locator('.map-viewport').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await page.locator('.map-panel').scrollIntoViewIfNeeded();
    await page.locator('.map-viewport').evaluate(el=>el.scrollTop=450);
    await page.screenshot({path:`screenshots/qgraph-${viewport.width}.png`});expect(errors).toEqual([]);
  });
}

test('every form branch has graph nodes and connectors with HATE last',()=>{
  const connections=new Set(graphEdges.map(edge=>edge.id));const ids=new Set(graphNodes.map(node=>node.id));const reached=new Set<string>();
  for(const context of choices.context)for(const stage of choices.stage)for(const burden of choices.burden)for(const workaround of ['',...choices.workaround.map(choice=>choice.value)])for(const problemCategory of ['',...problemCategoryOptions.map(choice=>choice.value)]){
    const answers={...emptyAnswers(),context:context.value,stage:stage.value,burden:burden.value,workaround,problemCategory:problemCategory?[problemCategory]:[]};
    const path=graphPath(answers);
    if(path.at(-1)!=='hate'||path.some(id=>!ids.has(id)))throw new Error('Missing graph node or incorrect final question');
    if(JSON.stringify(path.map(id=>id.startsWith('problem-')?'problem':id))!==JSON.stringify(stepsFor(answers)))throw new Error('Graph and form disagree');
    for(let i=1;i<path.length;i++){const edge=`${path[i-1]}:${path[i]}`;reached.add(edge);if(!connections.has(edge))throw new Error(`Missing connector ${edge}`);}
  }
  expect(reached.size).toBe(graphEdges.length);expect(graphNodes.length).toBe(15);
});
