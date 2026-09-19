# 모바일 입력칸 검사 (2026-09-18)

Playwright로 로컬 production build의 사장님·직원 전체 메뉴와 입력 팝업을 검사하고, 재현된 가로 넘침을 수정했다. 이번 수정은 운영에 배포하고 WebKit 모바일 화면과 로그인·로그아웃을 확인했다. 운영 데이터는 변경하지 않았다.

## 재현 및 수정

정상 이름에서는 발견되지 않던 문제를 유효한 최대 길이인 60자 직원 이름과 500자 사유로 재현했다.

- WebKit의 직원 선택칸: 긴 선택값이 팝업 내부 너비를 296px에서 589px로 늘렸다. 선택값에만 잘림 처리를 적용하고 기본 선택 메뉴를 유지했다. 수정 후 내부 너비는 296px다.
- 직원 수정·급여 기간 팝업: 긴 이름이 헤더를 밀어 입력칸까지 화면 밖으로 나갔다. 헤더 내용이 줄어들고 긴 단어도 줄바꿈되도록 수정했다.
- 직원 오늘 화면: 긴 이름이 화면 너비를 320px에서 534px로 늘렸다. 상태 영역의 줄바꿈과 최소 너비를 수정했다.

제품 변경 파일은 `src/app/globals.css`다. 기존 구성과 입력 기능을 유지했으며 의존성 추가나 백엔드 변경은 없다. 검사 자동화를 위해 `scripts/mobile-layout-check.mjs`, `package.json`, `README.md`를 추가·보완하고 `scripts/one-button-check.mjs`에 WebKit 실행과 서비스 워커를 차단한 통신 장애 검증을 반영했다.

## 최종 결과

| 엔진 | 화면·상태 검사 | 넘침 | 페이지 오류 |
| --- | ---: | ---: | ---: |
| WebKit | 176 | 0 | 0 |
| Chromium | 176 | 0 | 0 |

각 엔진에서 320×568, 360×780, 375×667, 390×844, 430×932, 667×375, 390×420, 320×320을 검사했다. 로그인, 사장님 오늘·출석부·직원·급여, 직원 오늘·출석부·프로필, 기록 추가·수정, 직원 등록·수정, 시급·급여 기간·비밀번호, 변경 이력, 빈 상태와 입력 오류를 포함한다.

문서 전체뿐 아니라 팝업·폼·카드 내부 넘침, 개별 입력칸의 가로 경계, 입력 높이 44px 이상, 포커스·스크롤 후 입력 위치의 접근 가능 여부를 확인했다. 짧은 화면에서는 팝업 본문을 스크롤해 입력한다.

`npm test` 18개, lint, typecheck, production build를 통과했다. WebKit에서 실제 출퇴근 상태 전환, 통신 실패 후 재시도, 새로고침, 사장님의 누락 기록 추가 및 직원 반영도 통과했다.

- [WebKit 결과](screenshots/mobile-audit/final/webkit/results.json)
- [Chromium 결과](screenshots/mobile-audit/final/chromium/results.json)
- [수정 후 기록 추가](screenshots/mobile-audit/final/webkit/320x568-record-create.png)
- [수정 후 직원 수정](screenshots/mobile-audit/final/webkit/320x568-employee-edit.png)
- [320×320 입력 포커스](screenshots/mobile-audit/final/webkit/320x320-period-focused.png)
- 수정 전 경계값 증거: `screenshots/mobile-audit/edge-baseline/webkit/`

재실행 방법은 README의 모바일 입력·팝업 검사 항목을 따른다. 실제 휴대폰의 가상 키보드와 OS 날짜·선택 팝업은 물리 기기에서 검증하지 않았다. 짧은 viewport 검사는 실제 키보드 검증을 대체하지 않는다.
