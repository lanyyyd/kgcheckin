# 酷狗概念版 每日 VIP / 畅听 自动领取

逆向自 `com.kugou.android.lite` 5.3.0（versionCode 11600），接口全部来自 APK 反编译，并已在真实账号上跑通。

## 一、实测结论：每天 2 天，8 次广告不是 8 天

单账号每日上限与 kgcheckin README 一致：**约 2 天/天**。

| 来源 | 次数 | 单次 | 小计 |
|---|---|---|---|
| 看广告 `play_report` | 8 次/天 | 约 3 小时 | **24 小时 = 1 天** |
| 听歌 / 天天签到 | 1 次/天 | 24 小时 | 1 天 |
| **合计** | | | **约 2 天** |

实测返回（三个账号一致）：

```json
// GET /youth/v2/ad/play_status?is_gradient=1
{"total":1,"done":8,"remain":0,"get_vip_hour":"24","next_vip_hour":0,"mode_status":1,"level":0}
```

字段含义（`com.kugou.android.lite.getvip.l`）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `total` | int | 今日可领天数上限（1 天） |
| `done` | int | 今日已看广告次数（8） |
| `remain` | int | 今日剩余次数（0） |
| `get_vip_hour` | **String** | **今日已累计获得的小时数**（24，不是单次奖励） |
| `next_vip_hour` | int | 下一次能领多少小时（0 = 没额度） |
| `remain_vip_hour` | int | 今日剩余可领小时 |

交叉验证：

- `GET /youth/v1/ad/get_ad_vip_time` → `vip_end_time - server_time = 82759 秒 ≈ 23 小时`，说明今天总共只加了约 24 小时，不是 8 天。
- `GET /youth/v1/ad/free_mode_info` → `{"vip_time":91532,"award_vip_hour":24}`，`vip_time ≈ 25.4h` 同样是 24 小时级别的余量。

支持「每次约 3 小时」的界面文案（`res` / dex 字符串）：

```
观看视频，可领%d小时畅听VIP
再看一个，领%s小时畅听VIP
恭喜你！获得%d小时畅听VIP
```

合计 8 次 × 3h = 24h，正好一天。

**补充：不带 `is_gradient` 的 `play_status` 返回完全相同的计数，不存在第二套隐藏配额。**

### 那还能多做什么

VIP 天数打不过服务端的 2 天硬配额，但脚本做了 kgcheckin 没做的事：

1. **全天畅听模式** `POST /youth/v1/ad/set_free_mode?status=1` → 实测 `{"status":1,"data":true}`。
   把这 24 小时用在「免广告听全曲」上，是 VIP 之外的等效权益（同一份时长，不是额外天数）。
2. **签到状态** `secondfloor_info.daily_vip.received_today`，明确报告今天领没领。
3. **新人分期福利** `vip_signin.signin_list`，列出 `period_id / vip_days / receive_status`；`KG_CLAIM_PERIODS=1` 时尝试领未领期数。
4. **365 福利** `receive_365_welfare`（实测 `claim_status=2`，今日不可领）。
5. **任务中心扫描** `/youth/v2/activity/task_list`（当前返回空列表）。

## 二、鉴权：为什么必须用 appid=1005

| 组合 | 结果 |
|---|---|
| `appid=3116` + `salt=LnT6…`（概念版 APK 的值） | **51002 未登录** |
| `appid=1005` + `salt=LnT6…` | **20006 err signature** |
| `appid=1005` + `salt=OIlwieks28dk2k092lksi2UIkp` | ✅ **status=1** |

`USERINFO` 里的 token 属于**酷狗音乐**体系，必须配 `appid=1005 / clientver=20489 / salt=OIlwieks28dk2k092lksi2UIkp`。

签名规则（`com.kugou.common.network.y` + `m2.h`）：

```
signature = md5( salt + concat(按 key 字典序的 "k=v") + body + salt )
```

设备指纹必须与登录时一致（照抄 KuGouMusicApi）：

```
dfid = '-'
mid  = md5(dfid) + md5(dfid)[0:7]
uuid = md5(dfid + mid)
```

