# 포챔 AI 구조

## 경계

- `apps/desktop`: Electron main/preload/React renderer. 화면 캡처, 비밀키, 로컬 저장, 사용자 확인을 소유한다.
- `packages/engine`: 순수 도메인 스키마, Showdown 데이터 어댑터, 팀 검증, 추천 정책을 소유한다.
- `data/regulations`: 날짜가 고정된 규정 스냅샷과 출처를 보관한다.

NVIDIA NIM은 캡처 화면을 구조화된 상태로 변환한다. 행동 순위와 예상 승률은 항상 로컬 엔진이 계산한다.

## 신뢰 경계

1. 캡처 결과는 닫힌 어휘 목록과 스키마로 검증한다.
2. 사용자가 상태를 확정하기 전에는 전략 엔진을 실행하지 않는다.
3. 인식 불가 값은 추측하지 않고 `unknown`으로 유지한다.
4. API 키는 renderer로 전달하지 않고 Electron main process에서만 복호화한다.
5. 앱은 BlueStacks에 키나 마우스 입력을 보내지 않는다.

## 현재 계산 모델

MVP 추천기는 Pokémon Showdown의 세대 9 데이터와 타입/기술 정보를 사용하고, 실제 Lv.50 스탯을 최우선으로 적용한다. 3턴 몬테카를로 탐색은 데미지 변동, 명중, 속도, 교체 피해를 비교한다. Champions 고유 효과가 검증되지 않은 경우 추천 신뢰도를 낮추고 가정에 표시한다.

