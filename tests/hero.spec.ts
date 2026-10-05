import { test, expect, type Page } from '@playwright/test';
const tagline='Your all-in-one infrastructure solution';
const features=['Batteries-included','Testable','Secure'];
const diagrams=['platform','testing','security'];
async function ready(page:Page){await expect(page.locator('.story-track')).toHaveAttribute('data-scroll-ready','true');await page.evaluate(()=>document.fonts.ready);}
async function scrollToProgress(page:Page,progress:number){
  // ResizeObserver and Svelte flush geometry after viewport changes; wait for
  // the new scroll range before calculating an absolute target.
  await expect.poll(()=>page.evaluate(()=>{
    const track=document.querySelector<HTMLElement>('.story-track')!;
    const scene=document.querySelector<HTMLElement>('.hero')!;
    return Math.abs(track.offsetHeight-scene.offsetHeight-Math.round(innerHeight*1.6));
  })).toBeLessThan(2);
  await page.evaluate(p=>{
    const track=document.querySelector<HTMLElement>('.story-track')!;
    const scene=document.querySelector<HTMLElement>('.hero')!;
    const start=track.getBoundingClientRect().top+scrollY+Math.max(0,scene.offsetHeight-innerHeight);
    window.scrollTo({top:start+(track.offsetHeight-scene.offsetHeight)*p,behavior:'instant'});
  },progress);
}
for(const viewport of [{width:1440,height:1000},{width:1024,height:800},{width:1366,height:640},{width:390,height:844},{width:320,height:700},{width:320,height:568}]){
  test(`scroll pins readable diagrams at ${viewport.width}x${viewport.height}`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);await page.goto('/');await ready(page);
    await expect(page.locator('h1')).toHaveText(tagline);
    const copy=await page.locator('.copy-slot').boundingBox();const initial=await page.locator('.diagram-slot').boundingBox();
    if(viewport.width>800)expect(copy!.x).toBeLessThan(initial!.x);else expect(initial!.y).toBeGreaterThan(copy!.y+copy!.height);
    for(const [index,name] of diagrams.entries()){
      await scrollToProgress(page,index/2);
      await expect(page.locator('.features button.active')).toHaveText(features[index]);
      await expect(page.locator('[data-diagram]:visible')).toHaveAttribute('data-diagram',name);
      const bounds=await page.locator('.diagram-slot').boundingBox();
      expect(bounds!.height).toBe(initial!.height);expect(bounds!.y).toBeGreaterThanOrEqual(-1);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
      await page.screenshot({path:`screenshots/compact-${name}-${viewport.width}x${viewport.height}.png`});
    }
    await scrollToProgress(page,0);await expect(page.locator('.features button.active')).toHaveText(features[0]);expect(errors).toEqual([]);
  });
}
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
  test(`feature copy replaces placeholders without layout shifts at ${viewport.width}px`,async({page})=>{
    const copy=[
      'A complete stack with auth, storage, databases and secrets already configured to work together.',
      'Find real issues in isolated clones that match production. Check your fixes under the same conditions before deploying.',
      'Built by security experts to handle common threats automatically, so your team has less security work to do.'
    ];
    await page.setViewportSize(viewport);await page.goto('/');await ready(page);
    const height=(await page.locator('.feature-taglines').boundingBox())!.height;
    await page.screenshot({path:`screenshots/hero-copy-${viewport.width}.png`});
    for(const [index,feature] of features.entries()){
      await page.getByRole('button',{name:feature,exact:true}).click();
      await expect(page.locator('.feature-tagline:visible')).toHaveText(copy[index]);
      await expect(page.locator('.feature-tagline[aria-hidden="true"]')).toHaveCount(2);
      expect((await page.locator('.feature-taglines').boundingBox())!.height).toBe(height);
      expect(copy[index]).not.toContain('\u2014');
    }
    expect(await page.locator('.hero-copy').textContent()).not.toMatch(/lorem ipsum|sed do eiusmod|ut enim ad minim/i);
  });
}

