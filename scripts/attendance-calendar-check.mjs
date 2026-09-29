import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Use a local demo server');
assert.equal((await (await fetch(origin + '/api/config')).json()).demo, true);
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const output = 'docs/screenshots/attendance-calendar';
await mkdir(output, { recursive: true });
const setup = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
async function api(endpoint, data) {
  const response = await setup.post('/api/' + endpoint, { data });
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
await api('login', { username: 'owner', password: 'demo1234' });
const stamp = Date.now();
const staff = [];
// A crowded day proves that both counts and compact rows work with many employees.
for (let index = 0; index < 20; index++) {
  const { employee } = await api('employees', {
    name: `달력검증 ${index + 1}`, username: `cal${stamp}${index}`, password: 'testpass123',
    hireDate: '2020-01-01', payType: 'hourly', active: true,
  });
  staff.push(employee);
  await api('attendance', {
    employeeId: employee.id, clockIn: `${today}T00:00+09:00`, clockOut: new Date().toISOString(),
    deductionMinutes: 0, credited: false, reason: '달력 조회 검증',
  });
}
for (const date of ['2024-02-28', '2024-02-29', '2024-03-01']) {
  await api('attendance', {
    employeeId: staff[0].id, clockIn: `${date}T10:00+09:00`,
    clockOut: date === '2024-02-29' ? '2024-03-01T02:00+09:00' : `${date}T22:00+09:00`,
    deductionMinutes: 120, credited: false, reason: '과거 근무기록',
  });
}
const ownerState = await (await setup.get('/api/state')).json();
await setup.dispose();
const results = [];
for (const engine of ['chromium', 'webkit']) {
  const browser = await playwright[engine].launch();
  try {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 760, hasTouch: width < 760, locale: 'ko-KR', timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const nav = (name) => page.locator(width < 760 ? '.mobile-nav' : '.sidebar nav').getByText(name, { exact: true }).click();
      async function login(username, password) {
        await page.getByLabel('아이디', { exact: true }).fill(username);
        await page.getByLabel('비밀번호', { exact: true }).fill(password);
        await page.getByRole('button', { name: '로그인', exact: true }).click();
        await page.locator('.topbar').waitFor();
      }
      async function verifyDate(date, expected) {
        assert.equal(await page.getByLabel('근무일', { exact: true }).inputValue(), date);
        assert.equal(await page.locator('.calendar-day[aria-pressed=true]').getAttribute('data-date'), date);
        assert.equal(await page.locator('.attendance-records .record-card').count(), expected);
        for (const text of await page.locator('.attendance-records .person span').allTextContents()) assert(text.startsWith(date));
        assert.match(await page.locator('.attendance-list-heading').innerText(), new RegExp(`근무기록 ${expected}건`));
      }
      async function layout(role) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const bounds = await page.locator('.attendance-calendar,.attendance-filters,.attendance-records .record-card,.attendance-records .time-grid,.attendance-records .person').evaluateAll(elements => elements.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
        assert.deepEqual(bounds, []);
        const first = page.locator('.attendance-records .record-card').first();
        const compact = (await first.boundingBox()).height;
        await page.locator('.attendance-records').evaluate(e => e.classList.remove('attendance-records'));
        const previous = (await page.locator('.record-grid .record-card').first().boundingBox()).height;
        await page.locator('.record-grid').evaluate(e => e.classList.add('attendance-records'));
        assert(compact < previous * 0.8, `${role} ${width}: compact ${compact}, previous ${previous}`);
        await page.getByRole('status').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${output}/${engine}-${width}-${role}-calendar.png` });
        await first.evaluate(e => e.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: `${output}/${engine}-${width}-${role}-records.png` });
        results.push({ engine, width, role, compactHeight: compact, previousHeight: previous });
      }
      await page.goto(origin);
      await login('owner', 'demo1234');
      await nav('출석부');
      const todayCount = ownerState.attendance.filter(r => r.workDate === today).length;
      await verifyDate(today, todayCount);
      assert.match(await page.locator(`.calendar-day[data-date="${today}"]`).getAttribute('aria-label'), new RegExp(`기록 ${todayCount}건`));
      await layout('owner');
      await page.getByLabel('직원', { exact: true }).selectOption(staff[0].id);
      await verifyDate(today, 1);
      assert.match(await page.locator(`.calendar-day[data-date="${today}"]`).getAttribute('aria-label'), /기록 1건/);
      await page.getByLabel('근무일', { exact: true }).fill('2024-02-28');
      await verifyDate('2024-02-28', 1);
      await page.locator('[data-date="2024-02-29"]').click();
      await verifyDate('2024-02-29', 1);
      assert.match(await page.locator('.attendance-records').innerText(), /\+1일/);
      await page.getByRole('button', { name: '기록 추가', exact: true }).click();
      assert.equal(await page.getByLabel('출근 · 한국 시각', { exact: true }).inputValue(), '2024-02-29T10:00');
      await page.getByRole('button', { name: '닫기', exact: true }).click();
      await page.locator('[data-date="2024-02-29"]').focus();
      await page.keyboard.press('ArrowRight');
      await verifyDate('2024-03-01', 1);
      assert.equal(await page.locator('[data-date="2024-03-01"]').evaluate(e => e === document.activeElement), true);
      await page.getByRole('button', { name: '이전 달', exact: true }).click();
      assert.equal(await page.locator('.calendar-day').count(), 29);
      await page.locator('[data-date="2024-02-27"]').click();
      await verifyDate('2024-02-27', 0);
      await page.getByRole('heading', { name: '근무기록이 없습니다', exact: true }).waitFor();
      await page.getByLabel('근무일', { exact: true }).fill('2024-12-31');
      await page.getByRole('button', { name: '다음 달', exact: true }).click();
      await page.locator('[data-date="2025-01-01"]').click();
      await verifyDate('2025-01-01', 0);
      await page.locator('.calendar-today').click();
      await verifyDate(today, 1);
      await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
      await verifyDate(today, todayCount);
      if (engine === 'chromium' && width === 320) {
        await page.getByLabel('직원', { exact: true }).selectOption(staff[0].id);
        await page.getByLabel('근무일', { exact: true }).fill('2023-01-02');
        await page.getByRole('button', { name: '기록 추가', exact: true }).click();
        await page.getByLabel('출근 · 한국 시각', { exact: true }).fill('2023-01-03T10:00');
        await page.getByLabel('퇴근 · 미퇴근은 비워 두세요', { exact: true }).fill('2023-01-03T22:00');
        await page.getByLabel('수정 사유', { exact: true }).fill('달력 저장 재시도 검증');
        await page.route('**/api/attendance', route => route.abort(), { times: 1 });
        await page.getByRole('button', { name: '저장하기', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '요청 다시 시도', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.locator('.attendance-records .record-card').waitFor();
        await verifyDate('2023-01-03', 1);
        assert.match(await page.locator('.attendance-records').innerText(), /달력 저장 재시도 검증/);
      }
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      await login(staff[0].username, 'testpass123');
      await nav('내 출석부');
      await verifyDate(today, 1);
      assert.equal(await page.getByLabel('직원', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '기록 수정', exact: true }).count(), 0);
      await layout('employee');
      await page.getByLabel('근무일', { exact: true }).fill('2024-02-28');
      await page.locator('[data-date="2024-02-29"]').click();
      await verifyDate('2024-02-29', 1);
      assert.match(await page.locator('.attendance-records').innerText(), /과거 근무기록/);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${engine} ${width}: owner/employee calendar, Seoul today, day/month/year/leap-day navigation, counts/filtering, empty day, overnight record, keyboard, date-aware creation, compact rows`);
    }
  } finally { await browser.close(); }
}
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
