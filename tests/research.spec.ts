import { test, expect, type Page } from '@playwright/test';
import { mockResearchApi } from './research-api-mock';
type Api=ReturnType<typeof mockResearchApi>;
import { choices, emptyAnswers, responseFor, stepsFor, changeAnswer, skipAnswer, isBuilding, experiencedPain, questionFor, textQuestionFor, stackWhyOptions, type Answers } from '../src/lib/research/form';

import { addStackTool, matchingTools, stackShortlist } from '../src/lib/research/stack-tools';

const hate='Anything you currently use that you absolutely HATE?';
const emailStep='Where can we reach you?';
async function openForm(page:Page){
  await page.goto('/');await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready','true');
  await page.getByRole('button',{name:'Help shape Melzi',exact:true}).click();
  await expect(page.getByRole('heading',{name:'What are you working on?',exact:true})).toBeFocused();
}
async function next(page:Page){await page.getByRole('button',{name:'Continue',exact:true}).click();}
async function skip(page:Page){await page.getByRole('button',{name:'Skip',exact:true}).click();}
async function choose(page:Page,label:string){await page.getByRole('radio',{name:label,exact:true}).check();await next(page);}
async function text(page:Page,label:string,value:string){await page.getByRole('textbox',{name:label,exact:true}).fill(value);await next(page);}
async function sideProjectRoute(page:Page,stage='Exploring an idea'){
  await choose(page,'A side project');await skip(page);await choose(page,stage);
}
async function finish(page:Page){
  await fillContact(page);await next(page);
  await page.getByRole('button',{name:'Submit feedback'}).click();
}
async function fillContact(page:Page,email='person@example.com',phone=''){
  await expect(page.getByRole('heading',{name:emailStep,exact:true})).toBeVisible();
  const emailInput=page.getByRole('textbox',{name:'Email address',exact:true});
  await expect(emailInput).toHaveAttribute('required','');
  const phoneInput=page.getByRole('textbox',{name:/Phone number \(optional/});
  await expect(phoneInput).toBeVisible();await expect(page.getByRole('button',{name:'Skip',exact:true})).toHaveCount(0);
  await emailInput.fill(email);
  if(phone)await phoneInput.fill(phone);
}
async function submitted(api:Api){
  const records=[...api.records.values()];
  expect(records.some(record=>record.completed)).toBe(true);
  return responseFor(records.find(record=>record.completed)!.answers);
}
function draft(api:Api){return [...api.records.values()].at(-1)!.answers;}

test('idea route asks the required anticipated-issues question instead of free text',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await sideProjectRoute(page);await choose(page,'Too early to tell');
  await expect(page.getByRole('radio',{name:'Yes',exact:true})).toBeVisible();
  await next(page);await expect(page.getByRole('alert')).toHaveText('Choose an option to continue.');
  await page.getByRole('radio',{name:'Yes',exact:true}).check();
  await expect(page.getByRole('textbox',{name:'What kind of issues do you expect? (optional)',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'What kind of issues do you expect? (optional)',exact:true}).fill('I don’t know how to choose a database.');
  await next(page);
  await fillContact(page);await next(page);
  await expect(page.getByRole('heading',{name:hate,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Submit feedback',exact:true})).toBeVisible();await page.getByRole('button',{name:'Submit feedback',exact:true}).click();
  const data=await submitted(api);
  expect(data).toMatchObject({schemaVersion:5,problemEvidence:'anticipated',anticipatedIssues:'yes',anticipatedIssueDetails:'I don’t know how to choose a database.'});
  for(const key of ['stack','workaroundStatus','workaroundDetails','weeklyInfrastructureTime','nextStep','anythingYouHate'])expect(data).not.toHaveProperty(key);
});

test('predeployment builders describe stack, why, pain, fixes, and cost without time estimates',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await choose(page,'A startup');await choose(page,'Founder');
  await choose(page,'Building, but not deployed yet');
  await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
  await expect(page.getByRole('heading',{name:'What are you building with today?'})).toBeVisible();
  await page.getByRole('checkbox',{name:'Supabase',exact:true}).check();
  await expect(page.locator('.stack-why')).toBeVisible();
  await page.getByRole('checkbox',{name:'Prior experience',exact:true}).check();
  await next(page);await choose(page,'Slows down or blocks development');await choose(page,'Costs');
  await page.getByRole('radio',{name:'I’ve tried something',exact:true}).check();
  await text(page,'What have you tried? (optional)','Wrote a setup script and hired a consultant.');
  await choose(page,'Helped, but there’s still a problem');await choose(page,'$50 to $249');
  await page.getByRole('radio',{name:'Me',exact:true}).check();await next(page);
  await fillContact(page,'founder@example.com','+1 555 000 0000');await next(page);
  await expect(page.getByRole('heading',{name:hate})).toBeVisible();
  await page.getByRole('textbox',{name:hate}).fill('Printers. Especially their setup software.');
  await page.getByRole('button',{name:'Submit feedback'}).click();
  const data=await submitted(api);
  expect(data).toMatchObject({schemaVersion:5,stage:'building',infrastructureBurden:'slows',role:'founder',stackTools:['AWS','Supabase'],stackWhy:['experience'],problemEvidence:'experienced',problemCategory:'cost',workaroundStatus:'tried',workaroundDetails:'Wrote a setup script and hired a consultant.',workaroundOutcome:'partly',costIsPartOfProblem:true,monthlySpendUsd:'50-249',infrastructureOwner:'me',email:'founder@example.com',phone:'+1 555 000 0000',anythingYouHate:'Printers. Especially their setup software.'});
  for(const key of ['weeklyInfrastructureTime','nextStep','stack','stackOtherDetails'])expect(data).not.toHaveProperty(key);
});

test('no-problem route asks what works well and never assumes pain',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await choose(page,'Self-hosting tools or services');
  await text(page,'Tell us a few words about your side project','Home lab services.');
  await choose(page,'Mostly stable, keeping it running');
  await page.getByRole('checkbox',{name:'Own hardware',exact:true}).check();
  await expect(page.locator('.stack-why')).toBeVisible();
  await page.getByRole('checkbox',{name:'Prior experience',exact:true}).check();await next(page);
  await choose(page,'Not a problem');
  await text(page,'What makes it work well for you?','Simple services and automatic updates.');
  await finish(page);
  const data=await submitted(api);
  expect(data).toMatchObject({infrastructureBurden:'none',sideProjectNotes:'Home lab services.',whatWorksWell:'Simple services and automatic updates.',stackWhy:['experience']});
  for(const key of ['problem','problemEvidence','workaroundStatus','workaroundOutcome','monthlySpendUsd','weeklyInfrastructureTime'])expect(data).not.toHaveProperty(key);
});

for(const status of ['Haven’t tried anything yet','Someone else handles it']){
  test(`${status} goes straight to contact without time or follow-up questions`,async({page})=>{
  const api=await mockResearchApi(page); void api;
    await openForm(page);await sideProjectRoute(page,'Building, but not deployed yet');
    await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
    await page.getByRole('checkbox',{name:'Ease of use',exact:true}).check();await next(page);
    await choose(page,'Takes more time than it should');await choose(page,'Setup and configuration');
    await choose(page,status);await expect(page.getByRole('heading',{name:emailStep,exact:true})).toBeVisible();
  });
}

test('backtracking to no problem clears obsolete pain and workaround answers',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await sideProjectRoute(page,'Already running and changing frequently');
  await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
  await page.getByRole('checkbox',{name:'Cost',exact:true}).check();await next(page);
  await choose(page,'Slows down or blocks development');
  await page.getByRole('radio',{name:'Something else',exact:true}).check();await text(page,'What’s frustrating you? (optional)','Old complaint');
  await page.getByRole('radio',{name:'I’ve tried something'}).check();await text(page,'What have you tried? (optional)','Old workaround');await choose(page,'Didn’t help');
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByRole('heading',{name:'How much of a problem is infrastructure work for you right now?'})).toBeVisible();
  await choose(page,'Not a problem');await text(page,'What makes it work well for you?','A much simpler setup');
  await finish(page);
  const data=await submitted(api);
  expect(data.stackTools).toEqual(['AWS']);expect(data.whatWorksWell).toBe('A much simpler setup');
  for(const key of ['problem','workaroundStatus','workaroundDetails','workaroundOutcome'])expect(data).not.toHaveProperty(key);
});

