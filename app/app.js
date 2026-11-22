'use strict';

// micro:bit MakeCode UART protocol, compatible with auto-study-time-v1.4.1.ts.
// One completed BEGIN/REC/END transfer is an authoritative snapshot, not a delta.
// The firmware sends STATE only when the state changes, not every second.
const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RECEIVE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const SEND = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const STORAGE_KEY = 'smart-study-records-v1';
const MAX_BUFFER = 8192;
const el = Object.fromEntries([
  'connection-badge','connection-label','connect','disconnect','refresh',
  'connection-detail','today-total','today-caption','presence-surface',
  'state-symbol','presence-label','presence-detail','state-recency',
  'week-chart','week-total','day-list','record-status','export',
  'sync-time','sync-status','latest','log','clear-log','boundary-test','boundary-status'
].map(id => [id, document.getElementById(id)]));

let device = null;
let receiver = null;
let sender = null;
let connecting = false;
let ready = false;
let syncing = false;
let activePresence = 'UNKNOWN';
let lastPresenceAt = 0;
let incoming = null;
let clockDate = '';
let clockTime = '';
let decoder = new TextDecoder();
let buffer = '';
let pendingCR = false;
let archive = new Map();
let lastReceivedAt = 0;
let recordAnchor = '';
const supported = window.isSecureContext && !!navigator.bluetooth;

const PRESENCE = {
  HERE: ['H','자리에서 공부 중','거리 센서에서 사용자를 감지했어요.'],
  STILL: ['S','움직임 적음 · 공부 중','움직임이 적어도 공부 시간은 누적돼요.'],
  WAIT: ['·','잠시 확인 중','감지 신호를 확인하는 중이에요.'],
  AWAY: ['—','자리 비움','자리 비움으로 판단되어 누적이 중단됐어요.'],
  UNKNOWN: ['—','상태 확인 전','상태 변경 신호를 기다리는 중이에요.']
};
const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  hour:'2-digit',minute:'2-digit',hour12:false
});

