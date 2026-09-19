import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const browserType = require(process.env.PLAYWRIGHT_MODULE || 'playwright')[process.env.BROWSER_ENGINE || 'chromium'];
const origin = process.env.TEST_ORIGIN || 'http://localhost:3011';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Use a local demo server');
assert.equal((await (await fetch(origin + '/api/config')).json()).demo, true);
const browser = await browserType.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', ignoreHTTPSErrors: true, serviceWorkers: 'block' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const username = 'onebutton' + Date.now();
const password = 'testpass123';
const results = [];
async function login(name, pass = 'demo1234') {
  await page.getByLabel('아이디', { exact: true }).fill(name);
  await page.getByLabel('비밀번호', { exact: true }).fill(pass);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
}
async function logout() {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
}
async function checkButton(label, enabled = true) {
  const button = page.locator('.clock-buttons button');
  await page.getByRole('button', { name: label, exact: true }).waitFor();
  assert.equal(await button.count(), 1);
  assert.equal(await button.innerText(), label);
  assert.equal(await button.isEnabled(), enabled);
  assert.equal(await page.getByRole('dialog').count(), 0);
  results.push(label);
}
async function screenshot(name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `docs/screenshots/one-button-${name}.png` });
}
try {
  await mkdir('docs/screenshots', { recursive: true });
  await page.goto(origin);
  await login('owner');
  // Set up an isolated employee through the same authorized server API used by the UI.
  const response = await page.request.post(origin + '/api/employees', {
    headers: { Origin: origin },
    data: { name: '버튼 검증', username, password, hireDate: '2026-01-01', payType: 'hourly', active: true },
  });
  assert.equal(response.status(), 200);
  const employee = (await response.json()).employee;
  await logout();
  await login(username, password);
  await checkButton('출근하기');
  await screenshot('before-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot('before-desktop');
  await page.setViewportSize({ width: 360, height: 780 });
  await screenshot('before-small-mobile');
  // Failed requests keep the same action; retry succeeds without a confirmation dialog.
  await page.route('**/api/clock', route => route.abort(), { times: 1 });
  await page.getByRole('button', { name: '출근하기', exact: true }).click();
  await page.locator('.global-error').waitFor();
  await checkButton('출근하기');
  await page.getByRole('button', { name: '요청 다시 시도', exact: true }).click();
  await checkButton('퇴근하기');
  await screenshot('working-mobile');
  await page.reload();
  await checkButton('퇴근하기');
  await page.getByRole('button', { name: '퇴근하기', exact: true }).click();
  await checkButton('오늘 근무 완료', false);
  await screenshot('complete-mobile');
  await page.reload();
  await checkButton('오늘 근무 완료', false);
  const own = await (await page.request.get(origin + '/api/state')).json();
  assert.equal(own.attendance.length, 1);
  assert.ok(own.attendance[0].clockOut);
  // Owner manually adds a missed, completed shift through the real form.
  await logout();
  await login('owner');
  await page.getByRole('button', { name: '근무기록 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('직원', { exact: true }).selectOption(employee.id);
  await page.getByLabel('출근 · 한국 시각', { exact: true }).fill('2026-01-02T09:00');
  await page.getByLabel('퇴근 · 미퇴근은 비워 두세요', { exact: true }).fill('2026-01-02T18:00');
  await page.getByLabel('수정 사유', { exact: true }).fill('출퇴근 입력 누락');
  await page.getByRole('button', { name: '저장하기', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await logout();
  await login(username, password);
  await page.locator('.mobile-nav').getByRole('button', { name: '내 출석부', exact: true }).click();
  await page.getByText('출퇴근 입력 누락', { exact: true }).waitFor();
  await screenshot('owner-entry-reflected');
  const corrected = await (await page.request.get(origin + '/api/state')).json();
  assert.equal(corrected.attendance.length, 2);
  assert.equal(corrected.attendance.find(r => r.workDate === '2026-01-02').calculatedMinutes, 420);
  assert.deepEqual(errors, []);
  await writeFile('docs/screenshots/one-button-results.json', JSON.stringify({ results, ownerMissedEntry: true, employeeReflection: true, pageErrors: errors }, null, 2));
  console.log('PASS single-button check-in/out/completed, reload, network retry, owner missed entry, employee reflection, 360/390/1440px layouts');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/one-button-failure.png' });
  console.error({ pageErrors: errors, clock: await page.locator('.clock-buttons').textContent() });
  throw error;
} finally {
  await browser.close();
}
