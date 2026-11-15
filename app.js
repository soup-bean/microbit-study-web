'use strict';

// Verified device directions: micro:bit -> web is ...0002 (INDICATE).
const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RECEIVE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const SEND = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const ui = Object.fromEntries(['connect', 'disconnect', 'status', 'detail', 'latest', 'received-at', 'log', 'clear', 'sync-time', 'sync-status'].map(id => [id, document.getElementById(id)]));
let device = null;
let receiver = null;
let sender = null;
let syncing = false;
let syncAckReceived = false;
let connecting = false;
let ready = false;
let decoder = new TextDecoder('utf-8');
let pending = '';
let pendingCR = false;
const MAX_BUFFER = 8192;

function log(kind, message) {
  const item = document.createElement('li');
  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  item.append(time, document.createTextNode(` [${kind}] ${message}`));
  ui.log.append(item);
  while (ui.log.children.length > 300) ui.log.firstElementChild.remove();
  ui.log.scrollTop = ui.log.scrollHeight;
}
function state(value, label, detail) {
  ui.status.dataset.state = value;
  ui.status.textContent = label;
  ui.detail.textContent = detail;
  ui.connect.disabled = connecting || ready || !supported;
  ui.disconnect.disabled = !ready;
  ui['sync-time'].disabled = !ready || !sender || syncing;
}
function resetStream() {
  decoder = new TextDecoder('utf-8');
  pending = '';
  pendingCR = false;
}
function cleanup() {
  if (receiver) receiver.removeEventListener('characteristicvaluechanged', receive);
  if (device) device.removeEventListener('gattserverdisconnected', disconnected);
  receiver = null;
  sender = null;
  syncing = false;
  syncAckReceived = false;
  device = null;
  ready = false;
  resetStream();
  ui['sync-status'].textContent = '연결 후 동기화할 수 있습니다.';
}
function disconnected() {
  if (pending || pendingCR) log('미완성', '연결 해제로 줄바꿈 없는 수신 버퍼를 폐기했습니다.');
  cleanup();
  state('disconnected', '연결 해제', '연결이 끊어졌습니다. Bluetooth 연결 버튼으로 다시 연결하세요.');
  log('연결', '기기 연결이 해제되었습니다.');
}
function receive(event) {
  const value = event.target.value;
  const chunk = decoder.decode(value, { stream: true });
  log('조각', `${value.byteLength} bytes ${JSON.stringify(chunk)}`);
  // Keep CR across chunks so CRLF split between notifications is handled once.
  for (const char of chunk) {
    if (char === '\n') {
      const message = pending;
      pending = '';
      pendingCR = false;
      if (message) {
        ui.latest.textContent = message;
        ui['received-at'].textContent = `마지막 수신: ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
        log('수신', message);
        if (message === 'SYNC:OK') {
          syncAckReceived = true;
          ui['sync-status'].textContent = 'RTC 동기화 확인 완료 — 마이크로비트가 적용을 확인했습니다.';
        } else if (message === 'SYNC:ERR') {
          syncAckReceived = true;
          ui['sync-status'].textContent = 'RTC 동기화 실패 — 마이크로비트가 명령을 거부했습니다.';
        }
      }
      continue;
    }
    if (pendingCR) pending += '\r';
    pendingCR = char === '\r';
    if (!pendingCR) pending += char;
    if (pending.length > MAX_BUFFER) {
      resetStream();
      log('오류', '줄바꿈 없는 메시지가 8,192자를 초과하여 버퍼를 폐기했습니다.');
      break;
    }
  }
}
function errorMessage(error, stage) {
  if (error.name === 'NotFoundError' && stage === '기기 선택') return '기기 검색이 취소되었거나 일치하는 기기를 선택하지 않았습니다.';
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Bluetooth 권한이 거부되었거나 보안 정책에 의해 차단되었습니다. 사이트 권한과 HTTPS 접속을 확인하세요.';
  return `${stage} 실패: ${error.name || 'Error'} — ${error.message || '알 수 없는 오류'}`;
}
// One UART write fits the default 20-byte BLE payload limit (18 ASCII bytes).
// T:YYYYMMDDHHMMSSW\n  where W = 1(Sun)..7(Sat), using Korea Standard Time.
function kstTimeCommand(now) {
  const seoul = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = seoul.getUTCFullYear();
  if (year < 2020 || year > 2099) throw new Error('RTC가 지원하는 날짜 범위를 벗어났습니다.');
  const pad = n => String(n).padStart(2, '0');
  return 'T:' + year + pad(seoul.getUTCMonth() + 1) + pad(seoul.getUTCDate()) +
    pad(seoul.getUTCHours()) + pad(seoul.getUTCMinutes()) + pad(seoul.getUTCSeconds()) +
    (seoul.getUTCDay() + 1) + '\n';
}

async function syncRtc() {
  if (!ready || !sender || syncing || !device?.gatt.connected) return;
  syncing = true;
  syncAckReceived = false;
  state('connected', '연결 성공', ui.detail.textContent);
  ui['sync-status'].textContent = '휴대폰의 한국 표준시를 전송하고 있습니다…';
  try {
    // Sample the time immediately before writing; do not sync silently on connect.
    const command = kstTimeCommand(new Date());
    const bytes = new TextEncoder().encode(command);
    if (sender.properties.write) {
      await sender.writeValueWithResponse(bytes);
    } else if (sender.properties.writeWithoutResponse) {
      await sender.writeValueWithoutResponse(bytes);
    } else {
      throw new Error('쓰기 가능한 UART 특성이 아닙니다.');
    }
    log('송신', command.trim());
    if (!syncAckReceived) ui['sync-status'].textContent = '전송 완료 · 마이크로비트의 SYNC:OK 응답을 기다리는 중입니다.';
  } catch (error) {
    const detail = '시간 전송 실패: ' + (error.message || String(error));
    ui['sync-status'].textContent = detail;
    log('오류', detail);
  } finally {
    syncing = false;
    if (ready) state('connected', '연결 성공', ui.detail.textContent);
  }
}

async function connect() {
  if (connecting || ready || !supported) return;
  connecting = true;
  resetStream();
  ui.latest.textContent = '수신 대기';
  ui['received-at'].textContent = '완성된 줄을 기다리는 중입니다.';
  state('connecting', '연결 중', '기기를 선택한 후 연결이 완료될 때까지 기다려 주세요.');
  let stage = '기기 선택';
  let selected = null;
  try {
    selected = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE]
    });
    device = selected;
    device.addEventListener('gattserverdisconnected', disconnected);
    stage = 'GATT 연결';
    const server = await device.gatt.connect();
    stage = 'UART 서비스 검색';
    const service = await server.getPrimaryService(SERVICE);
    stage = '수신 특성 검색';
    receiver = await service.getCharacteristic(RECEIVE);
    receiver.addEventListener('characteristicvaluechanged', receive);
    stage = '알림 수신 설정';
    await receiver.startNotifications();
    stage = 'UART 송신 특성 검색';
    sender = await service.getCharacteristic(SEND);
    if (!selected.gatt.connected || device !== selected) throw new Error('설정 중 연결이 해제되었습니다.');
    ready = true;
    connecting = false;
    state('connected', '연결 성공', `${selected.name || 'micro:bit'} 연결 완료. B 버튼을 눌러 READ:240을 확인하세요.`);
    log('연결', 'UART INDICATE 수신 및 WRITE 송신 준비 완료');
    ui['sync-status'].textContent = '연결됨 · 버튼을 누르면 휴대폰의 한국 시각을 RTC에 보냅니다.';
  } catch (error) {
    cleanup();
    if (selected?.gatt.connected) selected.gatt.disconnect();
    connecting = false;
    const message = errorMessage(error, stage);
    state('failed', '연결 실패', message);
    log('오류', message);
  }
}
const supported = window.isSecureContext && 'bluetooth' in navigator;
ui.connect.addEventListener('click', connect);
ui.disconnect.addEventListener('click', () => {
  const current = device;
  disconnected();
  if (current?.gatt.connected) current.gatt.disconnect();
});
ui.clear.addEventListener('click', () => ui.log.replaceChildren());
ui['sync-time'].addEventListener('click', syncRtc);
if (!supported) {
  state('failed', '사용 불가', !window.isSecureContext ? 'HTTPS 또는 localhost에서 접속해야 합니다.' : 'Web Bluetooth 미지원 브라우저입니다. Android Chrome에서 열어 주세요.');
}