test('contact requires a valid email, offers an optional phone, and has no Skip',async({page})=>{
  const api=await mockResearchApi(page); void api;
  await openForm(page);await sideProjectRoute(page);
  await choose(page,'Not a problem');await fillContact(page,'');
  const email=page.getByRole('textbox',{name:'Email address',exact:true});
  for(const blank of ['', '   ']){await email.fill(blank);await next(page);
    await expect(page.getByRole('alert')).toHaveText('Enter your email address.');
    await expect(email).toBeFocused();await expect(email).toHaveAttribute('aria-invalid','true');
    await expect(page.getByRole('heading',{name:emailStep,exact:true})).toBeVisible();}
  await email.fill('not-an-email');await next(page);
  await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.');await expect(email).toBeFocused();
  await email.fill('person@example.com');await expect(page.getByRole('alert')).toHaveCount(0);await next(page);
  await expect(page.getByRole('heading',{name:hate,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Submit feedback',exact:true})).toBeVisible();
});

for(const provideTeamDetails of [true,false]){
  test(`company context makes role the second question and team owner ${provideTeamDetails?'answered':'required'}`,async({page})=>{
    const api=await mockResearchApi(page);
    await openForm(page);await choose(page,'Engineering at an established company');
    await expect(page.locator('.step-label')).toContainText('Question 2');
    await expect(page.getByRole('button',{name:'Skip',exact:true})).toHaveCount(0);
    await choose(page,'Engineering');await choose(page,'Exploring an idea');await choose(page,'Not a problem');
    await expect(page.getByRole('heading',{name:'A little about your team',exact:true})).toBeVisible();
    if(provideTeamDetails){await page.getByRole('radio',{name:'Shared across the team',exact:true}).check();await next(page);}
    else{await next(page);await expect(page.getByRole('alert')).toHaveText('Choose an option to continue.');
      await page.getByRole('radio',{name:'Shared across the team',exact:true}).check();await next(page);}
    await finish(page);
    const data=await submitted(api);
    expect(data).toMatchObject({context:'company',role:'engineering',infrastructureOwner:'shared'});
  });
}

for(const details of ['', '  A community research project  ']){
  test(`Other context accepts ${details?'trimmed details':'blank optional details'} and clears text on context changes`,async({page})=>{
    const api=await mockResearchApi(page);
    await openForm(page);await page.getByRole('radio',{name:'Something else',exact:true}).check();
    const input=page.getByRole('textbox',{name:'What are you working on? (optional)',exact:true});
    await input.fill('Obsolete context');await page.getByRole('radio',{name:'Engineering at an established company',exact:true}).check();
    await expect(input).toHaveCount(0);await page.getByRole('radio',{name:'Something else',exact:true}).check();await expect(input).toHaveValue('');
    await input.fill(details);await next(page);await choose(page,'Exploring an idea');await choose(page,'Not a problem');
    await finish(page);
    const data=await submitted(api);expect(data).toMatchObject({schemaVersion:5,context:'other'});
    if(details)expect(data.contextDetails).toBe(details.trim());
    else expect(data).not.toHaveProperty('contextDetails');
    for(const key of ['role','infrastructureOwner'])expect(data).not.toHaveProperty(key);
  });
}

for(const details of ['', '  Keeping preview environments aligned  ']){
  test(`Other frustration accepts ${details?'trimmed details':'blank optional details'} and resets when category changes`,async({page})=>{
    const api=await mockResearchApi(page);
    await openForm(page);await sideProjectRoute(page,'Building, but not deployed yet');
    await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
    await page.getByRole('checkbox',{name:'Cost',exact:true}).check();await next(page);
    await choose(page,'Takes more time than it should');
    await expect(page.getByRole('heading',{name:'What’s the most frustrating part of infrastructure work?',exact:true})).toBeVisible();
    await expect(page.locator('.step-label')).not.toContainText('Optional');
    await page.getByRole('radio',{name:'Something else',exact:true}).check();
    const input=page.getByRole('textbox',{name:'What’s frustrating you? (optional)',exact:true});
    await input.fill('Obsolete frustration');await page.getByRole('radio',{name:'Setup and configuration',exact:true}).check();await expect(input).toHaveCount(0);
    await page.getByRole('radio',{name:'Something else',exact:true}).check();await expect(input).toHaveValue('');await input.fill(details);await next(page);
    await expect(page.getByRole('heading',{name:'What have you done to make infrastructure work less painful?',exact:true})).toBeVisible();
    await choose(page,'Haven’t tried anything yet');
    await finish(page);
    const data=await submitted(api);expect(data).toMatchObject({schemaVersion:5,problemCategory:'other',problemEvidence:'experienced'});
    if(details)expect(data.problem).toBe(details.trim());
    else expect(data).not.toHaveProperty('problem');
    expect(data).not.toHaveProperty('monthlySpendUsd');expect(data).not.toHaveProperty('costIsPartOfProblem');
  });
}
test('rendered choices match revised option counts without obsolete controls',async({page})=>{
  const api=await mockResearchApi(page); void api;
  const assertChoices=async(field:keyof typeof choices)=>{
    await expect(page.getByRole('radio')).toHaveCount(choices[field].length);
    for(const option of choices[field])await expect(page.getByRole('radio',{name:option.label,exact:true})).toBeVisible();
  };
  await openForm(page);await assertChoices('context');await choose(page,'A side project');
  await expect(page.getByRole('heading',{name:'Tell us a few words about your side project',exact:true})).toBeVisible();
  await expect(page.locator('.step-label')).toContainText('Optional');await skip(page);
  await assertChoices('stage');await choose(page,'Exploring an idea');await assertChoices('burden');
  await choose(page,'Too early to tell');await assertChoices('anticipateIssues');
  await expect(page.getByRole('radio',{name:'Less than an hour',exact:true})).toHaveCount(0);
  await expect(page.getByRole('radio',{name:'See a demo',exact:true})).toHaveCount(0);
  await expect(page.getByRole('radio',{name:'Nothing yet, just sharing feedback',exact:true})).toHaveCount(0);
});

test('drafts, focus restoration, and keyboard containment still work',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await sideProjectRoute(page);await choose(page,'Too early to tell');await choose(page,'No');
  await fillContact(page);await next(page);await page.getByRole('textbox',{name:hate}).fill('My printer drivers');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Help shape Melzi',exact:true})).toBeFocused();await page.getByRole('button',{name:'Help shape Melzi',exact:true}).click();
  await expect(page.getByRole('textbox',{name:hate})).toHaveValue('My printer drivers');await expect(page.getByRole('heading',{name:hate})).toBeFocused();
  for(let i=0;i<10;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);}
});

test('the header promises two minutes, then counts down the last questions',async({page})=>{
  await openForm(page);
  await expect(page.locator('.save-note')).toHaveText('This should only take 2 mins :)');
  await choose(page,'A startup');await choose(page,'Founder');await choose(page,'Building, but not deployed yet');
  await expect(page.locator('.save-note')).toHaveText('This should only take 2 mins :)');
  await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
  await page.getByRole('checkbox',{name:'Ease of use',exact:true}).check();await next(page);
  await choose(page,'Not a problem');
  await expect(page.locator('.save-note')).toHaveText('Just a few questions left :)');
  await text(page,'What makes it work well for you?','It is quiet.');
  await expect(page.locator('.save-note')).toHaveText('Just a few questions left :)');
  await choose(page,'Me');
  await fillContact(page);await next(page);
  await expect(page.locator('.save-note')).toHaveText('Only 1 question left :)');
  await expect(page.getByRole('heading',{name:hate,exact:true})).toBeVisible();
});

test('the final page thanks without a summary or downloads and links the Discord badge',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await sideProjectRoute(page);await choose(page,'Not a problem');
  await finish(page);
  await expect(page.getByRole('heading',{name:'Thanks for helping shape Melzi.',exact:true})).toBeVisible();
  await expect(page.locator('.response-summary')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Download answers'})).toHaveCount(0);
  const badge=page.getByRole('link',{name:'Join us on Discord'});
  await expect(badge).toBeVisible();await expect(badge).toHaveAttribute('href','https://discord.com/invite/YXa8xaA4Gu');
  await expect(page.getByRole('button',{name:'Close',exact:true})).toBeVisible();
  expect([...api.records.values()].some(record=>record.completed)).toBe(true);
});

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
  test(`open research questions fit at ${viewport.width}x${viewport.height}`,async({page})=>{
  const api=await mockResearchApi(page);
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize(viewport);await openForm(page);await sideProjectRoute(page,'Building, but not deployed yet');
    await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
    await page.getByRole('checkbox',{name:'Ease of use',exact:true}).check();
    await page.screenshot({path:`screenshots/research-burden-${viewport.width}.png`});await next(page);await choose(page,'Takes more time than it should');
    await page.getByRole('radio',{name:'Something else',exact:true}).check();
    await page.getByRole('textbox',{name:'What’s frustrating you? (optional)',exact:true}).fill('I lose a day each week to configuration differences.');
    const bounds=await page.getByRole('dialog').boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
    const footer=await page.getByRole('button',{name:'Continue',exact:true}).boundingBox();expect(footer!.y+footer!.height).toBeLessThan(viewport.height);
    expect(await page.locator('.question-body').evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);await page.screenshot({path:`screenshots/research-open-problem-${viewport.width}.png`});
    await next(page);await page.getByRole('radio',{name:'I’ve tried something'}).check();await page.getByRole('textbox',{name:'What have you tried? (optional)'}).fill('A script and some automation.');await page.screenshot({path:`screenshots/research-workaround-${viewport.width}.png`});expect(errors).toEqual([]);
  });
}

