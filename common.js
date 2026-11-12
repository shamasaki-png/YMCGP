const API='https://script.google.com/macros/s/AKfycbzQssMTsnmuNxKIdC53tA17YfQCaW30RJSyAw6pID7Um1KNalaFpSIaRKhAKdrsss0N3A/exec';
const $=s=>document.querySelector(s),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>{const m=/(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(s||'');return m?`${+m[2]}/${+m[3]} ${m[4]}:${m[5]}`:E(s)};
const ls={g(k){try{return localStorage.getItem(k)||''}catch(e){return ''}},s(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const msg=(t,b)=>{$('#msg').textContent=t||'';$('#msg').style.color=b?'var(--ng)':''};
async function call(a,d){const r=await fetch(API,{method:'POST',body:JSON.stringify({action:a,name:U.name,pin:U.pin,...d})});const j=await r.json();if(j.error)throw new Error(j.error);return j}
let U={};
