# -*- coding: utf-8 -*-
"""对 apktool 解包结果做 smali 补丁：伪 VIP + 去广告 + 屏蔽正版检测跳转

用法：python apply_patch.py <apktool_out_dir>
"""
import os, re, sys, io

ROOT = sys.argv[1] if len(sys.argv) > 1 else 'out'

# (相对路径, 方法签名, 返回类型, 说明)
#   bool  -> const/4 v0, 0x1
#   int:N -> const/16 v0, 0xN
#   null  -> const/4 v0, 0x0 + return-object
TARGETS = [
    ('com/kugou/common/environment/a.smali', 'public static E2()Z', 'bool', 'E2 全局VIP判定=true'),
    ('com/kugou/common/environment/a.smali', 'public static J2()Z', 'bool', 'J2 概念版VIP标记=true'),
    ('com/kugou/android/ads/b.smali', 'private static b()I', 'int:8', '广告会员等级=8 超级会员'),
    ('com/kugou/common/useraccount/entity/UserData.smali',
     'public getJumpUrl()Ljava/lang/String;', 'null', '屏蔽服务端下发的 jump_url（破解版提示页）'),
]


def find_file(rel):
    for d in sorted(os.listdir(ROOT)):
        if not d.startswith('smali'):
            continue
        p = os.path.join(ROOT, d, rel)
        if os.path.isfile(p):
            return p
    return None


def build_body(ret: str) -> str:
    if ret == 'bool':
        return '\n    .locals 1\n\n    const/4 v0, 0x1\n\n    return v0\n'
    if ret == 'null':
        return '\n    .locals 1\n\n    const/4 v0, 0x0\n\n    return-object v0\n'
    if ret.startswith('int:'):
        # const/4 只支持 -8..7，8 必须用 const/16
        return f'\n    .locals 1\n\n    const/16 v0, 0x{ret.split(":")[1]}\n\n    return v0\n'
    raise ValueError(ret)


def patch(path, sig, ret, desc):
    src = io.open(path, encoding='utf-8').read()
    pat = re.compile(r'(\.method\s+' + re.escape(sig) + r'\s*\n)(.*?)(\n\.end method)', re.S)
    m = pat.search(src)
    if not m:
        print(f'  [MISS] {desc}: {sig} 未找到')
        return False
    new = src[:m.start()] + m.group(1) + build_body(ret) + m.group(3) + src[m.end():]
    io.open(path, 'w', encoding='utf-8', newline='\n').write(new)
    print(f'  [OK]   {desc}: {os.path.relpath(path, ROOT)} {sig} -> {ret}')
    return True


def main():
    ok = 0
    for rel, sig, ret, desc in TARGETS:
        p = find_file(rel)
        if not p:
            print(f'  [MISS] 文件不存在: {rel}')
            continue
        if patch(p, sig, ret, desc):
            ok += 1
    print(f'完成 {ok}/{len(TARGETS)}')


if __name__ == '__main__':
    main()
