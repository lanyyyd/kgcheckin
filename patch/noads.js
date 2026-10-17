/*
 * 酷狗概念版 去广告 / 伪 VIP  —— Frida 运行时脚本（不改包）
 *
 * 用法：
 *   frida -U -f com.kugou.android.lite -l noads.js --no-pause
 *   已启动的话：frida -U com.kugou.android.lite -l noads.js
 *
 * 原理（全部来自 5.3.0 反编译）：
 *   com.kugou.common.environment.a.E2()  = L2() || J2()      -> 全局「是否 VIP/音乐包」
 *   com.kugou.common.environment.a.J2()  = 概念版 VIP 标记（读 b.c().d(152)）
 *   com.kugou.android.ads.b.b()          = 广告会员等级（1 非会员 / 3 会员 / 7 体验 / 8 超级 / 13 广告会员）
 *   广告请求 c.java 会把 E2() 写进 vip_status 上报，广告位据此决定是否下发。
 *
 * 把 E2/J2 置真 + 广告等级置 8，客户端所有「vip 用户不展示广告」分支都会走免广告。
 */

var TAG = '[noads] ';

function hookBool(cls, names) {
  try {
    var C = Java.use(cls);
    var done = [];
    names.forEach(function (n) {
      try {
        var m = C[n];
        if (m && m.overloads && m.overloads.length) {
          m.overloads.forEach(function (ov) {
            if (ov.argumentTypes.length === 0) {
              ov.implementation = function () { return true; };
              done.push(n);
            }
          });
        }
      } catch (e) { /* 方法不存在则跳过 */ }
    });
    console.log(TAG + cls + ' -> ' + (done.join(',') || '无匹配'));
  } catch (e) {
    console.log(TAG + cls + ' 加载失败: ' + e);
  }
}

Java.perform(function () {
  console.log(TAG + '开始注入，等待类加载…');

  // 1) VIP 判定
  hookBool('com.kugou.common.environment.a', ['E2', 'J2', 'L2']);

  // 2) 广告会员等级 -> 8（超级会员）
  try {
    var AdUtils = Java.use('com.kugou.android.ads.b');
    AdUtils.b.overload().implementation = function () {
      return 8;
    };
    console.log(TAG + 'ads.b.b() -> 8');
  } catch (e) {
    console.log(TAG + 'ads.b.b() hook 失败: ' + e);
  }

  // 3) 播放器「看广告领畅听」自动弹窗 -> 永不触发
  try {
    var Mgr = Java.use('com.kugou.android.lite.getvip.VIPActivityModeManager');
    Mgr.q.overload().implementation = function () {
      return false;
    };
    console.log(TAG + 'VIPActivityModeManager.q() -> false');
  } catch (e) {
    console.log(TAG + '(可选) q() hook 跳过: ' + e);
  }

  console.log(TAG + '注入完成');
});
