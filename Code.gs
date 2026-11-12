// アルコールチェック記録簿 バックエンド（Googleスプレッドシートに紐づくApps Script）
// 「拡張機能 > Apps Script」に貼り付け → FOLDER_ID を設定 → ウェブアプリとしてデプロイ
const FOLDER_ID = 'https://script.google.com/macros/s/AKfycbxUr7fKJEatMwppOgODVRk2bno-7LRKZUnKqoZxEXDB_IlRlJYABDp-UcqRxvnbMWRZ/exec';
const TZ = 'Asia/Tokyo';

const sh = n => SpreadsheetApp.getActive().getSheetByName(n);
const col = n => sh(n).getDataRange().getValues().slice(1);
const str = v => v instanceof Date ? Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm") : String(v == null ? '' : v);
const now = () => Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm");
const users = () => col('従業員').filter(r => r[0]).map(r => ({ name: str(r[0]), pin: str(r[1]).trim(), admin: str(r[2]).trim() == '管理者' }));

function auth(q) {
  const u = users().find(x => x.name == q.name && x.pin && x.pin == String(q.pin).trim());
  if (!u) throw new Error('氏名またはPINが違います');
  return u;
}

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
      r = ({ login: () => ({ admin: u.admin }), list, add, review, photo, addveh })[q.action](q, u);
    }
  } catch (err) { r = { error: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

// 運転者の自己登録（誰でも可）。権限は必ず「従業員」。管理者はシート上で手動指定する
function register(q) {
  const n = str(q.rname).trim().replace(/\s+/g, ' '), p = str(q.rpin).trim();
  if (!n || n.length > 30) throw new Error('運転者名を入力してください（30文字以内）');
  if (!/^\d{4,6}$/.test(p)) throw new Error('PINは数字4〜6桁で入力してください');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (users().some(u => u.name == n)) throw new Error('この名前は登録済みです。一覧から選んでログインしてください');
    const s = sh('従業員'), r = s.getLastRow() + 1;
    s.getRange(r, 1, 1, 3).setNumberFormat('@').setValues([[n, p, '従業員']]);
  } finally { lock.releaseLock(); }
  return { ok: 1 };
}

// 車両の登録（ログイン済みの人なら誰でも可）
function addveh(q, u) {
  const n = str(q.vname).trim().replace(/\s+/g, ' ');
  if (!n || n.length > 30) throw new Error('車両名を入力してください（30文字以内）');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (col('車両').some(x => str(x[0]) == n)) throw new Error('この車両は登録済みです。一覧から選んでください');
    const s = sh('車両'), r = s.getLastRow() + 1;
    s.getRange(r, 1).setNumberFormat('@').setValue(n);
  } finally { lock.releaseLock(); }
  return { ok: 1 };
}

// 従業員は自分の記録のみ、管理者は全件
function list(q, u) {
  const m = q.month || '';
  return { rows: col('記録').filter(r => r[0] && str(r[5]).startsWith(m) && (u.admin || r[2] == u.name))
    .map(r => ({ id: r[0], drv: r[2], veh: r[3], ty: r[4], at: str(r[5]), me: r[6], mo: r[7], val: r[8], alc: r[9],
      note: r[10], cf: r[11], ph: r[12] ? 1 : 0, rv: r[13], rb: r[14], rt: str(r[15]), rc: r[16] })) };
}

function add(q, u) {
  if (!q.veh || !q.at || !q.me || q.val === '' || !q.alc || !q.cf) throw new Error('必須項目が未入力です');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    let ph = '';
    if (q.photo) {
      const b = Utilities.newBlob(Utilities.base64Decode(q.photo.split(',')[1]), 'image/jpeg',
        q.at.replace(/[-:T]/g, '') + '_' + u.name + '.jpg');
      ph = DriveApp.getFolderById(FOLDER_ID).createFile(b).getId();
    }
    const s = sh('記録'), n = s.getLastRow() + 1;
    [2, 6, 16].forEach(c => s.getRange(n, c).setNumberFormat('@'));   // 日時は文字列で保存
    const row = [Utilities.getUuid(), now(), u.name, q.veh, q.ty, q.at, q.me, q.mo || '', Number(q.val), q.alc,
      q.note || '', q.cf, ph, '', '', '', ''];
    s.getRange(n, 1, 1, row.length).setValues([row]);
  } finally { lock.releaseLock(); }
  return { ok: 1 };
}

function review(q, u) {
  if (!u.admin) throw new Error('管理者のみ操作できます');
  const s = sh('記録'), i = s.getRange(1, 1, s.getLastRow(), 1).getValues().flat().indexOf(q.id);
  if (i < 1) throw new Error('記録が見つかりません');
  const v = q.undo ? ['', '', '', ''] : ['済', u.name, now(), q.comment || ''];
  s.getRange(i + 1, 14, 1, 4).setNumberFormat('@').setValues([v]);
  return { ok: 1 };
}

function photo(q, u) {
  const r = col('記録').find(x => x[0] == q.id);
  if (!r || !r[12] || (!u.admin && r[2] != u.name)) throw new Error('閲覧できません');
  const b = DriveApp.getFileById(r[12]).getBlob();
  return { img: 'data:image/jpeg;base64,' + Utilities.base64Encode(b.getBytes()) };
}
