// Browser/GATT mocks validate application logic, not real radio compatibility.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(failureStage) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    removeEventListener(name) { delete this.listeners[name]; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    get firstElementChild() { return { remove: () => this.children.shift() }; }
  }
  const elements = {};
  const receive = new Element();
  receive.startNotifications = async () => { if (failureStage === 'notify') throw new Error('notify failed'); };
  const written = [];
  const send = new Element();
  send.properties = { write: true, writeWithoutResponse: true };
  send.writeValueWithResponse = async bytes => { written.push(new TextDecoder().decode(bytes)); };
  const device = new Element();
  device.name = 'micro:bit';
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this; },
    disconnect() { this.connected = false; device.listeners.gattserverdisconnected?.(); },
    async getPrimaryService(uuid) {
      assert.equal(uuid, '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
      return { async getCharacteristic(uuid) {
        if (uuid === '6e400002-b5a3-f393-e0a9-e50e24dcca9e') return receive;
        if (uuid === '6e400003-b5a3-f393-e0a9-e50e24dcca9e') return send;
        throw new Error('Unknown characteristic');
      } };
    }
  };
  const context = vm.createContext({ TextDecoder, TextEncoder, Date, window: { isSecureContext: true, confirm: () => true }, navigator: { bluetooth: {
    async requestDevice(options) {
      assert.equal(options.acceptAllDevices, true);
      assert.ok(options.optionalServices.includes('6e400001-b5a3-f393-e0a9-e50e24dcca9e'));
      if (failureStage === 'cancel') throw Object.assign(new Error('cancel'), { name: 'NotFoundError' });
      return device;
    }
  } }, document: {
    getElementById(id) { return elements[id] ||= new Element(); },
    createElement() { return new Element(); }, createTextNode(value) { return value; }
  } });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8'), context);
  const emit = bytes => receive.listeners.characteristicvaluechanged({ target: { value: new DataView(Uint8Array.from(bytes).buffer) } });
  return { elements, device, receive, emit, written };
}
test('split UTF-8, split CRLF, multiple lines, disconnect and reconnect', async () => {
  const { elements: el, emit, device, receive } = setup();
  await el.connect.listeners.click();
  assert.equal(el.status.textContent, '연결 성공');
  emit(Buffer.from('READ:2')); assert.equal(el.latest.textContent, '수신 대기');
  emit(Buffer.from('40\r')); emit(Buffer.from('\n'));
  assert.equal(el.latest.textContent, 'READ:240');
  const korean = Buffer.from('한글\n'); emit(korean.subarray(0, 1)); emit(korean.subarray(1));
  assert.equal(el.latest.textContent, '한글');
  emit(Buffer.from('SAVE:240\nREAD:240\n'));
  assert.equal(el.latest.textContent, 'READ:240');
  emit(Buffer.from('old partial'));
  device.gatt.disconnect(); assert.equal(el.status.textContent, '연결 해제');
  assert.equal(receive.listeners.characteristicvaluechanged, undefined);
  await el.connect.listeners.click(); emit(Buffer.from('READ:240\n'));
  assert.equal(el.latest.textContent, 'READ:240');
  el.disconnect.listeners.click(); assert.equal(device.gatt.connected, false);
  assert.equal(el.connect.disabled, false);
});
test('KST RTC write is exactly one short UART command and requires a device acknowledgement', async () => {
  const { elements: el, written, emit } = setup();
  assert.equal(el['sync-time'].disabled, true);
  await el.connect.listeners.click();
  assert.equal(el['sync-time'].disabled, false);
  await el['sync-time'].listeners.click();
  assert.equal(written.length, 1);
  assert.match(written[0], /^T:\d{15}\n$/);
  assert.equal(Buffer.byteLength(written[0]), 18);
  assert.match(el['sync-status'].textContent, /기다리는 중/);
  emit(Buffer.from('SYNC:OK\r\n'));
  assert.match(el['sync-status'].textContent, /확인 완료/);
  el.disconnect.listeners.click();
  assert.equal(el['sync-time'].disabled, true);
});

test('study records: full snapshot, no double counting, incomplete frame is rejected', async () => {
  const { elements: el, emit, written } = setup();
  await el.connect.listeners.click();
  await el['get-records'].listeners.click();
  assert.equal(written.at(-1), 'R\n');
  emit(Buffer.from('BEGIN:20261115\r\nREC:20261114:300\r\n'));
  emit(Buffer.from('REC:20261115:360\r\nEND:2\r\n'));
  assert.equal(el.days.children.length, 2);
  assert.match(el.days.children[0].textContent, /2026-11-15.*00h 06m 00s/);
  assert.match(el.days.children[1].textContent, /2026-11-14.*00h 05m 00s/);
  // Same cumulative snapshot is a replacement, never a second addition.
  emit(Buffer.from('BEGIN:20261115\nREC:20261115:360\nREC:20261114:300\nEND:2\n'));
  assert.equal(el.days.children.length, 2);
  assert.match(el.days.children[0].textContent, /00h 06m 00s/);
  // Partial snapshot must not replace last complete records.
  emit(Buffer.from('BEGIN:20261115\nREC:20261115:600\nEND:2\n'));
  assert.match(el['records-status'].textContent, /수신 불완전/);
  assert.match(el.days.children[0].textContent, /00h 06m 00s/);
});

test('5am boundary test button writes X and receives the ACK', async () => {
  const { elements: el, emit, written } = setup();
  await el.connect.listeners.click();
  assert.equal(el['boundary-test'].disabled, false);
  await el['boundary-test'].listeners.click();
  assert.equal(written.at(-1), 'X\n');
  emit(Buffer.from('TEST:OK\r\n'));
  assert.match(el['boundary-status'].textContent, /04:59:30/);
  emit(Buffer.from('SYNC:OK\r\n'));
  assert.match(el['boundary-status'].textContent, /한국 시간/);
});

test('cancel and notification failures allow retry and close GATT', async () => {
  for (const stage of ['cancel', 'notify']) {
    const { elements: el, device } = setup(stage);
    await el.connect.listeners.click();
    assert.equal(el.status.textContent, '연결 실패');
    assert.equal(el.connect.disabled, false);
    assert.equal(device.gatt.connected, false);
  }
});
test('log and unfinished message buffer are bounded', async () => {
  const { elements: el, emit } = setup();
  await el.connect.listeners.click();
  emit(Buffer.from('x'.repeat(8200)));
  emit(Buffer.from('READ:240\n'));
  assert.equal(el.latest.textContent, 'READ:240');
  for (let i = 0; i < 320; i++) emit(Buffer.from('READ:240\n'));
  assert.equal(el.log.children.length, 300);
});
