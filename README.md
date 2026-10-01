# 몸의 일기 — 개인용 Firebase 웹앱

생년월일 `1976-11-30`을 기준으로 매일 상단에  
**“49년 10개월 1일째 — 오늘의 몸을 기록합니다.”**처럼 정확한 달력 나이를 보여주는 개인용 몸 기록 앱입니다.

## 포함 기능

- Firebase 이메일/비밀번호 로그인
- 회원가입 UI 없음
- 로그인한 UID 소유자만 Firestore 기록 읽기/쓰기
- 로그인한 UID 소유자만 Storage 사진 읽기/쓰기
- 날짜별 몸 상태 기록
- JPG/PNG/WEBP 사진 첨부 (한 장 8MB 이하)
- 최근 12개 기록 불러오기
- 특정 날짜 기록 조회/수정
- 브라우저 인쇄 기능을 이용한 PDF 저장
- `Asia/Seoul` 기준 오늘 날짜 계산
- 윤년/월별 일수를 반영한 `년·개월·일` 경과 계산

---

## 1. Firebase 프로젝트 만들기

Firebase Console에서 새 프로젝트를 만든 뒤 Web App을 추가합니다.

### Authentication
Authentication > Sign-in method에서 **Email/Password**를 활성화합니다.

Authentication > Users에서 **본인이 사용할 계정 1개만 직접 생성**하세요.  
이 앱에는 회원가입 버튼이 없습니다.

### Firestore Database
Cloud Firestore를 생성합니다.

`firestore.rules` 파일의 내용을 Firebase Console > Firestore > Rules에 붙여넣고 게시합니다.

### Storage
Cloud Storage를 생성합니다.

`storage.rules` 파일의 내용을 Firebase Console > Storage > Rules에 붙여넣고 게시합니다.

---

## 2. Firebase 설정값 넣기

`firebase-config.js`를 열고 아래 값을 Firebase Console의  
프로젝트 설정 > 내 앱 > SDK 설정 및 구성에서 복사해 넣습니다.

```js
window.BODY_DIARY_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Firebase 웹 `apiKey`/config 값만으로 데이터가 열리는 구조가 아닙니다.  
실제 접근 통제는 Authentication과 Firestore/Storage Security Rules가 담당합니다.

---

## 3. GitHub Pages에 올리기

이 폴더의 파일을 GitHub 저장소 루트에 업로드합니다.

GitHub:
Settings > Pages > Deploy from a branch > `main` / `(root)`

잠시 후 발급되는 `https://사용자명.github.io/저장소명/` 주소로 접속합니다.

Firebase Console > Authentication > Settings > Authorized domains에도  
GitHub Pages 도메인을 추가해야 할 수 있습니다.

---

## 4. PDF 저장

앱 우측 상단의 **PDF** 버튼을 누르면 인쇄 화면이 열립니다.

iPhone/Safari에서는:
1. PDF 버튼
2. 인쇄 미리보기
3. 미리보기를 확대해서 PDF 화면 열기
4. 공유 > 파일에 저장

PC에서는 인쇄 대상에서 **PDF로 저장**을 선택하면 됩니다.

---

## 보안 권장사항

1. Firestore/Storage Rules를 절대 `allow read, write: if true;`로 두지 마세요.
2. 본인 계정 비밀번호는 다른 서비스와 중복 사용하지 마세요.
3. Firebase Authentication에서 새 사용자를 임의로 만들지 마세요.
4. GitHub 저장소에 서비스 계정 JSON, Admin SDK 비밀키를 올리지 마세요.
5. 운영 전에 Firebase App Check를 추가하는 것을 권장합니다.
6. 민감한 사진이 많다면 휴대폰 자체의 잠금/생체인증도 함께 사용하세요.

## 파일

- `index.html` — 화면
- `style.css` — 디자인
- `app.js` — 나이 계산, 로그인, Firestore/Storage 연동
- `firebase-config.js` — 본인 Firebase 웹앱 설정
- `firestore.rules` — Firestore 보안 규칙
- `storage.rules` — 사진 Storage 보안 규칙