test('stack picker supports suggestions, aliases, custom tools, Other, why, removal, and back navigation',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await sideProjectRoute(page,'Building, but not deployed yet');
  await expect(page.locator('.stack-why')).toHaveCount(0);
  await expect(page.locator('#stack-results input')).toHaveCount(10);
  await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
  await expect(page.locator('.stack-why')).toBeVisible();
  await page.getByRole('checkbox',{name:'Vercel',exact:true}).check();
  const search=page.getByRole('searchbox',{name:'Search tools'});await search.fill('gcp');await page.getByRole('checkbox',{name:'Google Cloud',exact:true}).check();
  await expect(page.getByRole('button',{name:'Remove AWS',exact:true})).toBeVisible();
  await search.fill('Internal deployer');await page.getByRole('button',{name:'Add “Internal deployer”',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove Internal deployer',exact:true})).toBeVisible();await expect(search).toHaveValue('');
  await search.fill('  internal deployer  ');await search.press('Enter');await expect(page.getByRole('button',{name:'Remove Internal deployer',exact:true})).toHaveCount(1);
  await search.fill('Postgres');await search.press('Enter');await expect(page.getByRole('button',{name:'Remove PostgreSQL',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'What are you building with today?'})).toBeVisible();
  await page.locator('input[name="stackOther"]').check();
  await expect(page.getByRole('textbox',{name:'What do you use that isn’t listed? (optional)',exact:true})).toBeVisible();
  await page.locator('input[name="stackOther"]').uncheck();
  await expect(page.getByRole('textbox',{name:'What do you use that isn’t listed? (optional)',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Remove AWS',exact:true}).click();await expect(search).toBeFocused();
  await page.locator('input[name="stackOther"]').check();
  await page.getByRole('textbox',{name:'What do you use that isn’t listed? (optional)',exact:true}).fill('A few homegrown scripts.');
  await page.getByRole('checkbox',{name:'Reputation',exact:true}).check();await next(page);
  await choose(page,'Not a problem');await skip(page);
  await finish(page);
  await expect(page.getByRole('heading',{name:'Thanks for helping shape Melzi.',exact:true})).toBeVisible();
});

test('required stack and why selections block Continue until answered',async({page})=>{
  const api=await mockResearchApi(page);
  await openForm(page);await sideProjectRoute(page,'Building, but not deployed yet');
  await next(page);await expect(page.getByRole('alert')).toHaveText('Select at least one tool to continue.');
  await page.getByRole('checkbox',{name:'AWS',exact:true}).check();
  await next(page);await expect(page.getByRole('alert')).toHaveText('Choose at least one reason to continue.');
  await page.getByRole('checkbox',{name:'AI recommended',exact:true}).check();
  await page.locator('.stack-why input[value="other"]').check();
  await expect(page.getByRole('textbox',{name:'What’s the other reason? (optional)',exact:true})).toBeVisible();
  await next(page);await expect(page.getByRole('heading',{name:'How much of a problem is infrastructure work for you right now?'})).toBeVisible();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'AI recommended',exact:true})).toBeChecked();
  await expect(page.locator('.stack-why input[value="other"]')).toBeChecked();
});

for(const width of [1440,320]){
  test(`hybrid stack picker fits at ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===320?568:900});await openForm(page);await sideProjectRoute(page,'Building, but not deployed yet');
    await page.getByRole('checkbox',{name:'AWS',exact:true}).check();await page.getByRole('checkbox',{name:'Railway',exact:true}).check();
    await page.screenshot({path:`screenshots/stack-picker-${width}.png`});
    await page.getByRole('searchbox',{name:'Search tools'}).fill('Our internal deployment tool');await page.getByRole('button',{name:'Add “Our internal deployment tool”'}).click();
    await page.locator('input[name="stackOther"]').check();
    await page.getByRole('textbox',{name:'What do you use that isn’t listed? (optional)',exact:true}).fill('Terraform and a few scripts.');
    await page.getByRole('checkbox',{name:'Ease of use',exact:true}).check();
    expect(await page.locator('.question-body').evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
    const bounds=await page.getByRole('button',{name:'Continue',exact:true}).boundingBox();expect(bounds!.y+bounds!.height).toBeLessThan(width===320?568:900);
  });
}

test('custom stack names are normalized and aliases cannot create duplicates',()=>{
  expect(matchingTools('').map(tool=>tool.name)).toEqual(stackShortlist);
  expect(matchingTools('gcp').map(tool=>tool.name)).toEqual(['Google Cloud']);
  expect(addStackTool(['AWS'],'amazon web services')).toEqual(['AWS']);
  expect(addStackTool(['My Tool'],'  my   tool  ')).toEqual(['My Tool']);
  expect(addStackTool([],'   ')).toEqual([]);expect(addStackTool([],'x'.repeat(81))).toEqual([]);
  const a={...emptyAnswers(),stage:'building',stackTools:['AWS','Custom tool'],stackWhy:['cost']};
  expect(stepsFor(a).slice(-2)).toEqual(['contact','hate']);
  expect(stepsFor({...a,stage:'idea'})).not.toContain('stack');
  expect(responseFor({...a,stage:'idea'})).not.toHaveProperty('stackTools');
});

test('branch matrix and exported responses omit hidden answers',()=>{
  for(const stage of choices.stage)for(const burden of choices.burden)for(const category of choices.problemCategory)for(const workaround of choices.workaround){
    const a:Answers={...emptyAnswers(),context:'side-project',sideProject:'Stale notes',stage:stage.value,burden:burden.value,stack:'Stale stack',stackTools:['AWS'],stackWhy:['cost'],stackWhyOther:'Stale why',problemCategory:category.value,problem:'Stale pain',anticipateIssues:'yes',workingWell:'Stale positive',workaround:workaround.value,workaroundDetails:'Stale fix',outcome:'no',spend:'5000-plus',role:'founder',owner:'me',email:'old@example.com',phone:'old phone'};
    const steps=stepsFor(a),data=responseFor(a),pain=experiencedPain(a),cost=pain&&category.value==='cost';
    expect(data.schemaVersion).toBe(5);
    expect(steps.includes('stack')).toBe(isBuilding(a));expect(steps).not.toContain('timeSpent');expect(steps).not.toContain('next');
    expect(steps.includes('workaround')).toBe(pain);expect(steps.includes('outcome')).toBe(pain&&a.workaround==='tried');expect(steps.includes('spend')).toBe(cost);
    expect(steps.slice(-2)).toEqual(['contact','hate']);expect(steps).not.toContain('startup');
    for(const key of ['role','infrastructureOwner','contextDetails'])expect(data).not.toHaveProperty(key);
    if(!isBuilding(a)){expect(data).not.toHaveProperty('stackTools');expect(data).not.toHaveProperty('weeklyInfrastructureTime');}
    if(!pain){for(const key of ['problemCategory','workaroundStatus','workaroundDetails','workaroundOutcome'])expect(data).not.toHaveProperty(key);}
    if(cost)expect(data).toMatchObject({costIsPartOfProblem:true,monthlySpendUsd:'5000-plus'});
    else for(const key of ['costIsPartOfProblem','monthlySpendUsd'])expect(data).not.toHaveProperty(key);
    if(burden.value==='none'){expect(data).not.toHaveProperty('problem');expect(data).not.toHaveProperty('problemEvidence');}
    else{
      expect(data.problemEvidence).toBe(pain?'experienced':'anticipated');
      if(pain)expect(data.anticipatedIssues).toBeUndefined();
      else expect(data).toMatchObject({anticipatedIssues:'yes',anticipatedIssueDetails:'Stale pain'});
    }
    if(!(isBuilding(a)&&burden.value==='none'))expect(data).not.toHaveProperty('whatWorksWell');
    if(a.workaround!=='tried'){expect(data).not.toHaveProperty('workaroundDetails');expect(data).not.toHaveProperty('workaroundOutcome');}
    for(const step of steps){expect(JSON.stringify([questionFor(step,a),textQuestionFor(step,a)])).not.toContain('\u2014');}
  }
  expect(JSON.stringify({...choices,why:stackWhyOptions})).not.toContain('\u2014');
});

test('changing stage or context resets dependent answers',()=>{
  const a:Answers={...emptyAnswers(),stage:'building',burden:'slows',stack:'Tools',stackTools:['AWS'],stackWhy:['cost'],stackWhyOther:'Why',problemCategory:'cost',problem:'Pain',anticipateIssues:'yes',workaround:'tried',workaroundDetails:'Fix',outcome:'partly',spend:'50-249'};
  const early=changeAnswer(a,'stage','idea');
  for(const key of ['stack','burden','problemCategory','problem','anticipateIssues','workaround','workaroundDetails','outcome','spend'])expect(early[key as keyof Answers]).toBe('');
  expect(early.stackTools).toEqual([]);expect(early.stackWhy).toEqual([]);expect(early.stackWhyOther).toBe('');
  const anticipated={...emptyAnswers(),stage:'idea',burden:'early',anticipateIssues:'yes',problem:'Concerns'};
  expect(changeAnswer(anticipated,'anticipateIssues','no').problem).toBe('');
  expect(changeAnswer(anticipated,'anticipateIssues','unsure').problem).toBe('');
  expect(changeAnswer(anticipated,'anticipateIssues','yes').problem).toBe('Concerns');
});

test('revised option sets replace time and follow-up questions with roles and anticipation',()=>{
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
  expect(choices.anticipateIssues.map(option=>option.value)).toEqual(['yes','no','unsure']);
  expect(choices).not.toHaveProperty('timeSpent');expect(choices).not.toHaveProperty('next');
  expect(stackWhyOptions.map(option=>option.value)).toEqual(['cost','ease','reputation','ai','experience','other']);
});

test('context, category, burden, and anticipation changes clear dependent details',()=>{
  const a:Answers={...emptyAnswers(),context:'other',contextDetails:'An internal tool',sideProject:'Old notes',stage:'building',burden:'slows',problemCategory:'other',problem:'Old frustration',anticipateIssues:'yes',workaround:'tried',workaroundDetails:'Old fix',outcome:'no',spend:'5000-plus',email:'old@example.com'};
  const categorized=changeAnswer(a,'problemCategory','setup');expect(categorized).toMatchObject({problem:'',spend:''});expect(responseFor(categorized)).not.toHaveProperty('problem');
  const cost=changeAnswer(a,'problemCategory','cost');expect(cost.problem).toBe('');expect(stepsFor(cost)).toContain('spend');
  for(const burden of ['none','early']){
    const changed=changeAnswer(a,'burden',burden);
    for(const key of ['problem','problemCategory','anticipateIssues','workaround','workaroundDetails','outcome','spend'])expect(changed[key as keyof Answers]).toBe('');
    expect(stepsFor(changed)).not.toContain('workaround');expect(stepsFor(changed)).not.toContain('spend');
  }
  expect(changeAnswer({...a,burden:'none',workingWell:'Managed hosting'},'burden','time').workingWell).toBe('');
  for(const context of ['startup','company']){
    const team=changeAnswer(a,'context',context);expect(team.contextDetails).toBe('');expect(team.sideProject).toBe('');
    expect(stepsFor(team)).toContain('role');expect(stepsFor(team)).toContain('startup');
    const populated={...team,role:'engineering',owner:'shared'};
    expect(changeAnswer(populated,'context',context==='startup'?'company':'startup')).toMatchObject({role:'engineering',owner:'shared'});
    expect(changeAnswer(populated,'context','side-project')).toMatchObject({role:'',owner:''});
  }
  const side=changeAnswer(a,'context','side-project');expect(stepsFor(side)).toContain('sideProject');
  expect(changeAnswer(side,'context','startup').sideProject).toBe('');
  expect(skipAnswer(a,'hate').hate).toBe('');
  expect(skipAnswer(a,'context')).toEqual(a);
});
