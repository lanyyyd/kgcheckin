# 去广告 / 伪 VIP：三条路线

反编译目标：`com.kugou.android.lite` 5.3.0（versionCode 11600）

## 一、广告是怎么被判定"不展示"的

关键只有两个方法：

| 位置 | 方法 | 作用 |
|---|---|---|
| `com.kugou.common.environment.a` | `E2()Z` = `L2() \|\| J2()` | 全局「是否 VIP / 音乐包」 |
| `com.kugou.common.environment.a` | `J2()Z` | 概念版 VIP 标记（读 `b.c().d(152)`，兜底 `young_is_vip`） |
| `com.kugou.android.ads.b` | `b()I`（jadx 名 `getLevelType`） | 广告会员等级：1 非会员 / 3 会员 / 7 体验 / 8 超级会员 / 13 广告会员 |

证据链：

- `com.kugou.android.ads.protocol.c` 请求备用广告时执行
  ```java
  jSONObject.put("vip_status", com.kugou.common.environment.a.E2());
  ```
  VIP 用户直接把 `vip_status=1` 上报给 `ads.gateway`，广告位据此不下发。
- `com.kugou.android.ads.b.b()` 里明确写着 `getLevelType 会员 3 / 体验会员 7 / 其它非会员 1`，
  这个值会进 `LoadAdParams`，广告 SDK 按等级决定填充率。
- `com.kugou.android.lite.getvip.VIPActivityModeManager.q()`：
  ```java
  if (environment.a.l2() || environment.a.E2() || environment.a.G2() || ... ) return false;
  ```
  即 VIP 不弹「看广告领畅听」。
- 反编译字符串里存在 `vip 或音乐包 用户不展示广告`（`com.kugou.android.netmusic.search.ads.a.G()`）。

所以**把 `E2()` 强制为 true + 广告等级强制为 8**，客户端侧所有免广告分支都会生效。

## 二、方案 A：改服务端参数（零风险，今天就能用）

```
POST https://gateway.kugou.com/youth/v1/ad/set_free_mode?status=1
```

返回 `{"status":1,"data":true}` — 当天免广告畅听 24 小时。
这不是 VIP，但广告确实不放了，而且用的是官方接口，不会被判异常。脚本 `claim.mjs` 每天已经在调。

局限：只有 24 小时，第二天要重新开；只覆盖"畅听"场景。

## 三、方案 B：Frida 运行时 Hook（推荐，验证最快）

脚本：`patch/noads.js`

```bash
frida -U -f com.kugou.android.lite -l noads.js --no-pause
# 或已启动：
frida -U com.kugou.android.lite -l noads.js
```

做的事：

```js
Java.use('com.kugou.common.environment.a').E2.implementation = () => true;
Java.use('com.kugou.common.environment.a').J2.implementation = () => true;
Java.use('com.kugou.android.ads.b').b.implementation = () => 8;
Java.use('com.kugou.android.lite.getvip.VIPActivityModeManager').q.implementation = () => false;
```

优点：不动 APK，不破坏签名，随时开关。缺点：需要 root / 可注入环境，重启失效。

## 四、方案 C：改包（持久，但有签名校验风险）

`patch/apply_patch.py` 会把三个方法体直接改成常量返回：

```smali
.method public static E2()Z
    .locals 1
    const/4 v0, 0x1
    return v0
.end method
```

然后 `apktool b` → `uber-apk-signer` 重签。

风险（必须知道）：

1. APK 里存在 `checkSignature` 相关逻辑（classes5/9/11/12 都有引用），重签后可能触发校验。
2. 概念版带 `SwordProxy`（腾讯剑虚拟化保护），部分方法被 native 接管，改 smali 不一定生效。
3. 需要卸载原包才能装（签名不同），本地歌曲/缓存会丢。
4. 登录态可能与设备绑定，换签名后可能掉登录。

结论：**能改，但不建议作为主力方案**。B 方案的 hook 效果一样，还不用重装。

## 五、改完能到什么程度

| 能力 | 方案 A | 方案 B/C |
|---|---|---|
| 播放前贴片广告 | ✅ 当天 | ✅ |
| 开屏 / Banner / 信息流广告 | ❌ | ✅ |
| 「看广告领畅听」弹窗 | ✅（不弹了） | ✅ |
| VIP 标识 / 会员UI | ❌ | ⚠️ 会显示成会员，但真 VIP 权益（高音质、下载）服务端不认 |
| 付费歌曲播放 | ❌ | ❌ 服务端鉴权，改本地无效 |

注意最后一行：**免广告可以做，免付费不行**。VIP 歌曲的播放地址是服务端按账号状态签发的，客户端把自己标成 VIP 也拿不到授权，最多是 UI 欺骗。
