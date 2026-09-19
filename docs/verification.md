# 검증 결과

검증일: 2026-09-13, 로컬 macOS / Node.js 24 / Next.js 15.5.25 / PostgreSQL 17 (Docker).

## 검증 환경의 구분

- **실제 PostgreSQL 연동 검증**: 전용 로컬 PostgreSQL에 `pg`로 연결해 스키마, FK/unique/check, 트랜잭션, API 흐름을 검증했다. DB는 Docker `employer-postgres-verify`, 호스트 포트 55439를 사용했다.
- **로컬 파일 샘플 모드**: 별도 `DEMO_MODE=true` 경로. 파일 원자적 저장, 실패 롤백, 동시 요청 직렬화, 초기 seed 및 기존 데이터 보호, Vercel 차단을 테스트했다. 별도 포트 3001의 프로덕션 샘플 서버에서 동일한 HTTP 인증·출퇴근·급여·권한 흐름도 통과했다.
- **Supabase/Vercel 운영 연결**: 2026-09-13 서울 Supabase 프로젝트와 Vercel 운영 배포를 완료했다. https://employer-one.vercel.app 에서 실제 운영 계정 로그인, Secure/HttpOnly 세션, 비로그인 401, 다른 Origin 403, 로그아웃 후 세션 무효화를 확인했다. `production-smoke.json`에 결과를 보관한다. 샘플 직원은 0명이다. DB 9개 테이블의 RLS와 공개/API 역할 권한 제거, 익명 SQL 접근 거절도 확인했다. 별도 로컬 DB에서 두 마이그레이션 전체 롤백·재적용과 FK 실패 원자성 검증을 통과했다. PostgreSQL 외 Supabase 서비스는 사용하지 않는다.

## 기능 검증 증거

| 요구사항 | 검증 증거 | 결과 |
|---|---|---|
| 독립 인증, 서버 세션, 직원 범위 응답 | `tests/domain.test.ts`, `scripts/api-check.mjs` | 통과 |
| 직원 타인 기록·시급 수정·급여 조회 차단 | 본인 컬렉션 필터, 직원 payroll 필드 부재, 금지 POST 403 검사 | 통과 |
| 출근→퇴근→조회와 중복 재시도 | 동시 동일 요청 키/다른 중복 키, 재시도 후 1건·감사 2건 | 통과 |
| 실제 짧은 퇴근 저장·계산 제외 | 기본 120분보다 짧은 실제 HTTP 퇴근 성공, 오류 표시 | 통과 |
| 기본 차감·분할 차감·인정 상태 | 12시간 근무 600분, 1시간 인정 660분, 공백240분 480분 | 통과 |
| 확인·수정·감사 | 확인 후 수정 시 확인 전, before/after/actor/reason 저장 | 통과 |
| 사장님 수정의 직원 반영 | HTTP 재조회 480분, 12,000원 시급으로 96,000원 합계 | 통과 |
| 자정 근무·날짜별 시급·월중 변경 | 출근일에 고정한 유효 시급 합산 | 통과 |
| 월급제·미완료·시급 누락 | 월급제 amount null, 제외 건수 검증 | 통과 |
| 기간 변경·월말·연말·윤년 | 1~31일, 말일 보정, 전환기간과 후속기간의 연속성 | 통과 |
| 시간/금액 정밀도 | 정수 밀리초에서 일별 원 반올림, 1ms·0.5원 경계 | 통과 |
| 퇴사 처리 | 세션 폐기, 로그인 차단, 기존 근무 유지 | 통과 |
| CSRF | 다른 Origin 요청 403 | 통과 |
| 빈 DB migration | 전체 up 실제 실행 | 통과 |
| rollback/reapply | 전체 down 후 테이블 부재 확인, 전체 up | 통과 |
| 실제 DB 원자성 | 직원 insert 이후 attendance FK 실패 → 직원 insert도 rollback | 통과 |
| 미래 시각·겹침 | 미래 사장님 입력 차단, 잘못된 기존 데이터에 대한 punch 방어 | 통과 |

`npm test`: 18개 통과, 실패 0. `npm run lint`, `npm run typecheck`, `npm run build` 통과. 완성된 프로덕션 서버를 포트 3000에서 실행했다. 설치 후 npm audit 0건(PostCSS 보안 수정 버전 적용).

## 화면 검수

[디자인 근거](design.md)를 기준으로 실제 로컬 Chromium에서 데스크톱 1440×1000, 모바일 390×844 및 360×780으로 캡처했다. 내장 Browser 도구는 `sandboxPolicy` 환경 오류로 연결되지 않아 설치된 Playwright/Chromium을 사용했다.

