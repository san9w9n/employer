import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const origin=process.env.TEST_ORIGIN||'http://localhost:3000';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
assert.equal((await(await fetch(origin+'/api/config')).json()).demo,true);
const require=createRequire(import.meta.url);
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='docs/screenshots/record-actions';await mkdir(output,{recursive:true});
for(const engine of (process.env.AUDIT_ENGINE?[process.env.AUDIT_ENGINE]:['chromium','webkit'])){
 const browser=await playwright[engine].launch();
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',serviceWorkers:'block'});
  page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let reads=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/state')reads++;});
  const api=async(endpoint,data)=>{const r=await page.request.post(origin+'/api/'+endpoint,{headers:{Origin:origin},data});assert.equal(r.status(),200,await r.text());return r.json();};
  const state=async()=>{const r=await page.request.get(origin+'/api/state');assert.equal(r.status(),200);return r.json();};
  const login=async(username,password)=>{await page.getByLabel('아이디',{exact:true}).fill(username);await page.getByLabel('비밀번호',{exact:true}).fill(password);await page.getByRole('button',{name:'로그인',exact:true}).click();await page.locator('.topbar').waitFor();};
  const nav=name=>page.locator('.mobile-nav').getByText(name,{exact:true}).click();
  async function gesture(dy=170,dx=0,atTop=true){
   if(atTop)await page.evaluate(()=>window.scrollTo(0,0));
   await page.waitForTimeout(80);
   await page.evaluate(({dy,dx})=>{
    const target=document.querySelector('main h1');
    const dispatch=(type,x,y,end=false)=>{const touch={identifier:1,target,clientX:x,clientY:y};const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:end?[]:[touch]},targetTouches:{value:end?[]:[touch]},changedTouches:{value:[touch]}});target.dispatchEvent(event);};
    dispatch('touchstart',100,100);dispatch('touchmove',100+dx,100+dy);dispatch('touchend',100+dx,100+dy,true);
   },{dy,dx});
  }
  async function refresh(){const before=reads;const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');await gesture();await response;await page.waitForFunction(()=>!document.querySelector('.pull-refresh [role=status]'));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(reads,before+1);}
  await page.goto(origin);await login('owner','demo1234');
  if(engine==='chromium'){
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const session=await page.context().newCDPSession(page);
   const box=await page.locator('main h1').boundingBox();const x=box.x+25,y=box.y+10;
   const before=reads;const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(const delta of [25,50,90,140,180]){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+delta}]});await page.waitForTimeout(80);}
   await page.locator('.pull-refresh').getByText('놓으면 새로고침').waitFor();
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await response;await page.waitForFunction(()=>!document.querySelector('.pull-refresh [role=status]'));assert.equal(reads,before+1);
  }
  await refresh(); // Today tab.
  for(const [dy,dx] of [[50,0],[170,200]]){const before=reads;await gesture(dy,dx);await page.waitForTimeout(150);assert.equal(reads,before);}
  await page.evaluate(()=>window.scrollTo(0,200));const beforeScroll=reads;await gesture(170,0,false);await page.waitForTimeout(150);assert.equal(reads,beforeScroll);
  const username='record'+Date.now();
  const {employee}=await api('employees',{name:'개별 기록 검증',username,password:'testpass123',hireDate:'2020-01-01',payType:'hourly',active:true});
  await api('attendance',{employeeId:employee.id,clockIn:'2024-02-25T14:00+09:00',clockOut:'2024-02-25T18:00+09:00',deductionMinutes:0,credited:false,reason:'유지할 두 번째 근무'});
  await refresh();await nav('출석부');await page.getByLabel('근무일',{exact:true}).fill('2024-02-25');await page.getByLabel('직원',{exact:true}).selectOption(employee.id);
  await page.getByRole('button',{name:'선택한 날짜에 추가',exact:true}).click();
  assert.equal(await page.getByLabel('출근 · 한국 시각',{exact:true}).inputValue(),'2024-02-25T10:00');
  assert.equal(await page.getByRole('dialog').getByLabel('직원',{exact:true}).inputValue(),employee.id);
  const beforeModal=reads;await gesture();await page.waitForTimeout(100);assert.equal(reads,beforeModal);
  await page.getByLabel('퇴근 · 미퇴근은 비워 두세요',{exact:true}).fill('2024-02-25T12:00');
  await page.getByRole('button',{name:'차감 없음',exact:true}).click();await page.getByLabel('수정 사유',{exact:true}).fill('수동 추가 검증');
  await page.getByRole('button',{name:'저장하기',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.locator('.attendance-records .record-card').filter({hasText:'수동 추가 검증'}).waitFor();
  assert.equal(await page.locator('.attendance-records .record-card').count(),2);
  await refresh();assert.equal(await page.getByLabel('근무일',{exact:true}).inputValue(),'2024-02-25');assert.equal(await page.getByLabel('직원',{exact:true}).inputValue(),employee.id);
  // One refresh at a time; selected filters survive success and failure.
  let release;const held=new Promise(resolve=>{release=resolve});
  await page.route('**/api/state?*',async route=>{await held;await route.continue();},{times:1});
  const beforeBusy=reads;await gesture();await page.locator('.pull-refresh').getByText('새로고침 중…').waitFor();await gesture();assert.equal(reads,beforeBusy+1);release();await page.waitForFunction(()=>!document.querySelector('.pull-refresh [role=status]'));
  await page.route('**/api/state?*',route=>route.fulfill({status:500,json:{error:'새로고침 검증 오류'}}),{times:1});
  await refresh();await page.locator('.global-error').waitFor();await refresh();await page.locator('.global-error').waitFor({state:'hidden'});
  const record=(await state()).attendance.find(r=>r.employeeId===employee.id&&r.reason==='수동 추가 검증');
  async function openDelete(){await page.locator('.attendance-records .record-card').filter({hasText:'수동 추가 검증'}).getByRole('button',{name:'기록 수정',exact:true}).click();await page.getByRole('button',{name:'이 근무기록 삭제',exact:true}).click();await page.getByRole('dialog').locator('.reset-summary').waitFor();}
  await openDelete();await page.getByRole('button',{name:'취소',exact:true}).click();assert((await state()).attendance.some(r=>r.id===record.id));
  await openDelete();assert.equal(await page.getByRole('button',{name:'이 기록 삭제',exact:true}).isDisabled(),true);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.getByRole('dialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.screenshot({path:`${output}/${engine}-${width}-delete.png`});}
  await page.setViewportSize({width:390,height:844});await page.getByLabel('삭제 사유',{exact:true}).fill('중복 입력 삭제 검증');
  await api('attendance',{...record,reason:'수동 추가 검증 · 변경됨'});
  await page.getByRole('button',{name:'이 기록 삭제',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();assert.match(await page.getByRole('dialog').getByRole('alert').innerText(),/변경/);
  await page.getByRole('button',{name:'삭제 대상 다시 확인',exact:true}).click();await page.getByRole('dialog').locator('.reset-summary').waitFor();
  await page.route('**/api/attendance-delete',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort();},{times:1});
  await page.getByRole('button',{name:'이 기록 삭제',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();
  await page.getByRole('button',{name:'이 기록 삭제',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelectorAll('.attendance-records .record-card').length===1);
  assert.match(await page.locator('.attendance-records').innerText(),/유지할 두 번째 근무/);
  const after=await state();assert.equal(after.audits.filter(a=>a.targetId===record.id&&a.after===null).length,1);
  assert.match(await page.locator('.calendar-day[aria-pressed=true]').getAttribute('aria-label'),/기록 1건/);
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();await login(username,'testpass123');await refresh();await nav('내 출석부');await refresh();await page.getByLabel('근무일',{exact:true}).fill('2024-02-25');assert.equal(await page.locator('.attendance-records .record-card').count(),1);
  assert.equal(await page.getByRole('button',{name:'선택한 날짜에 추가',exact:true}).count(),0);
  const denied=await page.request.post(origin+'/api/attendance-delete-preview',{headers:{Origin:origin},data:{id:record.id}});assert.equal(denied.status(),403);
  await nav('내 정보');const beforeProfile=reads;await gesture();await page.waitForTimeout(150);assert.equal(reads,beforeProfile);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${engine}: manual add on selected date, cancel/stale preview/delete/retry/audit, other shifts retained, employee permissions; pull refresh on both roles/tabs, short/horizontal/scrolled/modal/busy guards, filters retained, failure recovery`);
 }finally{await browser.close();}
}
