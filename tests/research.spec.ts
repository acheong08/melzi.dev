import { test, expect, type Page } from '@playwright/test';
import { mockResearchApi } from './research-api-mock';
test.beforeEach(async ({ page }) => { await mockResearchApi(page); });
import { choices, emptyAnswers, responseFor, stepsFor, changeAnswer, skipAnswer, isBuilding, experiencedPain, questionFor, textQuestionFor, type Answers } from '../src/lib/research/form';

import { addStackTool, matchingTools, stackShortlist } from '../src/lib/research/stack-tools';

const hate='Anything you currently use that you absolutely HATE?';
async function openForm(page:Page){
  await page.goto('/');await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready','true');
  await page.getByRole('button',{name:'Help shape Melzi',exact:true}).click();
  await expect(page.getByRole('heading',{name:'What are you working on?',exact:true})).toBeFocused();
}
async function next(page:Page){await page.getByRole('button',{name:'Continue',exact:true}).click();}
async function skip(page:Page){await page.getByRole('button',{name:'Skip',exact:true}).click();}
async function choose(page:Page,label:string){await page.getByRole('radio',{name:label,exact:true}).check();await next(page);}
async function text(page:Page,label:string,value:string){await page.getByRole('textbox',{name:label,exact:true}).fill(value);await next(page);}
async function shortRoute(page:Page){
  await choose(page,'A side project');await choose(page,'Exploring an idea');await choose(page,'Too early to tell');
  await expect(page.getByRole('heading',{name:'What, if anything, do you expect to slow you down?',exact:true})).toBeVisible();await skip(page);
  await expect(page.getByRole('heading',{name:'What would you like next?',exact:true})).toBeVisible();
}
async function finishWithoutContact(page:Page){await choose(page,'Nothing yet, just sharing feedback');await expect(page.getByRole('heading',{name:hate,exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Email address',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Submit feedback',exact:true})).toBeVisible();await page.getByRole('button',{name:'Submit feedback',exact:true}).click();}
async function downloadResponse(page:Page){
  await expect(page.getByRole('heading',{name:'Thanks for helping shape Melzi.',exact:true})).toBeVisible();
  const promise=page.waitForEvent('download');await page.getByRole('button',{name:'Download answers'}).click();const download=await promise;
  expect(download.suggestedFilename()).toBe('melzi-research-response.json');
  const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream!)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString());
}

test('idea route asks for anticipated concerns without a hosting or workaround checklist',async({page})=>{
  const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await openForm(page);await choose(page,'A side project');await choose(page,'Exploring an idea');await choose(page,'Too early to tell');
  await expect(page.getByRole('radio')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);
  await text(page,'What, if anything, do you expect to slow you down?','I don’t know how to choose a database.');
  await finishWithoutContact(page);
  const data=await downloadResponse(page);expect(data).toMatchObject({schemaVersion:4,problemEvidence:'anticipated',problem:'I don’t know how to choose a database.'});
  for(const key of ['stack','workaroundStatus','workaroundDetails','weeklyInfrastructureTime','anythingYouHate','email'])expect(data).not.toHaveProperty(key);
  expect(posts.some(url=>url.endsWith('/v1/draft'))).toBe(true);
});

