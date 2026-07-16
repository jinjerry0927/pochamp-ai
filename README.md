# 포챔 AI

Pokémon Champions의 싱글 친선전을 위한 Windows 로컬 의사결정 도우미입니다. BlueStacks 화면을 사용자가 직접 캡처·확정하면 출전 3마리/선봉 또는 기술/교체 행동을 추천합니다. 게임 입력과 자동 클릭은 하지 않습니다.

> 비공식 개인 연구 도구입니다. Pokémon 및 관련 표장은 각 권리자에게 있으며, 공식 로고와 포켓몬 이미지를 포함하지 않습니다. 표시되는 수치는 보정 전 **시뮬레이션 예상 승률**입니다.

## 현재 구현 범위

- 규정 `M-B@2026-07-16` 스냅샷: 허용 235개 종·폼과 메가진화 규칙
- 6마리 팀 등록 및 종/도구 중복, 기술, 특성, 실제 Lv.50 스탯 검증
- M-B 235개 종·폼 전체 선택과 종별 특성·기술, 도구 148개, Stat Alignment 21개 연동 드롭다운
- 60개 출전 3마리·선봉 후보 전체 비교
- 모든 등록 기술과 생존 교체 후보의 3턴 근사 롤아웃 비교
- BlueStacks 창 선택, 정규화 캡처 영역, `Ctrl+Shift+Space`, 중복 프레임 제거
- NVIDIA NIM 화면 구조화, 낮은 신뢰도/장애 시 수동 확인
- Windows 보안 저장소 기반 API 키 암호화, 로컬 팀/설정/이력 복원
- Electron 샌드박스·권한 차단·IPC 입력 검증·CSP 보안 정책
- HTTPS 피드 기반 앱 내 업데이트 확인·다운로드·재시작 설치
- 항상 위 추천 패널과 한국어 팀/배틀/설정 화면

## 실행

요구 환경은 Windows, Node.js 24 이상입니다.

```powershell
npm install
npm run data:sync
npm run dev
```

1. BlueStacks에서 Pokémon Champions를 한국어로 실행합니다.
2. 포챔 AI의 `설정`에서 BlueStacks 창과 캡처 영역을 선택합니다.
3. 외부 전송 고지에 동의하고 NVIDIA API 키를 저장합니다. 키는 renderer에 노출하지 않습니다.
4. `내 팀`에 실제 Lv.50 스탯을 포함한 정확한 6마리를 저장합니다.
5. 팀 미리보기나 턴 화면에서 `Ctrl+Shift+Space`를 누르고 인식 결과를 수정·확정합니다.

NIM 없이도 상대 포켓몬과 배틀 상태를 직접 입력해 로컬 추천을 사용할 수 있습니다. 환경 변수 `NVIDIA_API_KEY`도 지원합니다.

앱 창은 기본적으로 항상 위에 고정되지 않습니다. 배틀 중 필요할 때만 설정에서 `추천 창을 항상 위에 표시`를 켤 수 있습니다. Stat Alignment는 기존 시리즈의 성격 능력 보정과 같은 항목이며, 실제 Lv.50 스탯이 계산의 최종 기준입니다.

## 검증과 패키징

```powershell
npm run typecheck
npm test
npm run benchmark
npm run build
npm run package:win
npm run verify:release
npm run audit:security
```

`benchmark`는 1,000개 상태에서 엔진 경로의 참조 무결성과 p95 계산 시간을 검증합니다. 실제 전략 우위는 이 수치로 주장하지 않으며 [QA_PROTOCOL.md](./docs/QA_PROTOCOL.md)의 골든 프레임 100장 및 무도움/도움 친선 30판 절차를 통과한 뒤 판정합니다.

현재 생성되는 Windows 설치 파일은 개인 로컬 실험용 미서명 빌드입니다. 배포 전에 코드 서명 인증서와 전용 앱 아이콘을 구성해야 합니다.

### 자동 업데이트

설정의 `앱 업데이트`에서 신뢰할 수 있는 HTTPS 업데이트 서버 주소를 한 번 등록하면 앱이 시작 후와 6시간마다 새 버전을 확인합니다. 새 버전은 앱 안에서 다운로드한 뒤 `재시작 및 설치`할 수 있으므로 매번 브라우저에서 설치 파일을 받을 필요가 없습니다. 배포자는 `release` 폴더의 설치 파일, blockmap, `latest.yml`을 같은 HTTPS 경로에 올려야 합니다.

기본 업데이트 서버는 [jinjerry0927/pochamp-ai Releases](https://github.com/jinjerry0927/pochamp-ai/releases)에 연결되어 있습니다. 공개 Release에 설치 파일, blockmap, `latest.yml`이 모두 게시된 버전부터 앱 내 업데이트가 동작합니다. Windows 코드 서명 전 빌드는 자동으로 Draft Release에만 올립니다. 자세한 보안 기준은 [SECURITY.md](./docs/SECURITY.md)를 참고하세요.

소스 버전과 배포 자동화는 Git 태그와 GitHub Actions를 기준으로 구성했습니다. 저장소 연결, 태그 릴리스, 코드 서명 설정은 [RELEASE.md](./docs/RELEASE.md)를 참고하세요.

## 데이터와 개인정보

- 규정 원본은 [Pokémon HOME 공식 공지](https://news.pokemon-home.com/en/page/776.html), 식별자 동기화는 [Bulbapedia Regulation Set M-B](https://bulbapedia.bulbagarden.net/wiki/Regulation_Set_M-B)를 함께 기록합니다.
- 캡처 이미지는 메모리에서 NIM 요청과 사용자 확인에만 사용하고 디스크에 저장하지 않습니다.
- NVIDIA 동의가 없거나 API 키가 없으면 캡처 전송을 거부합니다.
- 팀, 설정, 추천 이력은 Electron 사용자 데이터 디렉터리에만 저장합니다.

## 알려진 한계

- 추천 엔진의 종·기술·특성 참조는 Pokémon Showdown 데이터에서 파생된 경량 `@pkmn/dex`를 사용하며, 현재 전투 탐색은 완전한 Showdown 턴 실행기가 아닌 3턴 근사 정책입니다.
- Champions 고유 효과와 메가진화 차이는 실기 골든 케이스가 누적되기 전까지 가정으로 표시하며 신뢰도를 낮춰야 합니다.
- 한국어 골든 프레임 100장 정확도와 친선 30판 성능 향상 기준은 코드만으로 완료할 수 없는 현장 검증 항목입니다.
- 시즌이 바뀌면 새 날짜 스냅샷을 생성하고 참조 무결성/차이 규칙을 다시 검증해야 합니다.
