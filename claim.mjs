#!/usr/bin/env node
/**
 * 酷狗概念版 - 每日 VIP / 畅听 自动领取（逆向自 com.kugou.android.lite 5.3.0）
 *
 * 覆盖 6 条领取链路：
 *   1) 看广告领畅听VIP  /youth/v2/ad/play_status + /youth/v2/ad/play_report   （按小时递增，日配额 total 次）
 *   2) 听歌领畅听VIP    /youth/v1/recharge/receive_vip_listen_song
 *   3) 全天畅听模式      /youth/v1/ad/set_free_mode?status=1                  （不开会员也能全天听）
 *   4) 早间畅听          /concepts/v1/free_mode/secondfloor_info -> receive_vip_morning
 *   5) 365 福利          /concepts/v1/recharge/receive_365_welfare
 *   6) 任务中心扫描      /youth/v2/activity/task_list                         （打印可做的任务）
 *
 * 用法：
 *   KUGOU_TOKEN=xxx KUGOU_USERID=123 node claim.mjs            # 执行领取
 *   KUGOU_TOKEN=xxx KUGOU_USERID=123 node claim.mjs --dry      # 只看状态，不发奖
 *   KUGOU_USERINFO='[{"token":"xxx","userid":123}]' node claim.mjs   # 兼容 kgcheckin 的 Secret 格式
 *
 * 可选环境变量：
 *   KG_MID / KG_DFID / KG_UUID   设备指纹，不填则自动生成并固定到 .device.json
 *   KG_APPID=3116  KG_CLIENTVER=11600  KG_SALT=LnT6xpN3khm36zse0QzvmgTZ3waWdRSA
 *   KG_AD_ID                      play_report 里的 ad_id，默认空串
 *   KG_AD_INTERVAL=32000          每次广告上报间隔毫秒
 *   KG_MAX_AD=20                  单账号最多上报次数
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://gateway.kugou.com';

const C = {
  appid: process.env.KG_APPID || '3116',
  clientver: process.env.KG_CLIENTVER || '11600',
  salt: process.env.KG_SALT || 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA',
  adId: process.env.KG_AD_ID ?? '',
  adInterval: Number(process.env.KG_AD_INTERVAL || 32000),
  maxAd: Number(process.env.KG_MAX_AD || 20),
};

const DRY = process.argv.includes('--dry');
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const log = (...a) => console.log(...a);
const j = (o) => JSON.stringify(o);

/* ---------------- 设备指纹（同一份 token 复用同一套指纹，避免风控） ---------------- */
function device() {
  const f = path.join(__dirname, '.device.json');
  let d = {};
  try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  d.mid = process.env.KG_MID || d.mid || rnd(16);
  d.dfid = process.env.KG_DFID || d.dfid || '-' ;
  d.uuid = process.env.KG_UUID || d.uuid || crypto.randomUUID();
  try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch {}
  return d;
}

/* ---------------- 签名：md5(salt + 按 key 字典序的 k=v 拼接 + body + salt) ---------------- */
function signAll(params, body = '') {
  const keys = Object.keys(params)
    .filter((k) => k !== 'signature' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  const joined = keys.map((k) => `${k}=${params[k]}`).join('');
  return md5(C.salt + joined + body + C.salt);
}

function buildParams(acc, extra = {}, body = '') {
  const p = {
    userid: String(acc.userid),
    token: acc.token,
    appid: C.appid,
    clientver: C.clientver,
    clienttime: String(now()),
    mid: acc.mid,
    uuid: acc.uuid,
    dfid: acc.dfid,
    ...extra,
  };
  Object.keys(p).forEach((k) => { if (p[k] === '' || p[k] === undefined) delete p[k]; });
  p.signature = signAll(p, body);
  return p;
}

async function call(acc, method, apiPath, { query = {}, body = '' } = {}) {
  const params = buildParams(acc, query, body);
  const url = new URL(BASE + apiPath);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const opt = { method, headers: { 'User-Agent': 'KuGouConcept/5.3.0 (Android)' } };
  if (method === 'POST') {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = body;
  }
  const res = await fetch(url, opt);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { __raw: text.slice(0, 500) }; }
  return { http: res.status, data };
}

const ok = (d) => d?.status === 1;

const HINTS = {
  51002: '未登录/凭证失效',
  20017: 'token 校验失败',
  30002: '今日奖励次数已领完',
  130012: '今日已领取',
  20002: '参数不完整（该接口还需要业务参数）',
  20001: '参数错误',
  20010: '签名错误',
};

