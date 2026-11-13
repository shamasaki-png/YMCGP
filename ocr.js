// 検知器の液晶（7セグメント表示「X.XX」）の数値を、画像処理で端末内で直接読み取る。
// 写真は外部に送られない。確実に読めた場合だけ数値を返し、少しでも曖昧なら null を返す
// （呼び出し側で手入力に切り替える）。誤った数値を自動入力しないことを最優先にしている。
const SEG_T = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
// 各セグメントの位置（桁の幅・高さに対する割合 [x0,x1,y0,y1]）
// 数字の中の空洞（どの数字でも線が通らない部分）。ベタ塗りの四角を数字と誤認しないための確認
const HOLES = [[.42, .58, .25, .35], [.42, .58, .65, .75]];
const SEG_Z = { a: [.18, .82, 0, .17], b: [.74, 1, .1, .45], c: [.74, 1, .55, .9], d: [.18, .82, .83, 1], e: [0, .26, .55, .9], f: [0, .26, .1, .45], g: [.18, .82, .42, .58] };

// 四角い範囲への膨張（近くの画素をつなげる）
function boxDil(src, W, H, r) {
  const t = new Uint8Array(W * H), o = new Uint8Array(W * H), pre = new Int32Array(Math.max(W, H) + 1);
  for (let y = 0; y < H; y++) {
    const b = y * W; pre[0] = 0;
    for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + src[b + x];
    for (let x = 0; x < W; x++) t[b + x] = pre[Math.min(W, x + r + 1)] - pre[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < W; x++) {
    pre[0] = 0;
    for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + t[y * W + x];
    for (let y = 0; y < H; y++) o[y * W + x] = pre[Math.min(H, y + r + 1)] - pre[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return o;
}

// 膨張後の塊ごとに、元の画素の外接矩形を求める
function comps(D, M, W, H) {
  const N = W * H, lab = new Int32Array(N), st = new Int32Array(N), C = [];
  for (let s = 0; s < N; s++) {
    if (!D[s] || lab[s]) continue;
    const id = C.length + 1, c = { id, x0: W, y0: H, x1: -1, y1: -1, m: 0 };
    let sp = 0; st[sp++] = s; lab[s] = id;
    while (sp) {
      const i = st[--sp], x = i % W, y = (i - x) / W;
      if (M[i]) { c.m++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y; }
      if (x > 0 && D[i - 1] && !lab[i - 1]) { lab[i - 1] = id; st[sp++] = i - 1; }
      if (x < W - 1 && D[i + 1] && !lab[i + 1]) { lab[i + 1] = id; st[sp++] = i + 1; }
      if (y > 0 && D[i - W] && !lab[i - W]) { lab[i - W] = id; st[sp++] = i - W; }
      if (y < H - 1 && D[i + W] && !lab[i + W]) { lab[i + W] = id; st[sp++] = i + W; }
    }
    C.push(c);
  }
  return { C, lab };
}

function rotate(src, cw, ch, deg) {
  if (!deg) return src;
  const t = deg * Math.PI / 180, co = Math.cos(t), si = Math.sin(t), cx = (cw - 1) / 2, cy = (ch - 1) / 2, o = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const dx = x - cx, dy = y - cy, sx = Math.round(cx + dx * co + dy * si), sy = Math.round(cy - dx * si + dy * co);
    if (sx >= 0 && sy >= 0 && sx < cw && sy < ch) o[y * cw + x] = src[sy * cw + sx];
  }
  return o;
}
const rowSharp = (a, cw, ch) => { let q = 0; for (let y = 0; y < ch; y++) { let s = 0; for (let x = 0; x < cw; x++) s += a[y * cw + x]; q += s * s; } return q; };

// 1つの塊（数字の並び）を読む。成功すれば {s:'123', score} を返す
function decode(M, lab, c, W) {
  const hh0 = c.y1 - c.y0 + 1, pad = Math.round(.7 * hh0) + 2, cw = c.x1 - c.x0 + 1 + 2 * pad, ch = hh0 + 2 * pad;
  let src = new Uint8Array(cw * ch);
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const i = y * W + x; if (M[i] && lab[i] === c.id) src[(y - c.y0 + pad) * cw + (x - c.x0 + pad)] = 1; }
  // 1) 撮影時の回転を補正：横棒がいちばんそろう角度を探す
  let bt = 0, bq = -1;
  for (let a = -12; a <= 12; a += 1.5) { const q = rowSharp(rotate(src, cw, ch, a), cw, ch); if (q > bq) { bq = q; bt = a; } }
  for (const a of [bt - .75, bt - .4, bt + .4, bt + .75]) { const q = rowSharp(rotate(src, cw, ch, a), cw, ch); if (q > bq) { bq = q; bt = a; } }
  const R = rotate(src, cw, ch, bt);
  // 数字の行の範囲：画素が多い行だけを数字とみなす（くっついた「mg/L」などの小さな文字は除く）
  const rs = new Int32Array(ch); let rmax = 0;
  for (let y = 0; y < ch; y++) { let s = 0; for (let x = 0; x < cw; x++) s += R[y * cw + x]; rs[y] = s; if (s > rmax) rmax = s; }
  let t = -1, b = -1;
  for (let y = 0; y < ch; y++) if (rs[y] >= .4 * rmax && rs[y] >= 2) { if (t < 0) t = y; b = y; }
  const hhDet = b - t + 1;
  if (t < 0 || hhDet < 14) return null;
  // 2) 斜体の傾きを補正：縦棒がいちばんそろう傾きを探す
  const offs = Math.ceil(.4 * ch) + 2, uw = cw + 2 * offs, sls = [];
  const unshear = sl => { const U = new Uint8Array(uw * ch); for (let y = t; y <= b; y++) for (let x = 0; x < cw; x++) if (R[y * cw + x]) U[y * uw + Math.round(x - sl * (b - y)) + offs] = 1; return U; };
  const sharp = U => { let q = 0; for (let x = 0; x < uw; x++) { let s = 0; for (let y = t; y <= b; y++) s += U[y * uw + x]; q += s * s; } return q; };
  let bsl = 0, bsq = -1;
  for (let sl = 0; sl <= .341; sl += .02) { const q = sharp(unshear(sl)); if (q > bsq) { bsq = q; bsl = sl; } }
  for (const sl of [bsl - .02, bsl, bsl + .02]) if (sl >= 0) sls.push(sl);
  const cands = [];
  for (const sl of sls) {
    const U = unshear(sl), I = new Int32Array((uw + 1) * (ch + 1));   // 積分画像
    for (let y = 0; y < ch; y++) { let rs = 0; for (let x = 0; x < uw; x++) { rs += U[y * uw + x]; I[(y + 1) * (uw + 1) + x + 1] = I[y * (uw + 1) + x + 1] + rs; } }
    const sum = (x0, x1, y0, y1) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(uw - 1, x1); y1 = Math.min(ch - 1, y1); if (x1 < x0 || y1 < y0) return 0; return I[(y1 + 1) * (uw + 1) + x1 + 1] - I[y0 * (uw + 1) + x1 + 1] - I[(y1 + 1) * (uw + 1) + x0] + I[y0 * (uw + 1) + x0]; };
    let Rr = -1;
    for (let x = uw - 1; x >= 0; x--) { let s = 0; for (let y = t; y <= b; y++) s += U[y * uw + x]; if (s >= 2) { Rr = x; break; } }
    if (Rr < 0) continue;
    // 数字の高さ・位置の候補（「1」ばかりで上下の横棒がない場合に備え、高さを少し補う）
    const places = [];
    for (const k of [1, 1.06, 1.12, 1.2, 1.3]) { const hh = Math.round(hhDet * k); places.push([b - hh + 1, b, hh]); if (k > 1) places.push([t, t + hh - 1, hh]); }
    for (const [top, bot, hh] of places) for (let pk = .5; pk <= .701; pk += .02) for (const wk of [.44, .48, .52, .56, .6]) {
      const p = pk * hh, wd = Math.round(wk * hh);
      let str = '', S = 0, ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        const rx = Math.round(Rr - (2 - i) * p), a = rx - wd + 1, act = {};
        for (const k in SEG_Z) {
          const [fx0, fx1, fy0, fy1] = SEG_Z[k], xa = a + Math.round(fx0 * (wd - 1)), xb = a + Math.round(fx1 * (wd - 1)), ya = top + Math.round(fy0 * (hh - 1)), yb = top + Math.round(fy1 * (hh - 1));
          act[k] = sum(xa, xb, ya, yb) / ((xb - xa + 1) * (yb - ya + 1));
        }
        let hole = 0;
        for (const [fx0, fx1, fy0, fy1] of HOLES) {
          const xa = a + Math.round(fx0 * (wd - 1)), xb = a + Math.round(fx1 * (wd - 1)), ya = top + Math.round(fy0 * (hh - 1)), yb = top + Math.round(fy1 * (hh - 1));
          hole = Math.max(hole, sum(xa, xb, ya, yb) / ((xb - xa + 1) * (yb - ya + 1)));
        }
        if (hole > .35) { ok = false; break; }
        let b1 = -1, b2 = -1, bd = null;
        for (const d in SEG_T) {
          let s = 0; for (const k in SEG_Z) s += SEG_T[d].includes(k) ? act[k] : 1 - act[k];
          s /= 7; if (s > b1) { b2 = b1; b1 = s; bd = d; } else if (s > b2) b2 = s;
        }
        if (b1 < .86 || b1 - b2 < .07) ok = false; else { str += bd; S += b1; }
      }
      if (ok) cands.push({ s: str, score: S });
    }
  }
  if (!cands.length) return null;
  const top = Math.max(...cands.map(q => q.score)), near = new Set(cands.filter(q => q.score >= top - .12).map(q => q.s));
  if (near.size !== 1) return null;   // 読み方が複数あり得る場合は採用しない
  return { s: [...near][0], score: top };
}

