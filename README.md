# 오늘근무

한 매장의 사장님과 직원을 위한 모바일 출퇴근·급여 관리 앱. Next.js App Router + TypeScript, 독립 서버 세션, `pg`, `node-pg-migrate`로 구현했습니다.

## 로컬 실행

Node.js 22 이상 권장.

```sh
npm install
cp .env.example .env.local
npm run dev
```

http://localhost:3000 에서 실행합니다. 기본 예시는 `DEMO_MODE=true`인 **로컬 파일 샘플 모드**입니다. 최초 접근 시 `.local/demo.json`에 샘플이 만들어집니다. DB 연결 없이 화면과 실제 서버 흐름을 검증할 수 있으며, 단일 프로세스 개발용입니다. 오프라인 출퇴근은 지원하지 않습니다.

| 계정 | 아이디 | 샘플 비밀번호 |
|---|---|---|
| 사장님 | owner | demo1234 |
| 직원 김민지 | employee | demo1234 |
| 직원 이준호 | junho | demo1234 |
| 월급제 박서연 | seoyeon | demo1234 |

샘플 계정은 개발 전용입니다. 실제 운영에서는 빈 DB에 사장님 계정을 별도로 생성합니다.

## PostgreSQL 연결 및 마이그레이션

Supabase를 쓸 때 PostgreSQL 연결 문자열만 사용합니다. Supabase Auth / Data API / Realtime / Storage 등은 사용하지 않습니다. 다음 값을 `.env.local`에 설정합니다.

```dotenv
DEMO_MODE=false
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
MIGRATION_DATABASE_URL=postgresql://USER:PASSWORD@DIRECT_HOST:5432/DATABASE
DATABASE_SSL=true
APP_ORIGIN=http://localhost:3000
```

`DATABASE_URL`은 런타임 풀 연결, `MIGRATION_DATABASE_URL`은 별도 마이그레이션 연결입니다. 후자는 생략하면 전자를 사용합니다. Supabase에서는 `DATABASE_SSL_CA`에 공급자의 Root CA PEM을 넣습니다(실제 줄바꿈 또는 `\n` 지원). 인증서 검증은 항상 켜져 있습니다. 로컬 PostgreSQL에서는 `DATABASE_SSL`을 생략합니다. Next.js는 `.env.local`을 읽지만 CLI 명령은 셸 환경변수가 필요합니다. 다음처럼 Node의 환경 파일 옵션을 사용할 수 있습니다.

```sh
node --env-file=.env.local scripts/migrate.mjs up
node --env-file=.env.local scripts/migrate.mjs down
node --env-file=.env.local scripts/migrate.mjs up
# 또는 셸 환경변수를 설정한 뒤:
npm run db:up
npm run db:down
```

마이그레이션은 별도 명령이며 요청 처리·앱 시작 시 실행되지 않습니다. 개발 샘플은 별도 명령으로 빈 DB에만 입력합니다.

```sh
ALLOW_SAMPLE_SEED=true node --env-file=.env.local --import tsx scripts/seed.ts
# 셸에 DB 환경변수가 있다면 ALLOW_SAMPLE_SEED=true npm run db:seed
```

운영 사장님 생성: `DATABASE_URL`, `OWNER_USERNAME`, `OWNER_PASSWORD`(12자 이상), 선택적으로 `OWNER_NAME`을 안전한 셸 환경에 제공하고 `npm run db:owner`를 실행합니다. 이미 사장님이 있으면 덮어쓰지 않습니다. 이후 직원 계정·시급·산정기간은 사장님 화면에서 관리합니다.

## 기능과 계산 규칙