const brief = (d, keys) => {
  if (!d || typeof d !== 'object') return d;
  const code = d.error_code ?? d.errcode;
  const out = { status: d.status, error_code: code, errmsg: d.errmsg ?? d.error ?? d.error_msg };
  if (HINTS[code]) out.hint = HINTS[code];
  if (d.data && typeof d.data === 'object' && keys) {
    out.data = {};
    for (const k of keys) if (d.data[k] !== undefined) out.data[k] = d.data[k];
  }
  return out;
};

/** 轻量探活：用一个必须登录的接口判断 token 是否可用 */
async function checkAuth(acc) {
  const r = await call(acc, 'GET', '/youth/v1/ad/free_mode_info');
  const good = ok(r.data);
  log(`    凭证探测 -> ${good ? '有效' : '无效 ' + j(brief(r.data))}`);
  return good;
}

/* ---------------- 1) 看广告领畅听 VIP ---------------- */
async function stepAd(acc) {
  log('\n[1] 看广告领畅听VIP');
  const st = await call(acc, 'GET', '/youth/v2/ad/play_status', { query: { is_gradient: '1' } });
  const s = brief(st.data, ['total', 'done', 'remain', 'get_vip_hour', 'next_vip_hour', 'mode_status', 'level']);
  log('    play_status ->', j(s));

  const d = st.data?.data || {};
  const remain = Number(d.remain ?? 0);
  const total = Number(d.total ?? 0);
  const done = Number(d.done ?? 0);
  const hour = Number(d.get_vip_hour ?? 0);
  log(`    今日配额 ${done}/${total}，剩余 ${remain} 次，本次奖励约 ${hour} 小时`);
  if (DRY) return { remain, total, done, hour, claimed: 0 };
  if (remain <= 0) { log('    配额已用完，跳过'); return { remain, total, done, hour, claimed: 0 }; }

  let claimed = 0;
  const rounds = Math.min(remain, C.maxAd);
  for (let i = 1; i <= rounds; i++) {
    // 注意：play_start / play_end 是毫秒时间戳（源码 t.java 用 System.currentTimeMillis()）
    const endMs = Date.now();
    const startMs = endMs - Math.max(5, C.adInterval / 1000) * 1000;
    const body = j({
      ad_id: C.adId,
      play_start: startMs,
      play_end: endMs,
      has_download: 0,
    });
    const r = await call(acc, 'POST', '/youth/v2/ad/play_report', {
      query: { is_gradient: '1' }, body,
    });
    const dd = r.data?.data || {};
    if (ok(r.data)) {
      claimed++;
      log(`    第${i}次 上报成功：+${dd.award_vip_hour ?? '?'}h，剩余 ${dd.remain ?? '?'} 次，累计 ${dd.remain_vip_hour ?? '?'}h`);
    } else if (r.data?.error_code === 30002) {
      log('    服务端提示：今日奖励次数已领完'); break;
    } else {
      log(`    第${i}次 失败 ->`, j(brief(r.data, ['total', 'done', 'remain'])));
      break;
    }
    if (i < rounds) await sleep(C.adInterval);
  }
  return { remain, total, done, hour, claimed };
}

/* ---------------- 2) 听歌领畅听 VIP ---------------- */
async function stepListen(acc) {
  log('\n[2] 听歌领畅听VIP');
  const q = await call(acc, 'GET', '/youth/v1/activity/get_listen_song_task', {
    query: { get_stats: '1' },
  });
  log('    任务状态 ->', j(brief(q.data, ['task_status', 'receive_total'])));
  if (DRY) return;

  const r = await call(acc, 'POST', '/youth/v1/recharge/receive_vip_listen_song', {
    query: { source_id: '90154' }, body: '',
  });
  log('    领取 ->', j(brief(r.data)));
}

/* ---------------- 3) 全天畅听模式 ---------------- */
async function stepFreeMode(acc) {
  log('\n[3] 全天畅听模式');
  const t = await call(acc, 'GET', '/youth/v1/ad/get_ad_vip_time');
  const endMs = Number(t.data?.data ?? 0);
  log('    免广告到期 ->', endMs ? new Date(endMs).toLocaleString('zh-CN') : j(brief(t.data)));

  const info = await call(acc, 'GET', '/youth/v1/ad/free_mode_info');
  log('    free_mode_info ->', j(brief(info.data)));

  if (DRY) return;
  const r = await call(acc, 'POST', '/youth/v1/ad/set_free_mode', {
    query: { status: '1' }, body: '',
  });
  log('    开启全天畅听 ->', j(brief(r.data)));
}