- 로그인, 사장님 오늘·출석부·직원·급여, 직원 오늘·출석부·내 정보
- 근무 수정 입력/오류, 직원 등록 입력, 비밀번호 입력, 조정 내역, 빈 출석부
- 실제 통신 실패와 재시도, 짧은 근무 보정 표시, 저장 성공 후 조회 실패 안내와 재조회 복구
- 새 직원·시급 등록 → 직원 출퇴근 → 사장님 보정·1시간 인정·확인 → 직원 11시간/확인 완료 재조회 전체 모바일 흐름 통과
- 총 30개 화면과 1개 전체 흐름 검증. 가로 넘침 없음, 렌더링된 버튼/펼치기 44×44px 이상, 페이지 실행 오류 0건
- 전체 캡처 목록과 가로 넘침/터치 영역 검사: [browser-results.json](screenshots/browser-results.json)

Vision 검수에서 작은 보조 글씨, 모바일 장식 시계의 겹침, 작은 아이콘 버튼을 발견해 수정했다. 보조 글씨는 최소 12px로 보강하고, 밝은 배경의 보조 텍스트 대비를 4.88~5.48:1, 주황 상태 텍스트를 5.82:1로 개선했다. 모바일 장식 시계는 숨겼으며, 작업 버튼/조정 내역 펼치기는 최소 44px로 보정했다. 별도 검수자는 급여·출석부·직원·프로필의 위계·정렬·가독성을 93/100으로 통과 판정했다. 최종 프로덕션 캡처의 종합 Vision 판정은 94/100, pass이며 `.omx/state/ui/ralph-progress.json`에 저장했다. 제공된 픽셀 참조 이미지는 없어 요구사항 기반 사용성 검수이며 픽셀 일치 인증은 아니다.

## 남은 운영상 제한

- 실제 모바일 기기의 설치 메뉴·가상 키보드는 물리 기기에서 별도로 확인해야 한다. 반응형 viewport/안전영역과 입력 상태는 로컬 브라우저에서 검증했다.
- native 날짜 선택기 형식은 OS/브라우저 설정에 따른다. 한국 시각이라는 입력 레이블과 서버 변환은 고정되어 있다.
- 작은 단일 매장을 위한 상태 저장 구조는 전체 이력을 읽고 DB 전역 advisory lock을 사용한다. 장기간 데이터가 커질 경우 쿼리 범위·페이지네이션·잠금 범위 개선이 필요하다.
- 로그인 시도 제한은 서버 인스턴스별이므로 대규모/다중 인스턴스 운영은 공유 제한을 추가해야 한다.
- 샘플 계정은 운영 배포에 사용하지 않는다. 별도 사장님 생성 명령과 환경변수 설정은 [README](../README.md)를 따른다.

## 운영 브라우저 확인 (2026-09-13)

실제 HTTPS 사이트에서 사장님 로그인/로그아웃과 모바일 오늘·출석부·직원·급여 탭을 확인했다. 가로 넘침과 페이지 스크립트 오류는 없었다. 결과는 `production-browser.json`, 실제 화면은 `screenshots/production-*.png`에 있다. 운영 데이터에는 검증용 직원을 추가하지 않았다.

## 직원 출퇴근 버튼 통합 (2026-09-18)

- 직원 오늘 화면은 출근 전 `출근하기`, 근무 중 `퇴근하기`, 퇴근 후 비활성 `오늘 근무 완료` 버튼 하나만 표시한다. 클릭 즉시 서버 시각으로 저장하며 별도 확인창은 없다. 저장/조회 중에는 버튼을 비활성화한다.
- 누락 입력은 사장님께 요청하라는 안내를 추가했다. 기존 사장님 기록 추가/수정과 직원 직접 수정 제한을 유지한다.
- `npm test` 18개, lint, typecheck, production build 및 `TEST_ORIGIN=http://localhost:3011 npm run verify:api` 통과.
- `scripts/one-button-check.mjs`: 격리된 로컬 데모 서버에서 단일 버튼의 세 상태, 새로고침, 네트워크 실패 후 재시도, 사장님의 누락 기록 직접 추가 및 직원 반영을 실제 Chromium으로 확인했다. 360/390/1440px 가로 넘침 및 페이지 오류 없음. 결과는 `screenshots/one-button-results.json`, 캡처는 `screenshots/one-button-*.png`.
- 재실행: `DEMO_MODE=true DEMO_DATA_PATH=/tmp/employer-one-button-verify.json APP_ORIGIN=http://localhost:3011 npm run start -- --port 3011`로 빌드된 서버 실행 후 `PLAYWRIGHT_MODULE=<설치된 playwright 경로> CHROMIUM_EXECUTABLE=<Chrome 경로> node scripts/one-button-check.mjs`. 프로젝트 의존성은 추가하지 않았다.
- 기존 화면과 비교한 visual-verdict 95/pass: `.omx/state/one-button/ralph-progress.json`. 실제 모바일 기기 검증과 운영 배포는 이번 작업에 포함하지 않았다.