- 직원은 본인 출퇴근·기록·시급·산정기간만 조회합니다. 직원 API 응답에는 급여 집계 필드가 없습니다.
- UTC 밀리초로 저장하고 출근일·조회·기간 집계는 한국 시각 기준입니다. 자정을 넘겨도 출근일 기록으로 남습니다.
- 하루 여러 출퇴근 기록을 지원하며 직원별 하나의 미퇴근 기록 제약과 근무시간 중복 검사, 요청 키에 의한 멱등성, 동일 DB 연결 트랜잭션으로 중복·부분 저장을 막습니다.
- 출근일수와 오늘 출근 인원은 각각 날짜·직원 기준으로 중복 없이 집계합니다. 퇴근 후 다시 출근할 수 있고, 익일 새벽 퇴근도 기존 미퇴근 기록에 연결됩니다.
- 차감 기본 120분을 기록별 값으로 대체하고, 인정은 0/60분 상태로 처리합니다. 수정하면 확인 전으로 돌아갑니다. 실제 짧은 근무의 퇴근은 저장하고 오류를 표시합니다.
- `퇴근−출근−차감+인정`을 밀리초 정수로 계산합니다. 날짜별 유효 시급을 적용해 **일별 원 단위 반올림(0.5원 올림) 후 합산**합니다. 같은 출근일의 여러 기록은 합산한 뒤 반올림합니다. 화면의 분 반올림은 급여에 사용하지 않습니다.
- 미완료·오류·시급 미설정 기록은 예상 급여에서 제외하고 건수를 표시합니다. 미확인 정상 기록은 예상 합계에 포함하되 미확인 건수도 표시합니다.
- 산정일 1~31일 지원. 없는 날짜는 해당 월 말일로 보정합니다. 변경은 미래의 기존 기간 경계부터 가능하며 첫 전환 기간을 조정해 누락·중복을 막습니다. 예: 10/1에 21일 시작으로 바꾸면 10/1~10/20 전환기간 다음 10/21~11/20이 됩니다.
- 월급제는 근태만 집계합니다. 수당·세금·보험료 등은 계산하지 않습니다.

## Vercel 배포

1. 저장소를 Vercel의 Next.js 프로젝트로 가져옵니다. 빌드 `npm run build`.
2. 환경변수 `DATABASE_URL`, `DATABASE_SSL=true`, `DATABASE_SSL_CA`, `APP_ORIGIN=https://실제도메인`을 설정합니다. `DEMO_MODE=false`, `ENABLE_SAMPLE_LOGIN`은 미설정으로 둡니다.
3. 배포 전 별도 관리 환경에서 마이그레이션과 사장님 계정 생성을 실행합니다. 운영 DB에 샘플을 입력하지 않습니다.
4. HTTPS에서 로그인과 출퇴근을 확인합니다. iOS 공유 메뉴의 ‘홈 화면에 추가’ 또는 지원 브라우저 설치 메뉴로 PWA를 설치합니다.

Vercel에서는 파일 샘플 모드를 차단합니다. 2026-09-13 Supabase `employer`(서울)와 Vercel `employer`(함수 서울) 운영 연결을 완료했습니다. 운영 주소는 https://employer-one.vercel.app 입니다. 운영 계정은 별도로 생성했고 샘플 데이터는 넣지 않았습니다. 초기 로그인 정보는 배포·Git에서 제외된 `.local/production-login.txt`에 보관합니다. HTTPS 로그인, 세션, 권한, 로그아웃 검증 결과는 `docs/production-smoke.json`에 있습니다.