// d: RGBA画素, W×H: 画像サイズ（長辺1200px程度に縮小済みを想定）。戻り値: 数値（例 0.15）または null
function sevenSeg(d, W, H) {
  const N = W * H, mx = new Uint8Array(N), hist = new Int32Array(256);
  let tot = 0;
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2], m = Math.max(r, g, b), n = Math.min(r, g, b);
    mx[i] = (m >= 100 && m - n >= .5 * m) ? m : 0;   // 鮮やかで明るい画素（青・緑・赤など色は問わない）
    if (mx[i]) { hist[m]++; tot++; }
  }
  if (tot < 150) return null;
  let acc = 0, p99 = 255;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tot * .01) { p99 = v; break; } }
  const th = Math.max(110, .62 * p99), M = new Uint8Array(N);
  for (let i = 0; i < N; i++) M[i] = mx[i] >= th ? 1 : 0;
  // 細い目盛りの点線を除いた版（開口処理）も試す
  const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = 1 - M[i];
  const er = boxDil(inv, W, H, 2); for (let i = 0; i < N; i++) er[i] = 1 - er[i];
  const MO = boxDil(er, W, H, 2);
  const tried = [], res = [];
  for (const [MM, r] of [[M, 2], [M, 3], [M, 4], [M, 6], [MO, 2], [MO, 3], [MO, 4], [MO, 6]]) {
    const { C, lab } = comps(boxDil(MM, W, H, r), MM, W, H);
    const L = C.filter(c => { const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1, f = c.m / (w * h); return c.m >= 120 && h >= 14 && h <= H * .4 && w / h >= 1 && w / h <= 3.4 && f >= .22 && f <= .8; })
      .sort((a, b) => b.m - a.m).slice(0, 8);
    for (const c of L) {
      const dup = tried.some(q => { const ix = Math.min(q.x1, c.x1) - Math.max(q.x0, c.x0), iy = Math.min(q.y1, c.y1) - Math.max(q.y0, c.y0); if (ix < 0 || iy < 0) return false; const it = ix * iy; return it / ((q.x1 - q.x0) * (q.y1 - q.y0) + (c.x1 - c.x0) * (c.y1 - c.y0) - it) > .85; });
      if (dup) continue;
      tried.push(c);
      const o = decode(MM, lab, c, W);
      if (o) res.push(o);
    }
  }
  if (!res.length) return null;
  const best = Math.max(...res.map(q => q.score)), strs = new Set(res.filter(q => q.score >= best - .12).map(q => q.s));
  if (strs.size !== 1) return null;
  const s = [...strs][0];
  return parseFloat(s[0] + '.' + s.slice(1));
}
if (typeof module !== 'undefined') module.exports = { sevenSeg };