test('native wheel scrolling advances and reverses the sequence',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');await ready(page);
  await page.mouse.wheel(0,800);await expect(page.locator('.features button.active')).toHaveText('Testable');
  await page.mouse.wheel(0,800);await expect(page.locator('.features button.active')).toHaveText('Secure');
  await page.mouse.wheel(0,-1600);await expect(page.locator('.features button.active')).toHaveText('Batteries-included');
});
test('feature buttons retain direct and keyboard navigation without diagram footer controls',async({page})=>{
  await page.goto('/');await ready(page);
  await expect(page.locator('#diagram-carousel button, #diagram-carousel nav, .scroll-progress, .positions')).toHaveCount(0);
  await page.getByRole('button',{name:'Secure',exact:true}).click();await expect(page.locator('[data-diagram]:visible')).toHaveAttribute('data-diagram','security');
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(500);
  await page.getByRole('button',{name:'Testable',exact:true}).click();await expect(page.locator('.features button.active')).toHaveText('Testable');
  await page.getByRole('button',{name:'Batteries-included',exact:true}).click();await expect(page.locator('.features button.active')).toHaveText('Batteries-included');
  await page.getByRole('button',{name:'Secure',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('[data-diagram]:visible')).toHaveAttribute('data-diagram','security');
});
test('progress is continuous but stationary pages never auto-advance',async({page})=>{
  await page.clock.install();await page.goto('/');await ready(page);await page.clock.runFor(30000);await expect(page.locator('.features button.active')).toHaveText('Batteries-included');
  await expect(page.getByRole('button',{name:/Pause|Resume/})).toHaveCount(0);
});
test('reduced motion retains direct scroll navigation',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await ready(page);
  await scrollToProgress(page,.5);await expect(page.locator('.features button.active')).toHaveText('Testable');
  await page.getByRole('button',{name:'Secure',exact:true}).click();await expect(page.locator('.features button.active')).toHaveText('Secure');
});
test('resize preserves a readable sequence and recalculates its range',async({page})=>{
  await page.goto('/');await ready(page);await scrollToProgress(page,.5);await expect(page.locator('.features button.active')).toHaveText('Testable');
  await page.setViewportSize({width:390,height:844});await scrollToProgress(page,1);await expect(page.locator('.features button.active')).toHaveText('Secure');
  await page.setViewportSize({width:1440,height:1000});await scrollToProgress(page,0);await expect(page.locator('.features button.active')).toHaveText('Batteries-included');
});
test('inventory and replica benefits replace permissions and approval gates',async({page})=>{
  await page.goto('/');await ready(page);
  const text=await page.locator('main').textContent();
  for(const removed of ['TEST BOUNDARY','HUMAN GATE','Shared configuration','One control plane','APPLICATION STACK','Review before promotion','Policy boundary','Scoped identity','Manual approval','Prioritize fixes','Which threats affect your stack?']) expect(text).not.toContain(removed);
  await page.getByRole('button',{name:'Testable',exact:true}).click();
  for(const label of ['Isolated replica','Performance','at scale','Risky pentesting','Catch regressions']) await expect(page.locator('[data-diagram="testing"]')).toContainText(label);
  await page.getByRole('button',{name:'Secure',exact:true}).click();
  for(const label of ['Threat intel','CVEs','Honeypots','canaries','Inventory','Versions','Dependencies','Exposure','Automatic protection','Fix vulnerabilities','Block attacks']) await expect(page.locator('[data-diagram="security"]')).toContainText(label);
});
test('local provider logos load and controls maintain strong contrast',async({page})=>{
  await page.goto('/');await ready(page);
  for(const logo of ['aws','azure','hetzner']){
    const img=page.locator(`.providers img[src="/logos/${logo}.svg"]`);await expect(img).toBeVisible();expect(await img.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  const contrast=await page.getByRole('button',{name:'Secure',exact:true}).evaluate(el=>{
    const style=getComputedStyle(el);const rgb=(s:string)=>s.match(/[\d.]+/g)!.map(Number);
    const lum=(a:number[])=>a.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const fg=rgb(style.color),bg=rgb(style.backgroundColor);return {ratio:(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05),alpha:bg[3]??1};
  });expect(contrast.alpha).toBe(1);expect(contrast.ratio).toBeGreaterThan(7);
});
test('opening and closing an untouched form creates no server response',async({page})=>{
  const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});await page.goto('/');await ready(page);
  await page.getByRole('button',{name:'Help shape Melzi'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect(posts).toEqual([]);
});
test('initial hero is server-rendered',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('/');await expect(page.locator('h1')).toHaveText(tagline);await expect(page.locator('[data-diagram="platform"]')).toBeVisible();await context.close();
});
test('existing network preview serves the scroll-linked hero',async({page})=>{await page.goto('http://100.64.0.3:4174/');await ready(page);await expect(page.locator('#diagram-carousel')).toBeVisible();await expect(page.locator('#diagram-carousel button, .scroll-progress')).toHaveCount(0);});
