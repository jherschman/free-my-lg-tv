#!/usr/bin/env python3
"""Finds the name LG's Multi View has on this TV, so Free My TV's Multi View key can open it directly.

    python3 tools/tv_probe.py 192.168.86.42

First open Multi View on the TV the usual way (Settings, then Multi View), then come back to Free My TV and run
this. Free My TV notes each app that comes to the front, so Multi View's name is among the newest ones listed here.
Only reads. Needs the key install.py saved.
"""
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'webos'))
import install  # noqa: E402

WANT = re.compile(r'multi|split|pip|twin|dual|mview|screenshare', re.I)


def answer(out):
    # luna-send-pub prints one JSON object per reply; take the last complete one.
    for line in reversed(out.strip().splitlines()):
        line = line.strip()
        if line.startswith('{'):
            try:
                return json.loads(line)
            except ValueError:
                pass
    return {}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ip = sys.argv[1]
    key = install.key_path(ip)
    if not os.path.exists(key):
        sys.exit('Run python3 webos/install.py %s once first.' % ip)

    res = answer(install.luna(ip, key, 'luna://%s.service/watch' % install.APP_ID, {}, wait=10))
    usage = res.get('usage') or {}
    if not usage:
        print('Free My TV hasn\'t noted any apps yet (the TV said: %s).' % (json.dumps(res)[:200] or 'nothing'))
        print('Open Free My TV once, then Multi View, then come back and run this again.')
        return
    now = time.time() * 1000
    newest = sorted(usage.items(), key=lambda kv: -kv[1])[:10]
    print('Apps that came to the front, newest first:')
    for app, at in newest:
        mins = max(0, int((now - at) / 60000))
        mark = '   <- looks like Multi View' if WANT.search(app) else ''
        print('  %-45s %s%s' % (app, '%d min ago' % mins if mins else 'just now', mark))


if __name__ == '__main__':
    main()
