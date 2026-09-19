import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Use a local demo server');
assert.equal((await (await fetch(origin + '/api/config')).json()).demo, true);
if (process.env.MOBILE_EDGE_DATA === 'true') {
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'demo1234' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie };
  try {
    const state = await (await fetch(origin + '/api/state', { headers })).json();
    const employee = state.employees.find(e => e.username === 'employee');
    const edited = await fetch(origin + '/api/employees', { method: 'POST', headers, body: JSON.stringify({ ...employee, name: 'MobileLayoutLongEmployeeNameWithoutSpaces'.padEnd(60, 'X'), password: '' }) });
    assert.equal(edited.status, 200);
    const record = state.attendance.find(r => r.employeeId === employee.id && r.clockOut);
    const adjusted = await fetch(origin + '/api/attendance', { method: 'POST', headers, body: JSON.stringify({ ...record, reason: '긴입력내용'.repeat(100), confirmed: false }) });
    assert.equal(adjusted.status, 200);
  } finally {
    await fetch(origin + '/api/logout', { method: 'POST', headers, body: '{}' });
  }
}
const engine = process.env.AUDIT_ENGINE || 'webkit';
const sizes = process.env.AUDIT_WIDTH ? [[Number(process.env.AUDIT_WIDTH), Number(process.env.AUDIT_HEIGHT || 780)]] : [[320,568],[360,780],[375,667],[390,844],[430,932],[667,375],[390,420],[320,320]];
const output = `docs/screenshots/mobile-audit/${process.env.AUDIT_RUN || 'current'}/${engine}`;
await mkdir(output, { recursive: true });
const browser = await playwright[engine].launch({ headless: true });
const results = [];
const pageErrors = [];
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push({ width, height, error: error.message }));
    page.setDefaultTimeout(10000);
    const prefix = `${width}x${height}`;
    async function inspect(screen, focusFields = false) {
      await page.mouse.move(0, 0);
      await page.getByRole('status').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      const issues = await page.evaluate(() => {
        const found = [];
        const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const name = e => e.getAttribute('aria-label') || e.getAttribute('name') || e.className || e.tagName;
        if (document.documentElement.scrollWidth > innerWidth + 1) found.push({ kind: 'document-overflow', actual: document.documentElement.scrollWidth, allowed: innerWidth });
        for (const e of document.querySelectorAll('.modal,.modal-body,.modal-footer,.form-grid,.field,.filters,.record-card,.employee-card,.profile-card,.time-grid,.team-row,.page-heading,.login-panel')) {
          if (visible(e) && e.scrollWidth > e.clientWidth + 1) found.push({ kind: 'container-overflow', element: name(e), actual: e.scrollWidth, allowed: e.clientWidth });
        }
        const scope = document.querySelector('[role=dialog]') || document;
        for (const e of scope.querySelectorAll('input,select,textarea,button,summary')) {
          if (!visible(e)) continue;
          const r = e.getBoundingClientRect();
          if (r.left < -1 || r.right > innerWidth + 1) found.push({ kind: 'control-outside-viewport', element: name(e), left: r.left, right: r.right, width: innerWidth });
          if (e.matches('input:not([type=checkbox]),select,textarea')) {
            if (r.height < 43.9) found.push({ kind: 'input-too-short', element: name(e), height: r.height });
            const field = e.closest('.field,.search-box');
            if (field) {
              const f = field.getBoundingClientRect();
              if (r.left < f.left - 1 || r.right > f.right + 1) found.push({ kind: 'control-outside-field', element: name(e), actual: r.width, allowed: f.width });
            }
          }
        }
        return found;
      });
      await page.screenshot({ path: `${output}/${prefix}-${screen}.png`, animations: 'disabled' });
      if (focusFields) {
        const fields = page.locator('[role=dialog] input:not([type=checkbox]),[role=dialog] select,[role=dialog] textarea');
        for (let i = 0; i < await fields.count(); i++) {
          const field = fields.nth(i);
          await field.evaluate(e => { e.focus({ preventScroll: true }); e.scrollIntoView({ block: 'center', inline: 'nearest' }); });
          const obscured = await field.evaluate(e => {
            const r = e.getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 24);
            const hit = document.elementFromPoint(x, y);
            return !hit || !(hit === e || e.contains(hit)) ? { kind: 'focused-control-obscured', element: e.name || e.tagName, blocker: hit?.className || hit?.tagName, top: r.top, bottom: r.bottom, viewportHeight: innerHeight } : null;
          });
          if (obscured) issues.push(obscured);
        }
        await page.screenshot({ path: `${output}/${prefix}-${screen}-focused.png`, animations: 'disabled' });
      }
      const result = { screen, width, height, engine, issues };
      results.push(result);
      if (issues.length) console.log(JSON.stringify(result));
    }
    async function login(username) {
      await page.getByLabel('아이디', { exact: true }).fill(username);
      await page.getByLabel('비밀번호', { exact: true }).fill('demo1234');
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await page.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
      await page.getByRole('heading', { name: username === 'owner' ? '오늘 근무' : '출퇴근', exact: true }).waitFor();
    }
    async function nav(name) { await page.locator('.mobile-nav').getByRole('button', { name, exact: true }).click(); }
    async function close() { await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); }
    async function modal(button, name) { await button.click(); await page.getByRole('dialog').waitFor(); await inspect(name, true); }
    await page.goto(origin);
    await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
    await inspect('login');
    await login('owner');
    await inspect('owner-today');
    await modal(page.getByRole('button', { name: '근무기록 추가', exact: true }), 'record-create');
    await page.getByLabel('출근 · 한국 시각', { exact: true }).fill('2025-01-02T10:00');
    await page.getByLabel('퇴근 · 미퇴근은 비워 두세요', { exact: true }).fill('2025-01-02T09:00');
    await page.getByLabel('수정 사유', { exact: true }).fill('모바일 입력 오류 화면 확인');
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    await inspect('record-error', true);
    await close();
    await nav('출석부');
    await inspect('owner-attendance');
    await modal(page.getByRole('button', { name: '기록 수정', exact: true }).first(), 'record-edit');
    await close();
    await modal(page.getByRole('button', { name: '조정 내역', exact: true }), 'owner-history');
    if (await page.locator('summary').count()) { await page.locator('summary').first().click(); await inspect('owner-history-expanded'); }
    await close();
    await page.getByLabel('근무일', { exact: true }).fill('2000-01-01');
    await inspect('attendance-empty');
    await nav('직원');
    await inspect('owner-employees');
    await modal(page.getByRole('button', { name: '직원 등록', exact: true }), 'employee-create');
    await close();
    for (const [button, name] of [['계정 · 정보 수정','employee-edit'],['시급 이력','wage'],['산정기간','period']]) {
      await modal(page.getByRole('button', { name: button, exact: true }).first(), name);
      await close();
    }
    await page.getByLabel('직원 이름 검색').fill('없는이름-검색');
    await inspect('employees-empty');
    await nav('급여');
    await inspect('owner-payroll');
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
    await login('employee');
    await inspect('employee-today');
    await nav('내 출석부');
    await inspect('employee-attendance');
    await modal(page.getByRole('button', { name: '조정 내역', exact: true }), 'employee-history');
    if (await page.locator('summary').count()) { await page.locator('summary').first().click(); await inspect('employee-history-expanded'); }
    await close();
    await nav('내 정보');
    await inspect('employee-profile');
    await modal(page.getByRole('button', { name: '비밀번호 변경', exact: true }), 'password');
    await close();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
    await context.close();
    console.log(`Checked ${engine} ${prefix}`);
  }
} finally {
  const report = { engine, checkedAt: new Date().toISOString(), scenarios: results.length, issueCount: results.reduce((n, r) => n + r.issues.length, 0), pageErrors, results };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
assert.deepEqual(pageErrors, []);
assert.equal(results.reduce((n, r) => n + r.issues.length, 0), 0, 'Mobile layout issues; see report/screenshots');
console.log(`PASS ${engine}: ${results.length} mobile scenarios, container/control bounds and focused field reachability`);
