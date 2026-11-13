const API='https://script.google.com/macros/s/AKfycbwjlVQNW9-CGQ00ATwKA2agv3CqDJOTd8vGZLnCOkLdi9QXKLA4kqZ9X5i54f6r8gkg/exec';
const $=s=>document.querySelector(s),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>{const m=/(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(s||'');return m?`${+m[2]}/${+m[3]} ${m[4]}:${m[5]}`:E(s)};
const ls={g(k){try{return localStorage.getItem(k)||''}catch(e){return ''}},s(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const msg=(t,b)=>{$('#msg').textContent=t||'';$('#msg').style.color=b?'var(--ng)':''};
async function call(a,d){
 if(!/^https:\/\/script\.google\.com\/.+\/exec$/.test(API))throw new Error('common.js 冒頭の API に、Apps Script ウェブアプリのURL（/exec で終わるもの）を設定してください');
 let r;try{r=await fetch(API,{method:'POST',body:JSON.stringify({action:a,name:U.name,pin:U.pin,...d})})}
 catch(e){throw new Error('サーバーに接続できません（Apps Scriptの公開設定・URL・通信状況を確認してください）')}
 let j;try{j=await r.json()}catch(e){throw new Error('サーバーの応答が不正です（アクセス権が「全員」か、最新版を再デプロイしたか確認してください）')}
 if(j.error)throw new Error(j.error);return j}
let U={};
