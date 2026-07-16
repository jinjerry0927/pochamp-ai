# 변경 기록

## 0.3.3 - 2026-07-16

- sandbox renderer에서 지원되지 않는 ESM preload를 CommonJS preload로 전환해 빈 화면 문제를 수정했습니다.
- preload 연결이 실패해도 빈 화면 대신 복구 안내를 표시합니다.
- 릴리스 검증에 sandbox preload 형식 회귀 검사를 추가했습니다.

## 0.3.2 - 2026-07-16

- 기본 업데이트 피드를 `jinjerry0927/pochamp-ai` GitHub Releases에 연결했습니다.
- 기존에 업데이트 주소가 비어 있던 설정을 새 기본 주소로 자동 마이그레이션합니다.

## 0.3.1 - 2026-07-16

- 패키징 환경에서 `electron-updater` CommonJS 모듈을 불러오지 못해 앱이 시작되지 않던 문제를 수정했습니다.
- GitHub Actions 검증 및 Windows Release 초안을 추가했습니다.

## 0.3.0 - 2026-07-16

- Electron sandbox, CSP, 권한 차단, IPC 입력 검증을 적용했습니다.
- 취약한 서버 의존성을 제거하고 `@pkmn/dex` 데이터 패키지로 교체했습니다.
- HTTPS 피드 기반 앱 내 업데이트 확인·다운로드·재시작 설치 기능을 추가했습니다.