网关还会读**请求头** `dfid / mid / clienttime` 做会话校验，只把参数放 query 里同样 51002。

## 三、接口清单

| # | 用途 | 方法 | 路径 |
|---|---|---|---|
| 1 | 广告进度 | GET | `/youth/v2/ad/play_status?is_gradient=1` |
| 2 | 广告发奖 | POST | `/youth/v2/ad/play_report?is_gradient=1` |
| 3 | 听歌任务状态 | GET | `/youth/v1/activity/get_listen_song_task?get_stats=1` |
| 4 | 听歌领 VIP | POST | `/youth/v1/recharge/receive_vip_listen_song?source_id=90154` |
| 5 | 免广告到期 | GET | `/youth/v1/ad/get_ad_vip_time` |
| 6 | 免费模式信息 | GET | `/youth/v1/ad/free_mode_info` |
| 7 | 开启全天畅听 | POST | `/youth/v1/ad/set_free_mode?status=1` |
| 8 | 签到/分期信息 | GET | `/concepts/v1/free_mode/secondfloor_info` |
| 9 | 早间畅听 | POST | `/concepts/v1/free_mode/receive_vip_morning` |
| 10 | 365 福利 | POST | `/concepts/v1/recharge/receive_365_welfare` |
| 11 | 任务列表 | GET | `/youth/v2/activity/task_list` |
| 12 | 任务详情 | GET | `/yutc/youth/v1/task/info?taskid=&source=&pagename=&app_version=` |
| 13 | 新人分期 VIP | POST | `/youth/v1/activity/receive_new_user_vip` body `{"period_id":N}` |

`play_report` body（`play_start/play_end` 是**毫秒**）：

```json
{"ad_id":"","play_start":1792205700000,"play_end":1792205732000,"has_download":0}
```

错误码：`51002` 未登录 / `20006` 签名错 / `30002` 今日次数已领完 / `20028` 重复领取或条件不满足。

## 四、使用

```bash
KUGOU_TOKEN=xxx KUGOU_USERID=123 node claim.mjs --check   # 只验凭证
KUGOU_TOKEN=xxx KUGOU_USERID=123 node claim.mjs --dry     # 只查状态
KUGOU_TOKEN=xxx KUGOU_USERID=123 node claim.mjs           # 正式领取
KUGOU_USERINFO='[{"token":"xxx","userid":123}]' node claim.mjs   # 多账号
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `KG_APPID` | `1005` | 必须 1005，用 3116 会 51002 |
| `KG_CLIENTVER` | `20489` | 与 appid 配套 |
| `KG_SALT` | `OIlwieks28dk2k092lksi2UIkp` | 与 appid 配套 |
| `KG_AD_INTERVAL` | `32000` | 广告上报间隔，别低于 30s |
| `KG_MAX_AD` | `20` | 单账号最多上报次数（实际受 `remain` 限制，最多 8） |
| `KG_AD_ID` | 空 | `play_report` 的 `ad_id` |
| `KG_FORCE_AD` | 无 | 设 1 时配额为 0 也强制上报一次，用于诊断 |
| `KG_CLAIM_PERIODS` | 无 | 设 1 才尝试新人分期领取 |
| `KG_DFID` / `KG_MID` / `KG_UUID` | 派生值 | 改了会导致 token 失效 |

## 五、GitHub Actions

`.github/workflows/claim.yml`，cron `15 17 * * *`（UTC）= 北京时间 01:15，比原签到早 8 小时抢配额。
手动触发可传 `dry=true` 只看状态，`force_ad=1` 做诊断。

## 六、注意

- 每天 8 次广告合计 24 小时 = 1 天，加听歌 1 天，共 2 天，这是服务端硬上限，脚本只是把它跑满。
- `set_free_mode` 会真实改变账号当天状态（开启免广告畅听），不想要就注释掉这一步。
- 若同时保留原 `签到.yml`，它会在 09:10 发现配额已被用完并报「今天次数已用光」，属正常现象，建议停用避免误报。