test('predeployment builders can describe their stack, pain, fixes, time, and cost',async({page})=>{
  await openForm(page);await choose(page,'A startup');await choose(page,'Building, but not deployed yet');
  await page.getByRole('checkbox',{name:'AWS',exact:true}).check();await page.getByRole('checkbox',{name:'Supabase',exact:true}).check();
  await text(page,'Anything else in your stack? (optional)','SvelteKit, Supabase, Terraform, Docker, and scripts.');
  await choose(page,'Slows down or blocks development');
  await choose(page,'Costs');
  await page.getByRole('radio',{name:'I’ve tried something',exact:true}).check();
  await text(page,'What have you tried? (optional)','Wrote a setup script and hired a consultant.');
  await choose(page,'Helped, but there’s still a problem');await choose(page,'4 to 8 hours');await choose(page,'$50 to $249');
  await page.getByRole('radio',{name:'Founder',exact:true}).check();await page.getByRole('radio',{name:'Me',exact:true}).check();await next(page);
  await choose(page,'Try an early version');await text(page,'Email address','founder@example.com');
  await expect(page.getByRole('heading',{name:hate})).toBeVisible();await page.getByRole('textbox',{name:hate}).fill('Printers. Especially their setup software.');await page.getByRole('button',{name:'Submit feedback'}).click();
  const data=await downloadResponse(page);expect(data).toMatchObject({schemaVersion:4,stage:'building',infrastructureBurden:'slows',stackTools:['AWS','Supabase'],stack:'SvelteKit, Supabase, Terraform, Docker, and scripts.',problemEvidence:'experienced',problemCategory:'cost',workaroundStatus:'tried',workaroundDetails:'Wrote a setup script and hired a consultant.',workaroundOutcome:'partly',weeklyInfrastructureTime:'4-8',costIsPartOfProblem:true,monthlySpendUsd:'50-249',anythingYouHate:'Printers. Especially their setup software.',email:'founder@example.com'});
});

test('no-problem route asks what works well and measures time without assuming pain',async({page})=>{
  await openForm(page);await choose(page,'Self-hosting tools or services');await choose(page,'Mostly stable, keeping it running');
  await text(page,'Anything else in your stack? (optional)','Docker Compose on a small VPS.');await choose(page,'Not a problem');
  await text(page,'What makes it work well for you?','Simple services and automatic updates.');await choose(page,'Almost none');
  await finishWithoutContact(page);
  const data=await downloadResponse(page);expect(data).toMatchObject({infrastructureBurden:'none',whatWorksWell:'Simple services and automatic updates.',weeklyInfrastructureTime:'none'});
  for(const key of ['problem','problemEvidence','workaroundStatus','workaroundOutcome','monthlySpendUsd'])expect(data).not.toHaveProperty(key);
});

for(const status of ['Haven’t tried anything yet','Someone else handles it']){
  test(`${status} skips the workaround outcome question`,async({page})=>{
    await openForm(page);await choose(page,'A side project');await choose(page,'Building, but not deployed yet');await skip(page);await choose(page,'Takes more time than it should');await skip(page);
    await choose(page,status);await expect(page.getByRole('heading',{name:'In a typical week, roughly how much of your time goes into infrastructure work?'})).toBeVisible();
  });
}

test('backtracking to no problem clears obsolete pain and workaround answers',async({page})=>{
  await openForm(page);await choose(page,'A side project');await choose(page,'Already running and changing frequently');await text(page,'Anything else in your stack? (optional)','Docker and Postgres');await choose(page,'Slows down or blocks development');
  await page.getByRole('radio',{name:'Something else',exact:true}).check();await text(page,'What’s frustrating you? (optional)','Old complaint');await page.getByRole('radio',{name:'I’ve tried something'}).check();await text(page,'What have you tried? (optional)','Old workaround');await choose(page,'Didn’t help');await choose(page,'More than a day');
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByRole('heading',{name:'How much of a problem is infrastructure work for you right now?'})).toBeVisible();
  await choose(page,'Not a problem');await text(page,'What makes it work well for you?','A much simpler setup');await next(page);await finishWithoutContact(page);
  const data=await downloadResponse(page);expect(data.stack).toBe('Docker and Postgres');expect(data.whatWorksWell).toBe('A much simpler setup');for(const key of ['problem','workaroundStatus','workaroundDetails','workaroundOutcome'])expect(data).not.toHaveProperty(key);
});

