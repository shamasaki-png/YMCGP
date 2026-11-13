// アルコールチェック記録簿 バックエンド（Googleスプレッドシートに紐づくApps Script）
// 「拡張機能 > Apps Script」に貼り付け → FOLDER_ID を設定 → ウェブアプリとしてデプロイ
const FOLDER_ID = '1q6zX6-2CknEgJnuBb265kwj26zGofa9d';
const TZ = 'Asia/Tokyo';
// 「記録」シートの列: A ID,B 登録日時,C 運転者名,D 車両,E 運転前後,F 確認日時,G 確認方法,H その他,I 検知結果,J 酒気帯び,K 指示事項,
// L 確認者(管理者名),M 写真ID,N 管理者確認,O 管理者名,P 確認日時,Q コメント,R 取消申請,S 申請理由,T 申請日時,U 回答コメント

const sh = n => SpreadsheetApp.getActive().getSheetByName(n);
const col = n => sh(n).getDataRange().getValues().slice(1);
const str = v => v instanceof Date ? Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm") : String(v == null ? '' : v);
const now = () => Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm");
const users = () => col('従業員').filter(r => r[0]).map(r => ({ name: str(r[0]), pin: str(r[1]).trim(), admin: str(r[2]).trim() == '管理者' }));
const lk = f => { const l = LockService.getScriptLock(); l.waitLock(20000); try { return f(); } finally { l.releaseLock(); } };

function auth(q) {
  const u = users().find(x => x.name == q.name && x.pin && x.pin == String(q.pin).trim());
  if (!u) throw new Error('氏名またはPINが違います');
  return u;
}

// 動作確認用：ウェブアプリのURLをブラウザで開いて「OK」と出れば公開できている
function doGet() { return ContentService.createTextOutput('OK'); }

