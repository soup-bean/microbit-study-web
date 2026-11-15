// Reference checks for the same date arithmetic used in MakeCode firmware.
// These tests exercise a JS model, not the compiled micro:bit firmware.
const { test } = require('node:test');
const assert = require('node:assert/strict');
function leap(y) { return y % 4 === 0 && y % 100 !== 0 || y % 400 === 0; }
function dim(y, m) { return m === 2 ? (leap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31; }
function serial(y, m, d) {
  let n = 0;
  for (let yy = 2020; yy < y; yy++) n += leap(yy) ? 366 : 365;
  for (let mm = 1; mm < m; mm++) n += dim(y, mm);
  return n + d - 1;
}
function studyDay(y, m, d, h) {
  if (h < 5) {
    d--;
    if (d === 0) {
      m--;
      if (m === 0) { y--; m = 12; }
      d = dim(y, m);
    }
  }
  return y * 10000 + m * 100 + d;
}
function slot(day) { return serial(Math.floor(day / 10000), Math.floor(day % 10000 / 100), day % 100) % 7; }

test('study date changes at 05:00, not midnight', () => {
  assert.equal(studyDay(2026, 11, 16, 0), 20261115);
  assert.equal(studyDay(2026, 11, 16, 4), 20261115);
  assert.equal(studyDay(2026, 11, 16, 5), 20261116);
});
test('month end, leap day and new year', () => {
  assert.equal(studyDay(2026, 3, 1, 4), 20260228);
  assert.equal(studyDay(2024, 3, 1, 4), 20240229);
  assert.equal(studyDay(2027, 1, 1, 4), 20261231);
  assert.equal(studyDay(2024, 3, 1, 5), 20240301);
});
test('7 adjacent dates use distinct slots even through months', () => {
  const slots = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(Date.UTC(2026, 10, 29 + i));
    const dateKey = x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
    slots.push(slot(dateKey));
  }
  assert.equal(new Set(slots).size, 7);
});
