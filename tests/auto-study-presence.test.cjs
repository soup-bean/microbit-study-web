'use strict';
// Reference model for auto-study firmware accounting; not a hardware test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const BASE = Date.UTC(2020, 0, 1) / 1000;
const epoch = iso => Date.parse(iso + 'Z') / 1000 - BASE;
function studyDate(ep) {
  const d = new Date((ep + BASE) * 1000);
  if (d.getUTCHours() < 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function model(boot) {
  const m = { state:'WAIT', zero:0, far:0, prev:-1, pending:-1, totals:{} };
  function credit(a, b) {
    if (a < 0 || b <= a || b - a > 60) return;
    const boundary = Math.floor((b - 18000) / 86400) * 86400 + 18000;
    const endDay = studyDate(b);
    if (a < boundary && boundary <= b) {
      const before = studyDate(boundary - 1);
      m.totals[before] = (m.totals[before] || 0) + boundary - a;
      m.totals[endDay] = (m.totals[endDay] || 0) + b - boundary;
    } else {
      m.totals[endDay] = (m.totals[endDay] || 0) + b - a;
    }
  }
  m.step = (now, dist, pir) => {
    const near = dist >= 10 && dist <= 60;
    m.zero = pir === 0 ? Math.min(99, m.zero + 1) : 0;
    m.far = near ? 0 : Math.min(99, m.far + 1);
    const next = near ? (m.zero >= 3 ? 'STILL' : 'HERE')
      : (m.zero >= 3 && m.far >= 3 && now - boot >= 60 ? 'AWAY' : 'WAIT');
    const valid = m.prev >= 0 && now >= m.prev && now - m.prev <= 30;
    if (valid && (m.state === 'HERE' || m.state === 'STILL')) credit(m.prev, now);
    if (!valid) m.pending = -1;
    if ((m.state === 'HERE' || m.state === 'STILL') && next === 'WAIT') {
      m.pending = now;
    } else if (m.state === 'WAIT' && (next === 'HERE' || next === 'STILL')) {
      if (m.pending >= 0 && now >= m.pending && now - m.pending <= 60) credit(m.pending, now);
      m.pending = -1;
    } else if (next === 'AWAY') m.pending = -1;
    m.prev = now; m.state = next;
  };
  return m;
}
const t = epoch('2026-11-21T10:00:00');
test('three PIR zeros with a valid distance give STILL, not AWAY', () => {
  const m = model(t - 70);
  for (const [i,d,p] of [[0,15,1],[3,15,0],[6,15,0],[9,15,0]]) m.step(t+i,d,p);
  assert.equal(m.state,'STILL');
});
test('WAIT recovered into HERE includes six pending seconds', () => {
  const m = model(t - 70);
  for (const [i,d,p] of [[0,15,1],[3,15,1],[6,70,0],[9,70,0],[12,15,1],[15,15,1]]) m.step(t+i,d,p);
  assert.equal(m.totals[20261121],15);
});
test('WAIT becomes AWAY after three paired misses, and pending time is discarded', () => {
  const m = model(t - 70);
  for (const [i,d,p] of [[0,15,1],[3,15,1],[6,70,0],[9,70,0],[12,70,0]]) m.step(t+i,d,p);
  assert.equal(m.state,'AWAY');
  assert.equal(m.totals[20261121],6);
});
test('RTC time jump is not counted as elapsed study', () => {
  const m = model(t - 70);
  for (const [i,d,p] of [[0,15,1],[3,15,1],[6,15,1],[40,15,1]]) m.step(t+i,d,p);
  assert.equal(m.totals[20261121],6);
});
test('05:00 boundary allocates seconds to both study days', () => {
  const q = epoch('2026-11-16T04:59:54');
  const m = model(q - 70);
  for (const i of [0,3,6,9]) m.step(q+i,15,1);
  assert.equal(m.totals[20261115],6);
  assert.equal(m.totals[20261116],3);
});
