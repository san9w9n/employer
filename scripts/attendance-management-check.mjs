import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.env.TEST_ORIGIN||'http://localhost:3110';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Use a local demo server');
assert.equal((await (await fetch(origin+'/api/config')).json()).demo,true,'Use a demo server');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
const directory='.omx/artifacts/reset-ux';await mkdir(directory,{recursive:true});
const results=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Seoul'});
 page.setDefaultTimeout(15000);
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 const api=async(endpoint,body)=>{const r=await page.request.post(origin+'/api/'+endpoint,{headers:{Origin:origin},data:body});assert.equal(r.status(),200,await r.text());return r.json()};
 const state=async()=>{const r=await page.request.get(origin+'/api/state');assert.equal(r.status(),200);return r.json()};
 const shot=async name=>{await page.screenshot({path:`${directory}/${name}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} horizontal overflow`);};
 await page.goto(origin);await page.getByLabel('아이디',{exact:true}).fill('owner');await page.getByLabel('비밀번호',{exact:true}).fill('demo1234');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
 const e=(await api('employees',{name:'초기화 UX 검증',username:'reset'+Date.now(),password:'testpass123',hireDate:'2020-01-01',payType:'hourly',active:true})).employee;
 const date=new Date(Date.now()+9*3600000-2*86400000).toISOString().slice(0,10);
 await api('attendance',{employeeId:e.id,clockIn:date+'T10:00:12.345+09:00',clockOut:date+'T22:00:23.456+09:00',deductionMinutes:120,credited:false,reason:'수정 전 기록'});
 await page.reload();await page.locator('.mobile-nav').getByText('출석부',{exact:true}).click();
 await page.locator('.filters select').selectOption(e.id);
 await page.getByRole('button',{name:'기록 수정',exact:true}).click();
 let dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.equal(await dialog.getByLabel('직원',{exact:true}).isDisabled(),true);
 await shot('editor-top-mobile');await page.setViewportSize({width:320,height:568});await shot('editor-small-mobile');assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);await page.setViewportSize({width:390,height:844});
 await dialog.getByRole('button',{name:'다음 날 퇴근',exact:true}).click();
 const expectedNext=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
 assert.equal((await dialog.getByLabel('퇴근 · 미퇴근은 비워 두세요').inputValue()).slice(0,10),expectedNext);
 await dialog.getByLabel('퇴근 · 미퇴근은 비워 두세요').fill(expectedNext+'T02:00');
 await dialog.getByRole('button',{name:'30분',exact:true}).click();
 await dialog.getByRole('button',{name:'퇴근 누락 보정',exact:true}).click();
 assert.match(await dialog.locator('.calculation-preview').innerText(),/15시간 30분/);
 await shot('editor-mobile');await page.setViewportSize({width:1440,height:1000});await shot('editor-desktop');
 await dialog.getByRole('button',{name:'저장하기',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const edited=(await state()).attendance.find(a=>a.employeeId===e.id);
 assert.equal(edited.clockIn,new Date(date+'T10:00:12.345+09:00').toISOString());assert.equal(edited.clockOut,new Date(expectedNext+'T02:00+09:00').toISOString());assert.equal(edited.deductionMinutes,30);assert.equal(edited.reason,'퇴근 누락 보정');
 results.push('owner edit: next-day checkout, break/reason presets, live calculation, original check-in seconds preserved');
 // Ensure today has one unfinished shift, even when the suite is rerun.
 const now=new Date().toISOString();await api('attendance',{employeeId:e.id,clockIn:now,clockOut:null,deductionMinutes:0,credited:false,reason:'초기화 대상 미퇴근'});
 await page.reload();await page.locator('.sidebar nav').getByText('출석부',{exact:true}).click();await page.locator('.filters select').selectOption(e.id);
 await shot('attendance-desktop');await page.setViewportSize({width:390,height:844});await shot('attendance-mobile');
 const before=(await state()).attendance;
 for(const label of ['오늘','이번 주','이번 달']){
  await page.getByRole('button',{name:label+' 초기화',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('.reset-summary').waitFor();
  assert.match(await dialog.innerText(),/전체 직원/);assert.match(await dialog.innerText(),/출근일 기준 기간/);
  await shot(label==='오늘'?'reset-mobile':label==='이번 주'?'reset-week-mobile':'reset-month-mobile');
  if(label==='오늘'){await page.setViewportSize({width:1440,height:1000});await shot('reset-desktop');await page.setViewportSize({width:390,height:844});}
  await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.deepEqual((await state()).attendance,before);
 }
 results.push('all three reset confirmations show scope/counts; cancellation leaves every record unchanged');
 // A changed target must invalidate confirmation without deleting anything.
 await page.getByRole('button',{name:'오늘 초기화',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('.reset-summary').waitFor();
 let open=(await state()).attendance.find(a=>a.employeeId===e.id&&!a.clockOut);await api('attendance',{...open,reason:'확인 중 수정'});
 await dialog.getByRole('button',{name:/^확인 후 .*건 삭제$/}).click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').innerText(),/변경/);assert.equal((await state()).attendance.length,before.length);
 await dialog.getByRole('button',{name:'삭제 대상 다시 확인',exact:true}).click();await dialog.locator('.reset-summary').waitFor();await shot('reset-reconfirmed-mobile');
 const expected=(await api('attendance-reset-preview',{scope:'today'})).count;
 let release;const held=new Promise(resolve=>{release=resolve});
 await page.route('**/api/attendance-reset',async route=>{await held;await route.continue()},{times:1});
 await dialog.getByRole('button',{name:`확인 후 ${expected}건 삭제`,exact:true}).click();
 await dialog.getByRole('button',{name:'초기화 중…',exact:true}).waitFor();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role=dialog]'))),true,'busy modal retains keyboard focus');release();await dialog.waitFor({state:'hidden'});
 const after=await state();assert.equal(after.attendance.length,before.length-expected);assert(after.audits.some(a=>a.targetId===open.id&&a.after===null&&a.before));assert(after.attendance.some(a=>a.id===edited.id));assert(after.employees.some(a=>a.id===e.id));
 results.push('stale preview blocked; reconfirmed reset persists deletions/audits and retains records outside range');
 await page.getByRole('button',{name:'오늘 초기화',exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('.reset-summary').waitFor();assert.equal(await dialog.getByRole('button',{name:'확인 후 0건 삭제'}).isDisabled(),true);await shot('reset-empty-mobile');await dialog.getByRole('button',{name:'취소',exact:true}).click();
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByLabel('아이디',{exact:true}).fill('employee');await page.getByLabel('비밀번호',{exact:true}).fill('demo1234');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.mobile-nav').getByText('내 출석부',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'오늘 초기화',exact:true}).count(),0);
 const forbidden=await page.request.post(origin+'/api/attendance-reset-preview',{headers:{Origin:origin},data:{scope:'today'}});assert.equal(forbidden.status(),403);
 results.push('empty reset disabled; employee cannot view reset controls or request reset preview');assert.deepEqual(pageErrors,[]);
 await writeFile(`${directory}/results.json`,JSON.stringify({results,pageErrors},null,2));console.log('PASS '+results.join('\nPASS '));
}finally{await browser.close();}