/* ---------------- 4) 早间畅听 ---------------- */
async function stepMorning(acc) {
  log('\n[4] 早间畅听');
  const sf = await call(acc, 'GET', '/concepts/v1/free_mode/secondfloor_info');
  const data = sf.data?.data || {};
  const token = data.token_vip_morning || data.token || '';
  log('    secondfloor_info ->', j(brief(sf.data)), token ? '（已拿到 token）' : '（无 token）');
  if (DRY) return;
  if (!token) { log('    今日不可领或已领，跳过'); return; }

  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const r = await call(acc, 'POST', '/concepts/v1/free_mode/receive_vip_morning', {
    query: { token_vip_morning: token }, body: j({ date: day }),
  });
  log('    领取 ->', j(brief(r.data)));
}

/* ---------------- 5) 365 福利 ---------------- */
async function step365(acc) {
  log('\n[5] 365 福利');
  if (DRY) { log('    跳过（dry）'); return; }
  const r = await call(acc, 'POST', '/concepts/v1/recharge/receive_365_welfare', { body: '' });
  log('    领取 ->', j(brief(r.data)));
}

/* ---------------- 6) 任务中心扫描 ---------------- */
async function stepTasks(acc) {
  log('\n[6] 任务中心');
  const r = await call(acc, 'GET', '/youth/v2/activity/task_list');
  const groups = r.data?.data?.list || [];
  if (!Array.isArray(groups) || !groups.length) { log('    无任务列表 ->', j(brief(r.data))); return; }
  for (const g of groups) {
    const ids = (g.task_list || []).map((t) => t.task_id);
    log(`    type=${g.task_type_id}  tasks=[${ids.join(', ')}]`);
    for (const id of ids.slice(0, 5)) {
      const info = await call(acc, 'GET', '/yutc/youth/v1/task/info', {
        query: { taskid: String(id), source: 'mine', pagename: 'task_center', app_version: C.clientver },
      });
      if (ok(info.data)) log(`      task ${id} ->`, j(info.data.data).slice(0, 300));
      await sleep(300);
    }
  }
}

/* ---------------- 7) 新人 VIP（一次性，需 period_id） ---------------- */
async function stepNewUser(acc) {
  const pid = process.env.KG_NEW_USER_PERIOD;
  if (!pid) return;
  log('\n[7] 新人 VIP');
  if (DRY) { log('    跳过（dry）'); return; }
  const r = await call(acc, 'POST', '/youth/v1/activity/receive_new_user_vip', {
    body: j({ period_id: Number(pid) }),
  });
  log('    领取 ->', j(brief(r.data)));
}

/* ---------------- 主流程 ---------------- */
function accounts() {
  if (process.env.KUGOU_USERINFO) {
    const arr = JSON.parse(process.env.KUGOU_USERINFO);
    return arr.map((u) => ({ token: u.token, userid: u.userid }));
  }
  const token = process.env.KUGOU_TOKEN;
  const userid = process.env.KUGOU_USERID;
  if (!token || !userid) {
    console.error('缺少凭证：设置 KUGOU_TOKEN / KUGOU_USERID，或 KUGOU_USERINFO（kgcheckin 的 Secret）');
    process.exit(1);
  }
  return [{ token, userid }];
}

async function main() {
  const dev = device();
  log(`酷狗概念版自动领取  appid=${C.appid} clientver=${C.clientver} ${DRY ? '【演练模式】' : ''}`);
  const onlyCheck = process.argv.includes('--check');

  for (const raw of accounts()) {
    const acc = { ...raw, ...dev };
    log(`\n================ 账号 ${String(acc.userid).replace(/(\d{3})\d+(\d{2})/, '$1***$2')} ================`);
    const alive = await checkAuth(acc).catch(() => false);
    if (!alive) { log('    token 不可用，跳过该账号（请重新登录获取 token/userid）'); continue; }
    if (onlyCheck) continue;

    try { await stepListen(acc); } catch (e) { log('    [听歌] 异常:', e.message); }
    try { await stepAd(acc); } catch (e) { log('    [广告] 异常:', e.message); }
    try { await stepFreeMode(acc); } catch (e) { log('    [畅听模式] 异常:', e.message); }
    try { await stepMorning(acc); } catch (e) { log('    [早间] 异常:', e.message); }
    try { await step365(acc); } catch (e) { log('    [365] 异常:', e.message); }
    try { await stepTasks(acc); } catch (e) { log('    [任务] 异常:', e.message); }
    try { await stepNewUser(acc); } catch (e) { log('    [新人] 异常:', e.message); }
  }
  log('\n完成。');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
