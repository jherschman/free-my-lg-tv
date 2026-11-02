#!/usr/bin/env python3
"""Finds the name LG's Multi View has on this TV, so Free My TV's Multi View key can open it directly.

    python3 tools/tv_probe.py 192.168.86.42

Only reads: it lists app folders and asks the TV's app manager which apps exist. Needs the key install.py saved.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'webos'))
import install  # noqa: E402

WANT = re.compile(r'multi|split|pip|twin|dual|screen ?share|mview', re.I)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ip = sys.argv[1]
    key = install.key_path(ip)
    if not os.path.exists(key):
        sys.exit('Run python3 webos/install.py %s once first.' % ip)
    found = set()
    listing = install.ssh(ip, key, 'ls /usr/palm/applications /mnt/otycabi/usr/palm/applications '
                                   '/mnt/otncabi/usr/palm/applications 2>/dev/null')
    for line in (listing.stdout or '').split():
        if WANT.search(line):
            found.add(line.strip())
    out = install.luna(ip, key, 'luna://com.webos.applicationManager/listApps', {}, wait=10)
    for m in re.finditer(r'"id"\s*:\s*"([^"]+)"', out):
        if WANT.search(m.group(1)):
            found.add(m.group(1))
    for m in re.finditer(r'"title"\s*:\s*"([^"]*(?:Multi|multi)[^"]*)"', out):
        found.add('(title) ' + m.group(1))
    if found:
        print('Possible Multi View apps:')
        for f in sorted(found):
            print('  ' + f)
    else:
        print('Nothing named like Multi View was visible from Developer Mode.')
        print('(listing: %d lines, app list: %d characters)' % (len((listing.stdout or '').split()), len(out)))


if __name__ == '__main__':
    main()
