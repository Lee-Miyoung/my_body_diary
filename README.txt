몸의 일기 6명 전용 버전

1. firebase-config.js의 BODY_DIARY_ALLOWED_EMAILS 6칸을 실제 Google 이메일로 바꿉니다.
2. GitHub에 index.html / style.css / app.js / firebase-config.js를 덮어씁니다.
3. database.rules.json 내용은 Firebase Realtime Database > 규칙에 게시합니다.
4. 기존 사용자는 일기 데이터에 저장된 birthDate를 자동으로 읽어 profile로 마이그레이션합니다.
5. 새 사용자 5명은 첫 로그인 때 이름/별칭과 생년월일을 한 번 입력합니다.
6. 이후 각 사용자는 자기 UID 아래의 profile/diary만 읽고 쓸 수 있습니다.

주의:
- 앱 화면에서는 지정한 6개 이메일만 새 계정으로 진입하도록 막습니다.
- Realtime Database Rules는 각 사용자가 자기 UID 데이터만 읽고 쓰도록 막습니다.
