# Git 및 GitHub 릴리스 절차

## 저장소 구성

- 소스 버전은 Git 커밋과 `v<version>` 태그로 관리합니다.
- `main` 브랜치와 Pull Request에는 Windows 검증 워크플로가 실행됩니다.
- `v*` 태그를 push하면 Windows 설치 파일, blockmap, `latest.yml`을 생성해 GitHub Release에 올립니다.
- Windows 서명이 유효하면 Release를 공개하고, 서명이 없으면 Draft 상태로 유지합니다.

## 버전 올리기

다음 패치 버전 번호를 루트와 데스크톱 패키지에 동일하게 반영합니다.

```powershell
npm version patch --no-git-tag-version
npm version patch -w @pochamp/desktop --no-git-tag-version
npm test
npm run typecheck
npm run package:win
npm run verify:release
```

검증 후 커밋과 태그를 push합니다.

```powershell
git add package.json package-lock.json apps/desktop/package.json CHANGELOG.md
git commit -m "release: v0.3.1"
git tag v0.3.1
git push origin main --follow-tags
```

## 자동 업데이트 주소

GitHub 저장소가 정해지면 앱의 기본 업데이트 주소를 다음 형식으로 설정합니다.

```text
https://github.com/<owner>/<repo>/releases/latest/download/
```

앱에는 GitHub 토큰을 넣지 않습니다. 따라서 이 방식으로 자동 업데이트 파일을 제공하려면 Release 자산을 공개적으로 읽을 수 있어야 합니다. 소스 저장소를 비공개로 유지해야 한다면 별도의 공개 Release 저장소 또는 전용 HTTPS 스토리지를 사용합니다.

## 코드 서명

GitHub 저장소의 Actions secrets에 다음 값을 등록합니다.

- `WINDOWS_CSC_LINK`: 인증서 파일의 base64 값 또는 안전한 다운로드 URL
- `WINDOWS_CSC_KEY_PASSWORD`: 인증서 암호

서명 키 파일과 암호는 Git에 커밋하지 않습니다.