function doPost(e) {
  let r;
  try {
    const q = JSON.parse(e.postData.contents);
    if (q.action == 'names') {
      r = { names: users().map(u => u.name), vehicles: col('車両').map(x => str(x[0])).filter(String) };
    } else if (q.action == 'register') {
      r = register(q);
    } else {
      const u = auth(q);
      r = ({ login: () => ({ admin: u.admin }), list, add, update, remove, reqcancel, review, decide, photo, addveh })[q.action](q, u);
    }
  } catch (err) { r = { error: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

// 運転者の自己登録（誰でも可）。権限は必ず「従業員」。管理者はシート上で手動指定する
function register(q) {
  const n = str(q.rname).trim().replace(/\s+/g, ' '), p = str(q.rpin).trim();
  if (!n || n.length > 30) throw new Error('運転者名を入力してください（30文字以内）');
  if (!/^\d{4,6}$/.test(p)) throw new Error('PINは数字4〜6桁で入力してください');
  return lk(() => {
    if (users().some(u => u.name == n)) throw new Error('この名前は登録済みです。一覧から選んでログインしてください');
    const s = sh('従業員'), r = s.getLastRow() + 1;
    s.getRange(r, 1, 1, 3).setNumberFormat('@').setValues([[n, p, '従業員']]);
    return { ok: 1 };
  });
}

// 車両の登録（ログイン済みなら誰でも可）
function addveh(q, u) {
  const n = str(q.vname).trim().replace(/\s+/g, ' ');
  if (!n || n.length > 30) throw new Error('車両名を入力してください（30文字以内）');
  return lk(() => {
    if (col('車両').some(x => str(x[0]) == n)) throw new Error('この車両は登録済みです。一覧から選んでください');
    const s = sh('車両'); s.getRange(s.getLastRow() + 1, 1).setNumberFormat('@').setValue(n);
    return { ok: 1 };
  });
}

// 運転者は自分の記録のみ（mine指定時は管理者も自分のみ）、管理者は全件
function list(q, u) {
  const m = q.month || '';
  return { rows: col('記録').filter(r => r[0] && str(r[5]).startsWith(m) && ((u.admin && !q.mine) || r[2] == u.name))
    .map(r => ({ id: r[0], drv: r[2], veh: r[3], ty: r[4], at: str(r[5]), me: r[6], mo: r[7], val: r[8], alc: r[9], note: r[10],
      cf: r[11], ph: r[12] ? 1 : 0, rv: r[13], rb: r[14], rt: str(r[15]), rc: r[16], rq: r[17], rr: r[18], rp: r[20] })) };
}

const rec = id => {
  const s = sh('記録'), v = s.getDataRange().getValues(), i = v.findIndex((r, k) => k > 0 && r[0] == id);
  if (i < 0) throw new Error('記録が見つかりません');
  return { s, i: i + 1, r: v[i] };
};
const own = (q, u) => { const o = rec(q.id); if (o.r[2] != u.name) throw new Error('本人の記録のみ操作できます'); return o; };
const needAdmin = u => { if (!u.admin) throw new Error('管理者のみ操作できます'); };
const put = (q, u) => DriveApp.getFolderById(FOLDER_ID).createFile(Utilities.newBlob(Utilities.base64Decode(q.photo.split(',')[1]), 'image/jpeg',
  q.at.replace(/[-:T]/g, '') + '_' + u.name + '.jpg')).getId();
const trash = id => { try { if (id) DriveApp.getFileById(id).setTrashed(true); } catch (e) {} };
const jv = q => {   // 検知結果と酒気帯び（0.15mg/L以上=有）
  const h = q.val !== '' && q.val != null && isFinite(Number(q.val));
  return [h ? Number(q.val) : '', h ? (Number(q.val) >= 0.15 ? '有' : '無') : ''];
};

function add(q, u) {
  if (!q.veh || !q.at || !q.photo) throw new Error('車両・日時・検知器の表示画面の写真は必須です');
  return lk(() => {
    const ph = put(q, u), s = sh('記録'), n = s.getLastRow() + 1;
    [2, 6, 16, 20].forEach(c => s.getRange(n, c).setNumberFormat('@'));
    s.getRange(n, 1, 1, 21).setValues([[Utilities.getUuid(), now(), u.name, q.veh, q.ty, q.at, q.me || 'その他', q.mo || '', ...jv(q),
      q.note || '', '', ph, ...Array(8).fill('')]]);
    return { ok: 1 };
  });
}

// 運転者本人のみ。管理者確認前の記録だけ修正・削除できる
function update(q, u) {
  if (!q.veh || !q.at) throw new Error('車両・日時は必須です');
  return lk(() => {
    const { s, i, r } = own(q, u);
    if (r[13] == '済') throw new Error('管理者が確認済みです。確認の取消を申請してください');
    s.getRange(i, 6).setNumberFormat('@');
    s.getRange(i, 4, 1, 8).setValues([[q.veh, q.ty, q.at, q.me || 'その他', q.mo || '', ...jv(q), q.note || '']]);
    if (q.photo) { trash(r[12]); s.getRange(i, 13).setValue(put(q, u)); }
    return { ok: 1 };
  });
}

function remove(q, u) {
  return lk(() => {
    const { s, i, r } = own(q, u);
    if (r[13] == '済') throw new Error('管理者が確認済みです。確認の取消を申請してください');
    trash(r[12]); s.deleteRow(i);
    return { ok: 1 };
  });
}

// 確認済みの記録について、運転者が管理者へ確認取消を申請
function reqcancel(q, u) {
  if (!q.reason) throw new Error('理由を入力してください');
  return lk(() => {
    const { s, i, r } = own(q, u);
    if (r[13] != '済') throw new Error('確認済みの記録のみ申請できます');
    if (r[17] == '申請中') throw new Error('すでに申請中です');
    s.getRange(i, 18, 1, 4).setNumberFormat('@').setValues([['申請中', q.reason, now(), '']]);
    return { ok: 1 };
  });
}

// 管理者：確認完了（確認者欄に管理者名を記入）／確認の取消
function review(q, u) {
  needAdmin(u);
  return lk(() => {
    const { s, i } = rec(q.id);
    s.getRange(i, 12).setValue(q.undo ? '' : u.name);
    s.getRange(i, 14, 1, 4).setNumberFormat('@').setValues([q.undo ? ['', '', '', ''] : ['済', u.name, now(), q.comment || '']]);
    s.getRange(i, 18, 1, 4).setValues([['', '', '', '']]);
    return { ok: 1 };
  });
}

// 管理者：確認取消申請への許可／却下
function decide(q, u) {
  needAdmin(u);
  return lk(() => {
    const { s, i, r } = rec(q.id);
    if (r[17] != '申請中') throw new Error('申請中の記録ではありません');
    if (q.ok) { s.getRange(i, 12).setValue(''); s.getRange(i, 14, 1, 4).setValues([['', '', '', '']]); }
    s.getRange(i, 18, 1, 4).setNumberFormat('@').setValues([[q.ok ? '許可済' : '却下', r[18], str(r[19]), q.comment || '']]);
    return { ok: 1 };
  });
}

function photo(q, u) {
  const r = col('記録').find(x => x[0] == q.id);
  if (!r || !r[12] || (!u.admin && r[2] != u.name)) throw new Error('閲覧できません');
  return { img: 'data:image/jpeg;base64,' + Utilities.base64Encode(DriveApp.getFileById(r[12]).getBlob().getBytes()) };
}
