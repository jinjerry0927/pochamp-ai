# 보안 및 배포 기준

## 현재 적용

- renderer는 Node.js 통합을 끄고 context isolation과 Chromium sandbox를 켭니다.
- 새 창, 임의 탐색, webview, renderer 권한 요청을 차단합니다.
- Content Security Policy로 로컬 스크립트·이미지 이외의 콘텐츠 로딩을 제한합니다.
- 모든 IPC 요청은 메인 프레임 발신자를 확인하고 인수 크기·형식·범위를 검증합니다.
- NVIDIA API 키는 main process에서만 복호화하며 Windows `safeStorage`에 저장합니다.
- NIM 인식에 성공한 캡처 이미지는 renderer로 돌려보내지 않고 디스크에도 저장하지 않습니다.
- 사용하지 않던 Pokémon Showdown 서버 패키지를 경량 Dex 데이터 패키지로 교체했습니다.
- 자동 업데이트 주소는 HTTPS만 허용하고 다운로드·설치는 사용자가 앱 화면에서 승인합니다.

## 공개 배포 전에 필수

1. 신뢰할 수 있는 전용 HTTPS 업데이트 경로를 확정합니다.
2. Windows 코드 서명 인증서를 CI 비밀 저장소에 넣고 설치 파일과 실행 파일을 서명합니다.
3. `Pochamp-AI-<version>-Setup.exe`, blockmap, `latest.yml`을 동일한 업데이트 경로에 원자적으로 게시합니다. `latest.yml`은 마지막에 올립니다.
4. 이전 서명 버전에서 새 버전 확인, 다운로드, 재시작 설치, 설정·팀 데이터 보존을 확인합니다.
5. `npm audit`, 타입 검사, 테스트, 벤치마크를 릴리스 게이트로 실행합니다.

업데이트 메타데이터의 SHA-512 검증은 전송 중 손상 방지에 도움이 되지만 배포자 신원 보증을 대신하지 않습니다. 공개 배포에는 HTTPS와 Windows 코드 서명을 모두 사용합니다.
