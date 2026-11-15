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
  const context = vm.createContext({ TextDecoder, TextEncoder, Date, window: { isSecureContext: true }, navigator: { bluetooth: {
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
