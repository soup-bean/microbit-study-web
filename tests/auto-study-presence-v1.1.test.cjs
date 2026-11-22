'use strict';
// Exercise the actual firmware state function with mocked hardware.
// Not a MakeCode compilation or physical sensor test.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../firmware/auto-study-time-v1.1.ts'),'utf8');
const constants = source.slice(source.indexOf('const MIN_CM'),source.indexOf('const FIVE_AM_SECONDS'));
const logic = source.slice(source.indexOf('function updatePresence('),source.indexOf('function resetClockTracking()')).replace('nowEpoch: number','nowEpoch');
const make = new Function(constants + '\n' + `
let trackingUser=false, presence="WAIT", distanceMisses=0, pirZeros=0, previousEpoch=-1, pendingWaitStart=-1, distanceCm=-1, pirValue=0, connected=false, sending=false, bootMs=0, elapsed=100000;
let intervals=[];
const input={runningTime:()=>elapsed}, basic={showString:()=>{}}, bluetooth={uartWriteLine:()=>{}};
function creditInterval(a,b){if(b>a)intervals.push([a,b])}
function commitHistory(){}
` + logic + `
return {step(t,d,p){distanceCm=d;pirValue=p;updatePresence(t);return {state:presence,tracked:trackingUser,miss:distanceMisses,pending:pendingWaitStart,total:intervals.reduce((s,i)=>s+i[1]-i[0],0)}}};
`);
test('entry requires 10–60; 70 accepted only after entry',()=>{let m=make();assert.equal(m.step(100,70,1).state,'WAIT');assert.equal(m.step(103,60,1).state,'HERE');assert.equal(m.step(106,80,0).state,'HERE');assert.equal(m.step(109,81,0).miss,1);});
test('single miss retains state and recovery credits only once',()=>{let m=make();m.step(100,25,0);let x=m.step(103,-1,0);let y=m.step(106,25,0);let z=m.step(109,25,0);assert.equal(x.state,'HERE');assert.equal(x.pending,103);assert.equal(x.total,3);assert.equal(y.state,'STILL');assert.equal(y.total,6);assert.equal(z.total,9);});
test('second miss WAIT; fifth AWAY discards tentative seconds',()=>{let m=make();m.step(100,20,0);let a=m.step(103,90,0);let b=m.step(106,90,0);m.step(109,90,0);let c=m.step(112,90,0);let d=m.step(115,90,0);assert.equal(a.state,'HERE');assert.equal(b.state,'WAIT');assert.equal(c.state,'WAIT');assert.equal(d.state,'AWAY');assert.equal(d.total,3);assert.equal(d.pending,-1);assert.equal(d.tracked,false);assert.equal(m.step(118,70,1).total,3);});
test('WAIT recovery uses 80cm maintenance range',()=>{let m=make();m.step(100,25,1);m.step(103,-1,0);m.step(106,81,0);let x=m.step(109,75,0);assert.equal(x.state,'STILL');assert.equal(x.total,9);});
test('PIR movement resets zero streak',()=>{let m=make();m.step(100,25,1);m.step(103,-1,0);m.step(106,-1,0);m.step(109,-1,1);m.step(112,-1,0);let a=m.step(115,-1,0);let b=m.step(118,-1,0);assert.equal(a.state,'WAIT');assert.equal(b.state,'AWAY');assert.equal(b.total,3);});
test('initial WAIT is never credited',()=>{let m=make();m.step(100,90,1);m.step(103,90,1);assert.equal(m.step(106,20,1).total,0);assert.equal(m.step(109,20,1).total,3);});
test('clock jump drops pending time',()=>{let m=make();m.step(100,20,1);m.step(103,-1,0);m.step(200,-1,0);assert.equal(m.step(203,20,0).total,3);});
test('unresolved WAIT longer than 60 seconds is excluded',()=>{let m=make();m.step(100,20,1);for(let i=103;i<=166;i+=3)m.step(i,-1,1);assert.equal(m.step(169,20,1).total,3);});
