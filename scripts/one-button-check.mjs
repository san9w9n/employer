import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const browserType = require(process.env.PLAYWRIGHT_MODULE || 'playwright')[process.env.BROWSER_ENGINE || 'chromium'];
const origin = process.env.TEST_ORIGIN || 'http://localhost:3011';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
assert(loopback.has(new URL(origin).hostname), 'Use a local verification server');
const configResponse = await fetch(origin + '/api/config');
assert.equal(configResponse.status, 200);
const config = await configResponse.json();
if (config.demo !== true) {
  assert.equal(config.demo, false, 'Server must explicitly report its storage mode');
  assert.equal(process.env.ALLOW_LOCAL_VERIFY, 'true', 'Real database verification requires ALLOW_LOCAL_VERIFY=true');
  const database = new URL(process.env.DATABASE_URL || '');
  assert(['postgres:', 'postgresql:'].includes(database.protocol), 'Use a PostgreSQL verification database');
  assert(loopback.has(database.hostname), 'Use a loopback PostgreSQL verification database');
}
const browser = await browserType.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', ignoreHTTPSErrors: true, serviceWorkers: 'block' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const username = 'onebutton' + Date.now();
const password = 'testpass123';
const results = [];
const clockRequests = [];
page.on('request', request => {
  if (new URL(request.url()).pathname === '/api/clock' && request.method() === 'POST') clockRequests.push(request.postDataJSON());
});
async function ownAttendance() {
  const response = await page.request.get(origin + '/api/state');
  assert.equal(response.status(), 200);
  return (await response.json()).attendance;
}
async function doubleClick(label) {
  await page.getByRole('button', { name: label, exact: true }).evaluate(button => { button.click(); button.click(); });
}
async function loseResponse() {
  await page.route('**/api/clock', async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('failed');
  }, { times: 1 });
}
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
  await doubleClick('퇴근하기');
  await checkButton('다시 출근하기');
  const firstCheckout = clockRequests.findLast(request => request.action === 'out');
  await screenshot('complete-mobile');
  await page.reload();
  await checkButton('다시 출근하기');
  let own = await ownAttendance();
  assert.equal(own.length, 1);
  assert.ok(own[0].clockOut);
  const firstShift = structuredClone(own[0]);

  // A committed check-in with a lost response must remain one shift after retry.
  await loseResponse();
  await doubleClick('다시 출근하기');
  await page.locator('.global-error').waitFor();
  own = await ownAttendance();
  assert.equal(own.length, 2);
  assert.equal(own.filter(row => !row.clockOut).length, 1);
  await doubleClick('요청 다시 시도');
  await checkButton('퇴근하기');
  assert.equal((await ownAttendance()).length, 2);
  // Replaying an old successful checkout must never close the new shift.
  const stale = await page.request.post(origin + '/api/clock', {
    headers: { Origin: origin }, data: firstCheckout,
  });
  assert.equal(stale.status(), 200);
  own = await ownAttendance();
  assert.equal(own.filter(row => !row.clockOut).length, 1);
  assert.deepEqual(own.find(row => row.id === firstShift.id), firstShift);
  await page.reload();
  await checkButton('퇴근하기');

  // A committed checkout with a lost response can also be retried safely.
  await loseResponse();
  await doubleClick('퇴근하기');
  await page.locator('.global-error').waitFor();
  assert.equal((await ownAttendance()).filter(row => !row.clockOut).length, 0);
  await doubleClick('요청 다시 시도');
  await checkButton('다시 출근하기');
  await page.reload();
  await checkButton('다시 출근하기');

  // The third same-day cycle catches stale request IDs reused after recovery.
  await doubleClick('다시 출근하기');
  await checkButton('퇴근하기');
  own = await ownAttendance();
  assert.equal(own.length, 3);
  assert.equal(own.filter(row => !row.clockOut).length, 1);
  await page.route('**/api/clock', route => route.abort(), { times: 1 });
  await doubleClick('퇴근하기');
  await page.locator('.global-error').waitFor();
  assert.equal((await ownAttendance()).filter(row => !row.clockOut).length, 1);
  await doubleClick('요청 다시 시도');
  await checkButton('다시 출근하기');
  await page.reload();
  await checkButton('다시 출근하기');
  own = await ownAttendance();
  assert.equal(own.length, 3);
  assert.ok(own.every(row => row.clockOut));
  assert.equal(new Set(own.map(row => row.workDate)).size, 1);
  assert.equal(new Set(own.map(row => row.id)).size, 3);
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
  assert.equal(corrected.attendance.length, 4);
  assert.equal(corrected.attendance.find(r => r.workDate === '2026-01-02').calculatedMinutes, 420);
  assert.deepEqual(errors, []);
  await writeFile('docs/screenshots/one-button-results.json', JSON.stringify({ results, sameDayCycles: 3, responseLossRetry: true, staleCheckoutReplay: true, doubleClicks: true, ownerMissedEntry: true, employeeReflection: true, pageErrors: errors }, null, 2));
  console.log('PASS three same-day check-in/out cycles, reload, pre-send failure, committed-response loss, double clicks, stale checkout replay, owner missed entry, employee reflection, 360/390/1440px layouts');
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/one-button-failure.png' });
  console.error({ pageErrors: errors, clock: await page.locator('.clock-buttons').textContent() });
  throw error;
} finally {
  await browser.close();
}
