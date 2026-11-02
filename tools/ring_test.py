#!/usr/bin/env python3
"""Pretends the doorbell rang, to try Free My TV's doorbell pop-up without anyone at the door.

    python3 tools/ring_test.py 192.168.86.42

Start something on the TV first (a show, or an app), then run this: the pop-up comes up over it.
Needs the key install.py saved, and Free My TV opened once since the TV was turned on.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'webos'))
import install  # noqa: E402


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ip = sys.argv[1]
    key = install.key_path(ip)
    if not os.path.exists(key):
        sys.exit('Run python3 webos/install.py %s once first.' % ip)
    out = install.luna(ip, key, 'luna://%s.service/nest' % install.APP_ID, {'testRing': True}, wait=10)
    if '"returnValue":true' in out.replace(' ', ''):
        print('Rang. Look at the TV.')
    else:
        print('The TV said: ' + (out.strip() or 'nothing (is it on, with Free My TV opened once?)'))


if __name__ == '__main__':
    main()
