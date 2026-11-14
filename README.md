# micro:bit V2 Web Bluetooth 테스트

BBC micro:bit V2의 기존 MakeCode UART 펌웨어에서 데이터를 받는 최소 정적 웹사이트입니다. 펌웨어는 변경하지 않습니다. 프레임워크, npm 의존성, 빌드, 백엔드, 데이터 저장이 없습니다.

## 실행

`index.html`, `style.css`, `app.js`를 같은 위치에 배포합니다. 개발 PC에서는 저장소에서 `python3 -m http.server 8000 --bind 127.0.0.1`로 실행하고 localhost에서 확인할 수 있습니다. 스마트폰의 Bluetooth 테스트는 아래 GitHub Pages HTTPS 주소에서 진행하세요. 스마트폰에서 PC의 HTTP IP 주소로 접속하면 Web Bluetooth를 사용할 수 없습니다.

선택적 개발 검증: Node.js가 있으면 `node --check app.js`와 `node --test tests/bluetooth.test.cjs`를 실행합니다. 모의 GATT 테스트는 실제 무선 연결 성공을 입증하지 않습니다.

## GitHub Pages 배포

1. 변경 커밋을 GitHub `main` 브랜치에 push합니다.
2. 저장소 Settings → Pages → Build and deployment에서 **Deploy from a branch**를 선택합니다.
3. Branch를 **main**, 폴더를 **/(root)**로 지정하고 Save합니다.
4. 배포 완료 후 `https://soup-bean.github.io/microbit-study-web/`를 Android Chrome에서 엽니다. 실제 배포 상태와 주소는 Pages 설정 화면에서 확인하세요.

별도 빌드나 Actions workflow 파일은 필요하지 않습니다.

## 통신 사양

| 역할 | UUID | 속성 |
| --- | --- | --- |
| UART 서비스 | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | 서비스 |
| micro → 웹 수신 | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` | INDICATE |
| 웹 → micro 송신 | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` | WRITE / WRITE NO RESPONSE |

서비스 필터와 optionalServices를 지정하여 기기를 요청합니다. 수신 특성에 startNotifications()를 호출합니다. 이번 단계에서는 송신 특성을 사용하지 않습니다.

UTF-8 스트리밍 디코더로 바이트 분할을 처리하고 LF 또는 CRLF로 끝난 메시지를 표시합니다. 한 조각의 여러 줄과 조각 사이에 나뉜 CRLF도 처리합니다. 줄바꿈 없는 수신은 시간·바이트 수·문자열을 조각 로그에 남기지만 최신 완성 메시지에는 반영하지 않습니다. CR 단독은 구분자가 아닙니다. 완성되지 않은 버퍼는 연결 해제 시 폐기하며, 8,192자 초과 시에도 폐기합니다. 로그는 최근 300건만 메모리에 유지하고 새로고침하면 사라집니다.

## 실제 스마트폰 테스트 체크리스트 (미실행)

1. Android Bluetooth를 켜고, micro:bit 전원을 켭니다. 기존 MakeCode 펌웨어 및 No Pairing Required 설정을 유지합니다.
2. nRF Connect 등 다른 앱의 micro:bit 연결을 해제합니다.
3. Android Chrome에서 Pages HTTPS 주소를 열고 **Bluetooth 연결**을 누릅니다.
4. micro:bit를 선택하고 **연결 성공**을 확인합니다.
5. B 버튼을 누르고 큰 수신값에 `READ:240`, 로그에 수신 시각과 내용이 표시되는지 확인합니다.
6. B 버튼을 여러 번 눌러 수신 누락·중복·지연을 관찰합니다. 줄바꿈이 없다면 조각 로그를 확인합니다.
7. **연결 해제** 후 다시 연결하고 B 버튼 수신을 확인합니다.
8. 보드 전원을 껐다 켜서 연결 해제 표시, 재연결, 저장된 `READ:240` 수신을 확인합니다.
9. 선택 창 취소 및 브라우저 권한 거부 후 재시도가 가능한지 확인합니다. 화면 잠금·백그라운드 전환 후에도 상태와 재연결을 확인합니다.

## 제약 및 오류 진단

- Android Chrome과 HTTPS가 필요합니다. iOS Safari 등 Web Bluetooth 미지원 브라우저에서는 연결할 수 없습니다.
- 기기가 검색되지 않으면 서비스 UUID 광고 여부, 전원, 거리, 다른 앱의 점유 상태를 확인하세요. 서비스 필터와 맞는 기기만 표시합니다.
- 권한/보안 오류, 선택 취소, GATT 연결, 서비스 검색, 특성 검색, 알림 설정 오류를 구분해 표시합니다. Android 버전에 따라 Bluetooth/주변 기기 등의 OS 권한도 확인해야 합니다.
- 자동 재연결은 하지 않습니다. 사용자가 연결 버튼으로 다시 선택합니다. 재연결 시 최신 수신값과 미완성 버퍼를 초기화합니다. 해제 후 남아 있는 최신값은 이전 세션 값입니다.
- OS 절전, 화면 잠금, 전파 간섭에 따른 연결·수신 안정성은 실제 장비에서 검증해야 합니다. 앱은 통신 로그를 영구 저장하지 않습니다.
- 현재 검증은 로컬 정적 파일 응답과 모의 GATT 테스트에 한정됩니다. 실제 Android/micro:bit 통신 및 GitHub Pages 배포 성공은 확인되지 않았습니다.