## 전체 UI 정리 (2026-09-18)

- 변경 파일: `src/app/page.tsx`, `src/app/globals.css`, `scripts/browser-check.mjs`, `docs/design.md`. 상태별 캡처와 검증 JSON을 갱신했다. 기존 비교 화면은 `screenshots/ui-before/`에 보관했다.
- 로그인은 중앙 폼으로 단순화했다. 사장님 홈의 큰 배너를 제거해 통계와 직원 목록을 올리고, 직원 홈은 근무 상태와 단일 출퇴근 버튼을 우선한다. 장식 시계, 영어 소제목, 사이드바 응원 문구, 소개 푸터와 반복 설명을 삭제했다. 입력 제약과 급여 제외 기준은 짧게 유지했다.
- CSS를 읽기 쉬운 형식으로 정리했다. 외부 Google Fonts 요청을 제거하고 한국어 시스템 글꼴 스택을 적용했다. 본문 15px, 보조 13~14px, 입력 16px, 제목 26~30px이며 이름·시간·금액 위계를 조정했다. 모바일에서도 등록 버튼의 레이블과 직원 카드의 계산시간 레이블이 보인다.
- 최종 production build에서 39개 화면(로그인, 사장님 4개 탭, 직원 3개 탭, 기록/직원/시급/기간/비밀번호/이력 모달, 오류·빈 상태)을 검증했다. 1440px 데스크톱, 768px 태블릿 주요 화면, 390px 및 360px 모바일을 포함한다. 가로 넘침 없음, 버튼·펼치기 최소 44×44px, 입력 16px 이상, 브라우저 오류 및 외부 폰트 요청 0건.
- `npm test` 18개, `npm run lint`, `npm run typecheck`, `npm run build` 통과. `TEST_ORIGIN=http://localhost:3012 npm run verify:api` 통과. Playwright는 기존 임시 도구 경로와 설치된 Chrome을 사용했으며 프로젝트 의존성을 추가하지 않았다.
- `scripts/browser-check.mjs` 전체 흐름: 계정·시급 등록 → 출퇴근/통신 재시도 → 사장님 보정·인정·확인 → 직원 반영 통과. `scripts/one-button-check.mjs` 단일 출퇴근 버튼·재조회·사장님 누락 입력 회귀 통과.
- 최종 요구사항 기반 visual-verdict: 95/pass, `.omx/state/ui-refresh/ralph-progress.json`. 실제 모바일 기기의 가상 키보드 및 운영 배포는 이번 검증에 포함하지 않았다.

## UI 개선 운영 배포 (2026-09-18)

사용자 배포 요청에 따라 Vercel production 배포 `dpl_A5hAe9m1UiA9QAEcCuav7G18eYsN`을 완료하고 https://employer-one.vercel.app 에 연결했다. Vercel 빌드 및 타입/린트 검사 통과, 최종 상태 READY. 운영 HTTPS에서 새 로그인 레이아웃, 15px 본문, 사장님 오늘·출석부·직원·급여, 로그인/로그아웃 및 세션 무효화를 확인했다. 가로 넘침과 페이지 오류는 없었다. 운영 근무/직원 데이터는 수정하지 않았다. 결과: `production-smoke.json`, `production-browser.json`; 캡처: `screenshots/production-*.png`.

## 모바일 입력칸 넘침 수정 (2026-09-18)

Playwright WebKit·Chromium에서 8종 모바일 viewport, 총 352개 화면·상태 검사를 통과했다. 긴 직원 이름에서 재현한 선택칸 내부 넘침, 팝업 헤더 확장, 직원 오늘 상태 영역 확장을 CSS로 수정했다. 내부 컨테이너·입력칸 경계와 포커스 후 접근도 검사했다. 테스트 18개, lint, typecheck, production build 및 WebKit 출퇴근 회귀 검증 통과. 자세한 결과와 캡처는 [모바일 검사 보고서](mobile-layout-audit.md)를 참고한다. 이 수정은 아래 후속 운영 배포에서 반영했다.

## 모바일 입력칸 수정 운영 배포 (2026-09-18)

Vercel production `dpl_DUe6gU2uAcX4nNtRW4AVgq2XSPmf` READY, https://employer-one.vercel.app 연결 완료. 운영 빌드·린트·타입 검사 통과. 실제 HTTPS에서 WebKit 320×568 사장님 오늘·출석부·직원·급여 화면의 가로 넘침과 페이지 오류가 없고, 선택칸 CSS 수정이 반영됨을 확인했다. 로그인·로그아웃 및 세션 무효화 검사 통과. 운영 근무·직원 데이터는 수정하지 않았다. 증거: `production-mobile-fix-browser.json`, `production-smoke.json`, `screenshots/production-mobile-fix-*.png`.