for(const followup of ['Just get updates','Talk through my infrastructure setup','Try an early version']){
  test(`${followup} requires a valid email with no Skip or Optional tag`,async({page})=>{
    await openForm(page);await next(page);await expect(page.getByRole('alert')).toHaveText('Choose an option to continue.');
    await shortRoute(page);await choose(page,followup);
    const email=page.getByRole('textbox',{name:'Email address',exact:true});
    await expect(email).toHaveAttribute('required','');
    await expect(page.getByRole('button',{name:'Skip',exact:true})).toHaveCount(0);
    await expect(page.locator('.step-label')).not.toContainText('Optional');
    for(const blank of ['', '   ']){
      await email.fill(blank);await next(page);
      await expect(page.getByRole('alert')).toHaveText('Enter your email address.');
      await expect(email).toBeFocused();await expect(email).toHaveAttribute('aria-invalid','true');
      await expect(page.getByRole('heading',{name:'Where can we reach you?',exact:true})).toBeVisible();
    }
    await email.fill('not-an-email');await next(page);
    await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.');await expect(email).toBeFocused();
    await expect(page.getByRole('heading',{name:'Where can we reach you?',exact:true})).toBeVisible();
    await email.fill('person@example.com');await expect(page.getByRole('alert')).toHaveCount(0);await next(page);
    await expect(page.getByRole('heading',{name:hate,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Submit feedback',exact:true})).toBeVisible();await page.getByRole('button',{name:'Submit feedback',exact:true}).click();
    expect(await downloadResponse(page)).toMatchObject({schemaVersion:4,email:'person@example.com'});
  });
}

for(const provideTeamDetails of [true,false]){
  test(`company context offers the optional team step with ${provideTeamDetails?'answers':'Skip'}`,async({page})=>{
    await openForm(page);await choose(page,'Engineering at an established company');await choose(page,'Exploring an idea');await choose(page,'Not a problem');
    await expect(page.getByRole('heading',{name:'A little about your team',exact:true})).toBeVisible();
    await expect(page.locator('.step-label')).toContainText('Optional');
    if(provideTeamDetails){
      await page.getByRole('radio',{name:'Engineering',exact:true}).check();await page.getByRole('radio',{name:'Shared across the team',exact:true}).check();await next(page);
    }else await skip(page);
    await finishWithoutContact(page);
    expect(await downloadResponse(page)).toMatchObject({schemaVersion:4,context:'company',role:provideTeamDetails?'engineering':null,infrastructureOwner:provideTeamDetails?'shared':null,nextStep:'none'});
  });
}

for(const details of ['', '  A community research project  ']){
  test(`Other context accepts ${details?'trimmed details':'blank optional details'} and clears text on context changes`,async({page})=>{
    await openForm(page);await page.getByRole('radio',{name:'Something else',exact:true}).check();
    const input=page.getByRole('textbox',{name:'What are you working on? (optional)',exact:true});
    await input.fill('Obsolete context');await page.getByRole('radio',{name:'Engineering at an established company',exact:true}).check();
    await expect(input).toHaveCount(0);await page.getByRole('radio',{name:'Something else',exact:true}).check();await expect(input).toHaveValue('');
    await input.fill(details);await next(page);await choose(page,'Exploring an idea');await choose(page,'Not a problem');
    await expect(page.getByRole('heading',{name:'What would you like next?',exact:true})).toBeVisible();await finishWithoutContact(page);
    const data=await downloadResponse(page);expect(data).toMatchObject({schemaVersion:4,context:'other'});
    if(details){expect(data.contextDetails).toBe(details.trim());await expect(page.locator('.response-summary')).toContainText(details.trim());}
    else expect(data).not.toHaveProperty('contextDetails');
    for(const key of ['role','infrastructureOwner','email'])expect(data).not.toHaveProperty(key);
  });
}

for(const details of ['', '  Keeping preview environments aligned  ']){
  test(`Other frustration accepts ${details?'trimmed details':'blank optional details'} and resets when category changes`,async({page})=>{
    await openForm(page);await choose(page,'A side project');await choose(page,'Building, but not deployed yet');await skip(page);await choose(page,'Takes more time than it should');
    await expect(page.getByRole('heading',{name:'What’s the most frustrating part of infrastructure work?',exact:true})).toBeVisible();
    await page.getByRole('radio',{name:'Something else',exact:true}).check();
    const input=page.getByRole('textbox',{name:'What’s frustrating you? (optional)',exact:true});
    await input.fill('Obsolete frustration');await page.getByRole('radio',{name:'Setup and configuration',exact:true}).check();await expect(input).toHaveCount(0);
    await page.getByRole('radio',{name:'Something else',exact:true}).check();await expect(input).toHaveValue('');await input.fill(details);await next(page);
    await expect(page.getByRole('heading',{name:'What have you done to make infrastructure work less painful?',exact:true})).toBeVisible();
    await choose(page,'Haven’t tried anything yet');await skip(page);await finishWithoutContact(page);
    const data=await downloadResponse(page);expect(data).toMatchObject({schemaVersion:4,problemCategory:'other',problemEvidence:'experienced'});
    if(details){expect(data.problem).toBe(details.trim());await expect(page.locator('.response-summary')).toContainText(details.trim());}
    else expect(data).not.toHaveProperty('problem');
    expect(data).not.toHaveProperty('monthlySpendUsd');expect(data).not.toHaveProperty('costIsPartOfProblem');
  });
}

test('rendered choices match revised option counts without obsolete controls',async({page})=>{
  const assertChoices=async(field:keyof typeof choices)=>{
    await expect(page.getByRole('radio')).toHaveCount(choices[field].length);
    for(const option of choices[field])await expect(page.getByRole('radio',{name:option.label,exact:true})).toBeVisible();
  };
  await openForm(page);await assertChoices('context');await choose(page,'A side project');await assertChoices('stage');
  await expect(page.getByRole('radio',{name:'Ready to start building',exact:true})).toHaveCount(0);
  await choose(page,'Building, but not deployed yet');await skip(page);await assertChoices('burden');await choose(page,'Slows down or blocks development');
  await assertChoices('problemCategory');await expect(page.getByRole('textbox')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);
  await choose(page,'Maintenance and security');await assertChoices('workaround');await choose(page,'Someone else handles it');await assertChoices('timeSpent');
  await expect(page.getByRole('radio',{name:'Less than an hour',exact:true})).toHaveCount(0);await choose(page,'1 to 3 hours');await assertChoices('next');
  await expect(page.getByRole('radio',{name:'See a demo',exact:true})).toHaveCount(0);await finishWithoutContact(page);
});

test('drafts, focus restoration, and keyboard containment still work',async({page})=>{
  await openForm(page);await shortRoute(page);await choose(page,'Nothing yet, just sharing feedback');await page.getByRole('textbox',{name:hate}).fill('My printer drivers');await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Help shape Melzi',exact:true})).toBeFocused();await page.getByRole('button',{name:'Help shape Melzi',exact:true}).click();
  await expect(page.getByRole('textbox',{name:hate})).toHaveValue('My printer drivers');await expect(page.getByRole('heading',{name:hate})).toBeFocused();
  for(let i=0;i<10;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);}
});

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
  test(`open research questions fit at ${viewport.width}x${viewport.height}`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize(viewport);await openForm(page);await choose(page,'A side project');await choose(page,'Building, but not deployed yet');
    await text(page,'Anything else in your stack? (optional)','A framework, managed database, and homegrown scripts.');
    await page.screenshot({path:`screenshots/research-burden-${viewport.width}.png`});await choose(page,'Takes more time than it should');
    await page.getByRole('radio',{name:'Something else',exact:true}).check();
    await page.getByRole('textbox',{name:'What’s frustrating you? (optional)',exact:true}).fill('I lose a day each week to configuration differences.');
    const bounds=await page.getByRole('dialog').boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
    const footer=await page.getByRole('button',{name:'Continue',exact:true}).boundingBox();expect(footer!.y+footer!.height).toBeLessThan(viewport.height);
    expect(await page.locator('.question-body').evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);await page.screenshot({path:`screenshots/research-open-problem-${viewport.width}.png`});
    await next(page);await page.getByRole('radio',{name:'I’ve tried something'}).check();await page.getByRole('textbox',{name:'What have you tried? (optional)'}).fill('A script and some automation.');await page.screenshot({path:`screenshots/research-workaround-${viewport.width}.png`});expect(errors).toEqual([]);
  });
}

