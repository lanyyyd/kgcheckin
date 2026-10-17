# -*- coding: utf-8 -*-
"""对 apktool 解包结果做 smali 补丁：伪 VIP + 去广告

用法：python apply_patch.py <apktool_out_dir>
"""
import os, re, sys, io

ROOT = sys.argv[1] if len(sys.argv) > 1 else r'C:/Users/dai/WorkBuddy/Claw/kugou_apk/apktool'

# 目标方法 -> 返回值
TARGETS = [
    ('com/kugou/common/environment/a.smali', 'public static E2()Z', 'true', 'E2 全局VIP判定'),
    ('com/kugou/common/environment/a.smali', 'public static J2()Z', 'true', 'J2 概念版VIP标记'),
    ('com/kugou/android/ads/b.smali', 'private static b()I', '8', '广告会员等级=8 超级会员'),
]


def find_file(rel):
    for d in sorted(os.listdir(ROOT)):
        if not d.startswith('smali'):
            continue
        p = os.path.join(ROOT, d, rel)
        if os.path.isfile(p):
            return p
    return None


def build_body(ret: str, is_bool: bool) -> str:
    if is_bool:
        return '\n    .locals 1\n\n    const/4 v0, 0x1\n\n    return v0\n'
    # const/4 只支持 -8..7，8 必须用 const/16
    return f'\n    .locals 1\n\n    const/16 v0, 0x{ret}\n\n    return v0\n'


def patch(path, sig, ret, desc):
    src = io.open(path, encoding='utf-8').read()
    pat = re.compile(r'(\.method\s+' + re.escape(sig) + r'\s*\n)(.*?)(\n\.end method)', re.S)
    m = pat.search(src)
    if not m:
        print(f'  [MISS] {desc}: {sig} 未找到')
        return False
    body = build_body(ret, sig.endswith('Z'))
    new = src[:m.start()] + m.group(1) + body + m.group(3) + src[m.end():]
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