## 검증

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run verify:api     # 로컬 샘플 DB와 실행 서버 필요, 검증 직원이 추가됨
```

`npm run verify:db`는 `DATABASE_URL`과 `ALLOW_LOCAL_VERIFY=true`를 요구하며 **계정이 없는 전용 검증 DB에만** 실행합니다. 롤백·재적용 후 샘플을 넣고 실제 FK 실패의 트랜잭션 원자성을 확인합니다.

`npm run verify:browser`는 설치된 Playwright를 사용합니다. 필요 시 `PLAYWRIGHT_MODULE`에 기존 모듈 경로, `CHROMIUM_EXECUTABLE`에 기존 Chromium 실행 경로를 지정하세요. 캡처는 `docs/screenshots/`에 저장됩니다.

[검증 결과](docs/verification.md) · [디자인 근거](docs/design.md) · [서버 운영과 한계](docs/backend.md)

### 모바일 입력·팝업 검사

`npm run verify:mobile`은 Playwright의 실제 모바일 컨텍스트에서 모든 메뉴/입력 모달을 순회합니다. 문서 가로 넘침뿐 아니라 팝업·필드 내부 넘침, 입력칸 경계와 높이, 스크롤 후 포커스한 입력의 가림을 검사합니다. 로컬 데모 서버만 허용합니다.

```sh
# 별도 터미널: 운영 데이터와 분리된 개발 서버
DEMO_MODE=true DEMO_DATA_PATH=/tmp/mobile-layout-demo.json APP_ORIGIN=http://localhost:3000 npm run dev
# 설치된 Playwright 경로를 PLAYWRIGHT_MODULE에 지정할 수 있습니다.
AUDIT_ENGINE=webkit MOBILE_EDGE_DATA=true npm run verify:mobile
AUDIT_ENGINE=chromium npm run verify:mobile
```

`MOBILE_EDGE_DATA=true`는 로컬 데모 직원 이름을 최대 길이로, 기록 사유를 500자로 바꿔 경계 조건을 만듭니다. 보고서와 화면은 `docs/screenshots/mobile-audit/current/<engine>/`에 저장됩니다. `TEST_ORIGIN`, `AUDIT_RUN`, `AUDIT_WIDTH`, `AUDIT_HEIGHT`로 주소·결과 폴더·단일 화면 크기를 지정할 수 있습니다. 프로덕션 빌드로 검사할 때 WebKit은 Secure 쿠키를 위해 로컬 HTTPS가 필요합니다. 짧은 viewport는 키보드로 줄어든 공간을 모사하며 실제 기기 키보드 검증을 대신하지 않습니다.

여러 출퇴근 기능을 기존 DB에 적용하려면 배포 전에 `npm run db:up`으로 `1789270000002_multiple_daily_shifts` 마이그레이션을 적용하세요. 기존 기록은 유지됩니다. 같은 날 여러 기록이 있으면 이전 일별 유일 제약으로 롤백할 수 없습니다.

## 출석부 초기화와 기록 수정

사장님 출석부의 `오늘 초기화`, `이번 주 초기화`, `이번 달 초기화`에서 삭제 대상을 먼저 확인합니다. 한국 시간의 출근일 기준이며 주간은 월요일~일요일, 월간은 해당 달 전체입니다. 직원·날짜 조회 필터와 무관하게 전체 직원의 해당 기간 기록이 대상입니다. 익일 새벽 퇴근은 원래 출근일에 귀속됩니다.

확인창에 기간, 직원 수, 기록 수, 미퇴근·확인 완료 건수를 표시하고 최종 삭제 버튼을 눌러야 실행됩니다. 미퇴근도 삭제되며 급여 집계에서 제외됩니다. 직원·시급·산정기간 설정과 삭제 전 기록의 감사 이력은 유지합니다. UI에서 삭제를 되돌리는 기능은 없습니다. 확인 중 대상이 변경되면 재확인을 요구하고, 같은 요청을 재시도해도 이후 생긴 기록을 추가 삭제하지 않습니다.

기록 수정창에서는 출근 당일/다음 날 퇴근, 미퇴근 설정, 휴게시간 0·30·60·120분, 수정 사유 빠른 선택을 제공합니다. 저장 전 계산시간이 즉시 표시됩니다. 기존 기록의 직원은 변경할 수 없으며, 시간을 수정하지 않으면 기존 초·밀리초도 보존합니다.

로컬 샘플 서버에서 `TEST_ORIGIN=http://localhost:3110 npm run verify:attendance-management`로 확인·취소·실제 삭제·동시 수정 거부·모바일 기록 수정을 검증합니다. Playwright 위치와 브라우저 실행 경로는 기존 검증 스크립트처럼 `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`로 지정할 수 있습니다. 운영 데이터에는 실행하지 않습니다.