function validDayKey(key) {
  if (!/^20\d{6}$/.test(key)) return false;
  const y = Number(key.slice(0,4)), m = Number(key.slice(4,6)), d = Number(key.slice(6,8));
  const date = new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 &&
    date.getUTCDate() === d;
}
function studyDayKst(date) {
  // KST begins at UTC+9; the study date rolls at local 05:00.
  const shifted = new Date(date.getTime() + (9-5)*3600000);
  return String(shifted.getUTCFullYear()) +
    String(shifted.getUTCMonth()+1).padStart(2,'0') +
    String(shifted.getUTCDate()).padStart(2,'0');
}
function dayBefore(key, count) {
  if (!validDayKey(key)) return '';
  const date = new Date(Date.UTC(
    Number(key.slice(0,4)),Number(key.slice(4,6))-1,Number(key.slice(6,8)) - count
  ));
  return String(date.getUTCFullYear()) + String(date.getUTCMonth()+1).padStart(2,'0') +
    String(date.getUTCDate()).padStart(2,'0');
}
function formatHms(value) {
  const seconds = Math.max(0,Math.min(86400,Math.floor(Number(value)||0)));
  return String(Math.floor(seconds/3600)).padStart(2,'0') + ':' +
    String(Math.floor(seconds%3600/60)).padStart(2,'0') + ':' +
    String(seconds%60).padStart(2,'0');
}
function shortDay(key) {
  const date = new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(4,6))-1,Number(key.slice(6,8))));
  const weekdays = ['일','월','화','수','목','금','토'];
  return Number(key.slice(4,6)) + '/' + Number(key.slice(6,8)) + ' (' + weekdays[date.getUTCDay()] + ')';
}
function loadArchive() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if (!saved || saved.v !== 1 || !saved.records || typeof saved.records !== 'object') return;
    for (const [key,value] of Object.entries(saved.records)) {
      if (validDayKey(key) && Number.isInteger(value) && value >= 0 && value <= 86400)
        archive.set(key,value);
    }
    if (Number.isFinite(saved.updatedAt) && saved.updatedAt > 0) lastReceivedAt = saved.updatedAt;
    if (validDayKey(saved.anchor)) recordAnchor = saved.anchor;
  } catch (_) {
    // Browser storage can be unavailable in private mode. BLE still works.
  }
}
function persist() {
  try {
    const records = Object.fromEntries([...archive].slice(-500));
    localStorage.setItem(STORAGE_KEY,JSON.stringify({
      v:1,records,updatedAt:lastReceivedAt,anchor:recordAnchor
    }));
  } catch (_) { addLog('안내','브라우저 저장 공간에 기록을 보관하지 못했어요. CSV로 저장해 주세요.'); }
}
function dateStamp(timestamp) {
  return new Date(timestamp).toLocaleString('ko-KR',{hour12:false,
    timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function renderArchive() {
  const today = studyDayKst(new Date());
  const keys = Array.from({length:7},(_,i)=>dayBefore(today,6-i));
  const values = keys.map(key=>archive.get(key)||0);
  const maximum = Math.max(...values,1);
  const total = values.reduce((sum,value)=>sum+value,0);
  const seconds = archive.get(today);
  el['today-total'].textContent = seconds === undefined ? '--:--:--' : formatHms(seconds);
  el['today-caption'].textContent = lastReceivedAt ?
    '마지막 기록 가져오기 · ' + dateStamp(lastReceivedAt) :
    '아직 가져온 공부 기록이 없어요.';
  el['week-total'].textContent = '합계 ' + Math.floor(total/3600) + '시간 ' +
    Math.floor(total%3600/60) + '분';
  el['week-chart'].replaceChildren();
  el['day-list'].replaceChildren();
  keys.forEach((key,i)=>{
    const col = document.createElement('div');
    col.className = 'bar-column' + (key===today?' is-today':'');
    const label = document.createElement('span');
    label.className = 'bar-value';
    label.textContent = values[i] ? (values[i]/3600).toFixed(1).replace(/\.0$/,'')+'h' : '0';
    const track = document.createElement('div');track.className='bar-track';
    const bar = document.createElement('div');bar.className='bar-fill';
    bar.style.setProperty('--fill',(values[i]/maximum*100)+'%');
    track.append(bar);
    const day = document.createElement('span');day.className='bar-day';
    day.textContent = key.slice(6)+'일';
    col.append(label,track,day);
    col.setAttribute('aria-label',shortDay(key)+' '+formatHms(values[i]));
    el['week-chart'].append(col);

    const li = document.createElement('li');
    if (key===today) li.className='is-today';
    const dateEl = document.createElement('time');
    dateEl.dateTime = key.slice(0,4)+'-'+key.slice(4,6)+'-'+key.slice(6,8);
    dateEl.textContent = shortDay(key)+(key===today?' · 오늘':'');
    const valueEl = document.createElement('strong');valueEl.textContent=formatHms(values[i]);
    li.append(dateEl,valueEl);
    el['day-list'].prepend(li);
  });
  el.export.disabled = archive.size===0;
}
function setPresence(value) {
  activePresence = Object.hasOwn(PRESENCE,value)?value:'UNKNOWN';
  lastPresenceAt = activePresence==='UNKNOWN'?0:Date.now();
  const info=PRESENCE[activePresence];
  el['presence-surface'].dataset.presence=activePresence;
  el['state-symbol'].textContent=info[0];
  el['presence-label'].textContent=info[1];
  el['presence-detail'].textContent=info[2];
  el['state-recency'].textContent=lastPresenceAt?timeFormatter.format(new Date(lastPresenceAt)):'—';
}
function addLog(kind,message) {
  const item=document.createElement('li');
  item.textContent=new Date().toLocaleTimeString('ko-KR',{hour12:false})+' ['+kind+'] '+message;
  el.log.append(item);
  while(el.log.children.length>200)el.log.firstElementChild.remove();
  el.log.scrollTop=el.log.scrollHeight;
}
function setConnection(status,label,message) {
  el['connection-badge'].dataset.connection=status;
  el['connection-label'].textContent=label;
  el['connection-detail'].textContent=message;
  el.connect.disabled=connecting||ready||!supported;
  el.disconnect.disabled=!ready;
  el.refresh.disabled=!ready||!sender;
  el['sync-time'].disabled=!ready||!sender||syncing;
  el['boundary-test'].disabled=!ready||!sender;
}
function resetStream() {decoder=new TextDecoder();buffer='';pendingCR=false;}
function cleanup() {
  if(receiver) receiver.removeEventListener('characteristicvaluechanged',receive);
  if(device) device.removeEventListener('gattserverdisconnected',disconnected);
  receiver=null;sender=null;device=null;ready=false;connecting=false;syncing=false;
  incoming=null;resetStream();setPresence('UNKNOWN');
}
function disconnected() {
  cleanup();
  setConnection('disconnected','연결 끊김','Bluetooth 연결이 끊겼어요. 기록은 브라우저에 남아 있어요.');
  addLog('연결','독서대 연결이 해제됐어요.');
}
function handleLine(line) {
  el.latest.textContent=line;
  addLog('수신',line);
  const state=/^STATE:(HERE|STILL|WAIT|AWAY)$/.exec(line);
  if(state) {setPresence(state[1]);return;}
  if(line==='SYNC:OK') {
    el['sync-status'].textContent='RTC 동기화 완료 · 독서대가 적용을 확인했어요.';
    el['boundary-status'].textContent='실제 한국 시각으로 동기화했어요.';
    return;
  }
  if(line==='SYNC:ERR') {
    el['sync-status'].textContent='동기화 실패 · 독서대 RTC 상태를 확인해 주세요.';
    return;
  }
  if(line==='TEST:OK') {
    el['boundary-status'].textContent='시험용 04:59:30 적용됨 · 완료 후 RTC를 다시 동기화하세요.';
    return;
  }
  if(line==='TEST:ERR') {
    el['boundary-status'].textContent='경계 시험 적용 실패';
    return;
  }
  if(line==='ERR:RTC'||line==='ERR:STORE') {
    el['record-status'].textContent=line==='ERR:RTC'?
      '독서대 RTC 날짜를 읽지 못했어요. 시간 동기화를 확인해 주세요.':
      '기기 저장 오류가 발생했어요. 기록과 저장 상태를 확인해 주세요.';
    return;
  }
  const begin=/^BEGIN:(\d{8})$/.exec(line);
  if(begin) {
    if(!validDayKey(begin[1])){addLog('오류','잘못된 학습일');return;}
    incoming={anchor:begin[1],records:new Map()};
    el['record-status'].textContent='공부 기록을 받는 중이에요…';
    return;
  }
  const rec=/^REC:(\d{8}):(\d{1,5})$/.exec(line);
  if(rec && incoming) {
    const seconds=Number(rec[2]);
    const age=(Date.parse(incoming.anchor.slice(0,4)+'-'+incoming.anchor.slice(4,6)+'-'+incoming.anchor.slice(6,8)+'T00:00:00Z') -
      Date.parse(rec[1].slice(0,4)+'-'+rec[1].slice(4,6)+'-'+rec[1].slice(6,8)+'T00:00:00Z'))/86400000;
    if(validDayKey(rec[1])&&Number.isInteger(seconds)&&seconds>=0&&seconds<=86400&&age>=0&&age<7)
      incoming.records.set(rec[1],seconds);
    else addLog('오류','범위 밖 기록 무시: '+line);
    return;
  }
  const end=/^END:(\d+)$/.exec(line);
  if(end && incoming) {
    const snapshot=incoming;incoming=null;
    if(snapshot.records.size!==Number(end[1])){
      el['record-status'].textContent='기록이 일부 누락됐어요. 다시 가져와 주세요.';
      addLog('오류','불완전한 기록 스냅샷');
      return;
    }
    // Merge complete snapshots into this browser's historical archive.
    // Repeated snapshots replace their dates; they are never added as deltas.
    for(const [key,value] of snapshot.records) archive.set(key,value);
    archive=new Map([...archive].sort((a,b)=>a[0].localeCompare(b[0])).slice(-500));
    recordAnchor=snapshot.anchor;
    lastReceivedAt=Date.now();
    persist();
    renderArchive();
    el['record-status'].textContent='최근 '+snapshot.records.size+
      '개 날짜 동기화 완료 · '+dateStamp(lastReceivedAt);
    return;
  }
  if(/^DATE:/.test(line)) clockDate=line.slice(5);
  else if(/^TIME:/.test(line)) clockTime=line.slice(5);
}
function receive(event) {
  const chunk=decoder.decode(event.target.value,{stream:true});
  for(const char of chunk) {
    if(char==='\n'){
      const line=buffer;buffer='';pendingCR=false;
      if(line)handleLine(line);
      continue;
    }
    if(pendingCR)buffer+='\r';
    pendingCR=char==='\r';
    if(!pendingCR)buffer+=char;
    if(buffer.length>MAX_BUFFER) {
      resetStream();
      addLog('오류','수신 버퍼가 너무 길어 초기화했어요.');
      break;
    }
  }
}
async function sendCommand(text) {
  if(!sender||!device?.gatt.connected)throw new Error('Bluetooth 연결이 필요해요.');
  const bytes=new TextEncoder().encode(text);
  if(bytes.byteLength>20)throw new Error('UART 전송 크기 초과');
  if(sender.properties.write)await sender.writeValueWithResponse(bytes);
  else if(sender.properties.writeWithoutResponse)await sender.writeValueWithoutResponse(bytes);
  else throw new Error('UART 쓰기 불가');
}
async function refreshRecords() {
  if(!ready)return;
  try {
    await sendCommand('R\n');
    el['record-status'].textContent='기록 요청 완료 · 응답을 기다리는 중이에요.';
    addLog('송신','R');
  } catch(e) {
    el['record-status'].textContent='기록 요청 실패: '+e.message;
    addLog('오류',e.message);
  }
}
function timeCommand(now) {
  const kst=new Date(now.getTime()+9*3600000);
  const pad=n=>String(n).padStart(2,'0');
  return 'T:'+kst.getUTCFullYear()+pad(kst.getUTCMonth()+1)+pad(kst.getUTCDate())+
    pad(kst.getUTCHours())+pad(kst.getUTCMinutes())+pad(kst.getUTCSeconds())+
    (kst.getUTCDay()+1)+'\n';
}
async function syncRtc() {
  if(!ready||syncing)return;
  syncing=true;
  setConnection('connected','연결됨',el['connection-detail'].textContent);
  el['sync-status'].textContent='휴대폰 시각을 보내는 중이에요…';
  try{
    const command=timeCommand(new Date());
    await sendCommand(command);
    addLog('송신',command.trim());
    // The device must explicitly reply SYNC:OK before displaying success.
    if(!/동기화 완료/.test(el['sync-status'].textContent))
      el['sync-status'].textContent='전송 완료 · SYNC:OK 응답 대기 중';
  } catch(e) {
    el['sync-status'].textContent='시간 동기화 실패: '+e.message;
  } finally {
    syncing=false;
    if(ready)setConnection('connected','연결됨',el['connection-detail'].textContent);
  }
}
async function boundaryTest() {
  if(!ready)return;
  if(!window.confirm('RTC 시간을 04:59:30으로 변경합니다. 실제 공부 기록에 영향을 줄 수 있어요. 시험 후 시간 동기화를 반드시 실행하시겠어요?'))return;
  try{await sendCommand('X\n');addLog('송신','X');el['boundary-status'].textContent='시험 명령 전송 · 응답 대기 중';}
  catch(e){el['boundary-status'].textContent='시험 명령 전송 실패: '+e.message;}
}
async function connect() {
  if(connecting||ready||!supported)return;
  connecting=true;resetStream();
  setConnection('connecting','연결 중','Bluetooth 기기 선택 창에서 micro:bit를 선택해 주세요.');
  let selected=null;let stage='기기 선택';
  try {
    selected=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[SERVICE]});
    device=selected;
    device.addEventListener('gattserverdisconnected',disconnected);
    stage='GATT 연결';
    const server=await device.gatt.connect();
    stage='UART 서비스 검색';
    const service=await server.getPrimaryService(SERVICE);
    stage='알림 설정';
    receiver=await service.getCharacteristic(RECEIVE);
    receiver.addEventListener('characteristicvaluechanged',receive);
    await receiver.startNotifications();
    stage='송신 채널 검색';
    sender=await service.getCharacteristic(SEND);
    if(!device.gatt.connected)throw new Error('연결이 해제됐어요.');
    connecting=false;ready=true;
    setConnection('connected','연결됨',(selected.name||'micro:bit')+' 연결됨 · 기록을 불러오는 중이에요.');
    el['sync-status'].textContent='필요하면 RTC 시간을 동기화해 주세요.';
    addLog('연결','Bluetooth UART 준비 완료');
    // Only one automatic snapshot per user-initiated connection.
    await refreshRecords();
  }catch(e){
    const name=e.name||'Error';
    if(selected?.gatt.connected)selected.gatt.disconnect();
    cleanup();
    const message=stage+' 실패: '+(name==='NotFoundError'?'기기 선택이 취소됐어요.':e.message||name);
    setConnection('failed','연결 실패',message);
    addLog('오류',message);
  }
}
function disconnect() {
  const current=device;
  disconnected();
  if(current?.gatt.connected)current.gatt.disconnect();
}
function exportCsv() {
  if(archive.size===0)return;
  const rows=['study_date,seconds,hh_mm_ss'];
  for(const [key,seconds] of [...archive].sort((a,b)=>a[0].localeCompare(b[0])))
    rows.push(key.slice(0,4)+'-'+key.slice(4,6)+'-'+key.slice(6,8)+','+seconds+','+formatHms(seconds));
  const blob=new Blob(['\uFEFF'+rows.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='smart-study-history.csv';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
el.connect.addEventListener('click',connect);
el.disconnect.addEventListener('click',disconnect);
el.refresh.addEventListener('click',refreshRecords);
el['sync-time'].addEventListener('click',syncRtc);
el['boundary-test'].addEventListener('click',boundaryTest);
el.export.addEventListener('click',exportCsv);
el['clear-log'].addEventListener('click',()=>el.log.replaceChildren());
loadArchive();renderArchive();setPresence('UNKNOWN');
setConnection(supported?'idle':'failed',supported?'연결 전':'미지원',
  !window.isSecureContext?'HTTPS에서 접속해야 Bluetooth를 사용할 수 있어요.':
  supported?'안드로이드 Chrome에서 연결할 수 있어요.':'이 브라우저는 Web Bluetooth를 지원하지 않아요. 안드로이드 Chrome에서 열어 주세요.');
if('serviceWorker' in navigator) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