test('stack picker supports suggestions, alias search, custom tools, removal, and back navigation',async({page})=>{
  await openForm(page);await choose(page,'A side project');await choose(page,'Building, but not deployed yet');
  await expect(page.getByRole('textbox',{name:'Anything else in your stack? (optional)'})).toBeVisible();
  await expect(page.locator('#stack-results input')).toHaveCount(10);
  await page.getByRole('checkbox',{name:'AWS',exact:true}).check();await page.getByRole('checkbox',{name:'Vercel',exact:true}).check();
  const search=page.getByRole('searchbox',{name:'Search tools'});await search.fill('gcp');await page.getByRole('checkbox',{name:'Google Cloud',exact:true}).check();
  await expect(page.getByRole('button',{name:'Remove AWS',exact:true})).toBeVisible();
  await search.fill('Internal deployer');await page.getByRole('button',{name:'Add “Internal deployer”',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove Internal deployer',exact:true})).toBeVisible();await expect(search).toHaveValue('');
  await search.fill('  internal deployer  ');await search.press('Enter');await expect(page.getByRole('button',{name:'Remove Internal deployer',exact:true})).toHaveCount(1);
  await search.fill('Postgres');await search.press('Enter');await expect(page.getByRole('button',{name:'Remove PostgreSQL',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'What are you building with today?'})).toBeVisible();
  await page.getByRole('button',{name:'Remove AWS',exact:true}).click();await expect(search).toBeFocused();
  await text(page,'Anything else in your stack? (optional)','A few homegrown scripts.');await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Vercel',exact:true})).toBeChecked();await expect(page.getByRole('textbox',{name:'Anything else in your stack? (optional)'})).toHaveValue('A few homegrown scripts.');
  await next(page);await choose(page,'Not a problem');await skip(page);await skip(page);await finishWithoutContact(page);
  const data=await downloadResponse(page);expect(data.stackTools).toEqual(['Vercel','Google Cloud','Internal deployer','PostgreSQL']);expect(data.stack).toBe('A few homegrown scripts.');
});

for(const width of [1440,320]){
  test(`hybrid stack picker fits at ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===320?568:900});await openForm(page);await choose(page,'A side project');await choose(page,'Building, but not deployed yet');
    await page.getByRole('checkbox',{name:'AWS',exact:true}).check();await page.getByRole('checkbox',{name:'Railway',exact:true}).check();
    await page.screenshot({path:`screenshots/stack-picker-${width}.png`});
    await page.getByRole('searchbox',{name:'Search tools'}).fill('Our internal deployment tool');await page.getByRole('button',{name:'Add “Our internal deployment tool”'}).click();
    await page.getByRole('textbox',{name:'Anything else in your stack? (optional)'}).fill('Terraform and a few scripts.');
    expect(await page.locator('.question-body').evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
    const bounds=await page.getByRole('button',{name:'Continue',exact:true}).boundingBox();expect(bounds!.y+bounds!.height).toBeLessThan(width===320?568:900);
    await skip(page);await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.locator('.selected-tools button')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Anything else in your stack? (optional)'})).toHaveValue('');
  });
}

test('custom stack names are normalized and aliases cannot create duplicates',()=>{
  expect(matchingTools('').map(tool=>tool.name)).toEqual(stackShortlist);
  expect(matchingTools('gcp').map(tool=>tool.name)).toEqual(['Google Cloud']);
  expect(addStackTool(['AWS'],'amazon web services')).toEqual(['AWS']);
  expect(addStackTool(['My Tool'],'  my   tool  ')).toEqual(['My Tool']);
  expect(addStackTool([],'   ')).toEqual([]);expect(addStackTool([],'x'.repeat(81))).toEqual([]);
  const a={...emptyAnswers(),stage:'building',stack:'Notes',stackTools:['AWS','Custom tool'],next:'updates'};
  expect(stepsFor(a).slice(-3)).toEqual(['next','contact','hate']);
  expect(stepsFor({...a,next:'none'}).slice(-2)).toEqual(['next','hate']);
  expect(skipAnswer(a,'stack').stackTools).toEqual([]);expect(changeAnswer(a,'stage','idea').stackTools).toEqual([]);
  expect(responseFor({...a,stage:'idea'})).not.toHaveProperty('stackTools');
});

test('branch matrix and exported responses omit hidden answers',()=>{
  for(const stage of choices.stage)for(const burden of choices.burden)for(const category of choices.problemCategory)for(const workaround of choices.workaround){
    const a:Answers={...emptyAnswers(),context:'side-project',contextDetails:'Stale context',stage:stage.value,burden:burden.value,stack:'Stale stack',problemCategory:category.value,problem:'Stale pain',workingWell:'Stale positive',workaround:workaround.value,workaroundDetails:'Stale fix',outcome:'no',timeSpent:'over-day',spend:'5000-plus',role:'founder',owner:'me',next:'none',email:'old@example.com'};
    const steps=stepsFor(a),data=responseFor(a),pain=experiencedPain(a),cost=pain&&category.value==='cost';
    expect(data.schemaVersion).toBe(4);
    expect(steps.includes('stack')).toBe(isBuilding(a));expect(steps.includes('timeSpent')).toBe(isBuilding(a));expect(steps.includes('workaround')).toBe(pain);expect(steps.includes('outcome')).toBe(pain&&a.workaround==='tried');expect(steps.includes('spend')).toBe(cost);
    expect(steps.slice(-2)).toEqual(['next','hate']);expect(steps).not.toContain('startup');
    for(const key of ['role','infrastructureOwner','email','contextDetails'])expect(data).not.toHaveProperty(key);
    if(!isBuilding(a)){expect(data).not.toHaveProperty('stack');expect(data).not.toHaveProperty('weeklyInfrastructureTime');}
    if(!pain){for(const key of ['problemCategory','workaroundStatus','workaroundDetails','workaroundOutcome'])expect(data).not.toHaveProperty(key);}
    if(cost)expect(data).toMatchObject({costIsPartOfProblem:true,monthlySpendUsd:'5000-plus'});
    else for(const key of ['costIsPartOfProblem','monthlySpendUsd'])expect(data).not.toHaveProperty(key);
    if(burden.value==='none'){expect(data).not.toHaveProperty('problem');expect(data).not.toHaveProperty('problemEvidence');}
    else {
      expect(data.problemEvidence).toBe(pain?'experienced':'anticipated');
      if(!pain||category.value==='other')expect(data.problem).toBe('Stale pain');else expect(data).not.toHaveProperty('problem');
    }
    if(!(isBuilding(a)&&burden.value==='none'))expect(data).not.toHaveProperty('whatWorksWell');
    if(a.workaround!=='tried'){expect(data).not.toHaveProperty('workaroundDetails');expect(data).not.toHaveProperty('workaroundOutcome');}
    for(const step of steps){expect(JSON.stringify([questionFor(step,a),textQuestionFor(step,a)])).not.toContain('\u2014');}
  }
  expect(JSON.stringify(choices)).not.toContain('\u2014');
});

test('changing stage or skipping workarounds resets dependent answers',()=>{
  const a:Answers={...emptyAnswers(),stage:'building',burden:'slows',stack:'Tools',stackTools:['AWS'],problemCategory:'cost',problem:'Pain',workaround:'tried',workaroundDetails:'Fix',outcome:'partly',spend:'50-249',timeSpent:'4-8'};
  const early=changeAnswer(a,'stage','idea');for(const key of ['stack','burden','problemCategory','problem','workaround','workaroundDetails','outcome','spend','timeSpent'])expect(early[key as keyof Answers]).toBe('');expect(early.stackTools).toEqual([]);
  const skipped=skipAnswer(a,'workaround');expect(skipped.workaround).toBe('');expect(skipped.workaroundDetails).toBe('');expect(skipped.outcome).toBe('');expect(stepsFor(skipped)).not.toContain('outcome');
  const problemSkipped=skipAnswer(a,'problem');expect(problemSkipped).toMatchObject({problemCategory:'',problem:'',spend:''});expect(stepsFor(problemSkipped)).not.toContain('spend');
});

test('revised option sets remove ready, demo, and less-than-hour choices',()=>{
  expect(choices.context.map(option=>option.value)).toEqual(['self-host','side-project','startup','company','other']);
  expect(choices.stage.map(option=>option.value)).toEqual(['idea','building','changing','stable']);
  expect(choices.burden).toEqual([
    {value:'none',label:'Not a problem'},
    {value:'time',label:'Takes more time than it should'},
    {value:'slows',label:'Slows down or blocks development'},
    {value:'early',label:'Too early to tell'}
  ]);
  expect(choices.problemCategory).toEqual([
    {value:'setup',label:'Setup and configuration'},
    {value:'maintenance',label:'Maintenance and security'},
    {value:'testing',label:'Testing and deployments'},
    {value:'cost',label:'Costs'},
    {value:'other',label:'Something else'}
  ]);
  expect(choices.timeSpent.map(option=>option.value)).toEqual(['none','1-3','4-8','over-day','varies']);
  expect(choices.next.map(option=>option.value)).toEqual(['try','chat','updates','none']);
});

test('context, category, burden, and followup changes clear dependent details',()=>{
  const a:Answers={...emptyAnswers(),context:'other',contextDetails:'An internal tool',stage:'building',burden:'slows',problemCategory:'other',problem:'Old frustration',workaround:'tried',workaroundDetails:'Old fix',outcome:'no',spend:'5000-plus',next:'updates',email:'old@example.com'};
  const categorized=changeAnswer(a,'problemCategory','setup');expect(categorized).toMatchObject({problem:'',spend:''});expect(responseFor(categorized)).not.toHaveProperty('problem');
  const cost=changeAnswer(a,'problemCategory','cost');expect(cost.problem).toBe('');expect(stepsFor(cost)).toContain('spend');
  for(const burden of ['none','early']){
    const changed=changeAnswer(a,'burden',burden);
    for(const key of ['problem','problemCategory','workaround','workaroundDetails','outcome','spend'])expect(changed[key as keyof Answers]).toBe('');
    expect(stepsFor(changed)).not.toContain('workaround');expect(stepsFor(changed)).not.toContain('spend');
  }
  expect(changeAnswer({...a,burden:'none',workingWell:'Managed hosting'},'burden','time').workingWell).toBe('');
  for(const context of ['startup','company']){
    const team=changeAnswer(a,'context',context);expect(team.contextDetails).toBe('');expect(stepsFor(team)).toContain('startup');
    expect(responseFor(team)).toMatchObject({role:null,infrastructureOwner:null});expect(responseFor(team)).not.toHaveProperty('contextDetails');
    const populated={...team,role:'engineering',owner:'shared'};
    expect(changeAnswer(populated,'context',context==='startup'?'company':'startup')).toMatchObject({role:'engineering',owner:'shared'});
    expect(changeAnswer(populated,'context','side-project')).toMatchObject({role:'',owner:''});
    expect(skipAnswer(populated,'startup')).toMatchObject({role:'',owner:''});
  }
  expect(changeAnswer(a,'next','none').email).toBe('');
  const contact={...a,next:'updates'};expect(skipAnswer(contact,'contact')).toEqual(contact);
});
