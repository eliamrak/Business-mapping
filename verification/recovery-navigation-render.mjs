import fs from "node:fs/promises";

// Reuse the isolated synthetic workspace, with the real Access boundary mounted.
let template = await fs.readFile(new URL("./financial-completeness-render.mjs", import.meta.url), "utf8");
const begin = template.indexOf("const checks=String.raw`");
const end = template.indexOf("`;\ntry{await import", begin);
if (begin < 0 || end < 0) throw new Error("Synthetic harness markers changed");
template = template.replace("import PracticeWorkspace from '@/pages/practice-workspace';", "import Access from '@/components/hub/access';import PracticeWorkspace from '@/pages/practice-workspace';")
  .replace("<PracticeWorkspace/>", "<Access><PracticeWorkspace/></Access>")
  .replace("plugins:[", `plugins:[{name:'synthetic-clerk',setup(b){b.onResolve({filter:/^@clerk\\/react$/},()=>({path:'clerk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const useAuth=()=>({isLoaded:true,isSignedIn:location.pathname!=='/signedout'});export const useClerk=()=>({signOut:async()=>{}});",loader:'js'}));}},`);
const checks = String.raw`
let role='owner';const requests=[];
const respond=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
await page.route('**/*',route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.hostname!=='127.0.0.1')return route.abort();
 requests.push({path:url.pathname,method:req.method()});
 if(req.method()!=='GET')return route.abort();
 if(url.pathname==='/api/auth/me')return respond(route,role==='denied'?{error:'Forbidden'}:{actor:'synthetic@example.test',role},role==='denied'?403:200);
 if(url.pathname==='/api/hub/entry')return respond(route,{revision:1,teamId:1,clinicians:[],periods:[],campaigns:[],funnels:[]});
 if(url.pathname==='/api/hub/attachments'||url.pathname==='/api/hub/history'||url.pathname==='/api/session-records')return respond(route,[]);
 return route.fallback();
});
const entry=()=>page.getByRole('button',{name:'Reporting documents & recovery',exact:true});
async function settings(){await page.locator('.pw-rail-bottom').getByRole('button',{name:'Settings',exact:true}).click();await entry().waitFor();}
async function boundary(name,expected){await page.goto('http://127.0.0.1:PORT/'+(name==='signedout'?'signedout':'workspace'));await expected.waitFor();assert.equal(await page.locator('nav[aria-label="Practice sections"]').count(),0);assert.equal(await entry().count(),0);assert.equal(await page.getByRole('heading',{name:'Backup and recovery',exact:true}).count(),0);checks.push({name,protectedContent:false});}
try{
await page.goto('http://127.0.0.1:PORT/workspace');await clickSection('Overview');
await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByRole('heading',{name:'Compensation reports',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Backup and recovery',exact:true}).count(),0);await page.keyboard.press('Escape');
await settings();
for(const width of [1280,390]){await capture('today-settings-recovery-entry',width,900);const bounds=await entry().evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));assert.ok(bounds.scroll<=bounds.client+1,'entry label fits');}
await entry().click();await page.getByRole('heading',{name:'Backup and recovery',exact:true}).waitFor();await page.getByRole('link',{name:'Business-data backup',exact:true}).waitFor();await page.getByText('Review backup',{exact:true}).waitFor();
for(const width of [1280,390])await capture('today-reports-and-recovery',width,900);
assert.equal(await page.getByRole('tab',{name:'Reports & recovery',exact:true}).getAttribute('aria-selected'),'true');
await page.getByRole('tab',{name:'Documents & imports',exact:true}).click();await page.getByRole('heading',{name:'Source documents',exact:true}).waitFor();
await page.getByRole('tab',{name:'Reporting periods',exact:true}).click();await page.getByRole('heading',{name:'Review queue',exact:true}).waitFor();
await page.getByRole('tab',{name:'Audit history',exact:true}).click();await page.getByRole('heading',{name:'Saved workspace revisions',exact:true}).waitFor();
await page.getByRole('tab',{name:'Reports & recovery',exact:true}).click();await page.getByRole('heading',{name:'Backup and recovery',exact:true}).waitFor();
await page.getByRole('button',{name:'Back to Overview',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
await page.getByRole('button',{name:'Sandbox',exact:true}).click();await page.getByRole('button',{name:'Model settings',exact:true}).click();assert.equal(await entry().count(),0);
role='data_entry';await boundary('data-entry',page.getByRole('heading',{name:'Practice updates',exact:true}));
role='denied';await boundary('denied',page.getByRole('alert').filter({hasText:'Your account is not authorized'}));
await boundary('signedout',page.getByRole('link',{name:'Sign in with Google',exact:true}));
assert.deepEqual(browserErrors,[]);assert.ok(requests.every(r=>r.method==='GET'));assert.ok(!requests.some(r=>r.path.includes('/backup')),'no backup or restore requests');assert.ok(checks.filter(c=>c.topNavigation!==undefined).every(c=>c.scrollWidth<=c.clientWidth+1&&c.topNavigation));
await fs.writeFile(path.join(outDir,'results.json'),JSON.stringify({syntheticOnly:true,productionAccess:false,writes:0,assertions:['Owner Settings opens Reports & recovery directly','Existing compensation Reports dialog unchanged','All four Updates tabs remain reachable','Back to Overview works','Sandbox hides recovery entry','data_entry sees Entry only','Denied account cannot see workspace','Signed-out account sees sign-in only','Desktop/mobile no overflow and entry label fits','No backup or restore request'],requests,browserErrors,checks},null,2));console.log(JSON.stringify({outDir,states:checks.length,browserErrors,writes:0,backupRequests:0}));
}finally{await browser.close();}
`;
const checksBegin = template.indexOf("const checks=String.raw`");
const checksEnd = template.indexOf("`;\ntry{await import", checksBegin);
template = template.slice(0, checksBegin) + "const checks=String.raw`" + checks + template.slice(checksEnd);
// Every occurrence is a local synthetic test destination.
template = template.replace("checks.replace('127.0.0.1:PORT'", "checks.replaceAll('127.0.0.1:PORT'");
template = template.replace("export const useClerk=", "export const useUser=()=>({user:{primaryEmailAddress:{emailAddress:'synthetic@example.test'}}});export const useClerk=");
template = template.replace("new URL('../',import.meta.url)", JSON.stringify(new URL('../', import.meta.url).href));
await import("data:text/javascript;base64," + Buffer.from(template).toString("base64"));
