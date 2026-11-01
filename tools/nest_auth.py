#!/usr/bin/env python3
"""Signs Free My TV in to your Nest devices (Google Device Access) and hands the sign-in to your LG TV.

    python3 tools/nest_auth.py 192.168.86.42

Run it in your own terminal: it asks for your OAuth client secret without showing it, opens Google's sign-in in
your browser, and asks you to paste the address Google sends you to afterwards. Nothing is printed that would let
someone else use your account. The settings that aren't secret (project ids, client id, subscription) are kept in
~/.freemytv/nest.json; the secret and the sign-in go only to the TV, which keeps them in Free My TV's own storage.

An app left in "Testing" on Google's consent screen is signed out after 7 days: run this again then (the TV says so).
Needs the TV in Developer Mode with the key install.py already saved (run install.py once first).
"""
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'webos'))
import install  # noqa: E402  (its SSH and Luna helpers, and the TV's saved key)

SETTINGS = os.path.join(os.path.expanduser('~'), '.freemytv', 'nest.json')
REDIRECT = 'https://www.google.com'
SCOPES = 'https://www.googleapis.com/auth/sdm.service https://www.googleapis.com/auth/pubsub'


def ask(settings, key, label):
    if not settings.get(key):
        settings[key] = input(label + ': ').strip()
    return settings[key]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args or not re.match(r'^\d{1,3}(\.\d{1,3}){3}$', args[0]):
        sys.exit(__doc__)
    ip = args[0]
    key = install.key_path(ip)
    if not os.path.exists(key):
        sys.exit('Run python3 webos/install.py %s once first (it saves the key this uses).' % ip)

    settings = {}
    # The non-secret ids, from ~/.freemytv/nest.json or nest.local.json beside the project (git-ignored).
    for path in (os.path.join(ROOT, 'nest.local.json'), SETTINGS):
        if os.path.exists(path):
            with open(path) as f:
                settings.update(json.load(f))
    project = ask(settings, 'project', 'Device Access project ID')
    client_id = ask(settings, 'clientId', 'OAuth client ID')
    sub = ask(settings, 'subscription', 'Pub/Sub subscription (projects/<cloud project>/subscriptions/<name>)')
    if not sub.startswith('projects/'):
        sys.exit('The subscription is its full name: projects/<cloud project id>/subscriptions/<name>.')
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    with open(SETTINGS, 'w') as f:
        json.dump(settings, f, indent=2)
    install.lock(SETTINGS)

    secret = getpass.getpass('OAuth client secret (not shown): ').strip()
    url = 'https://nestservices.google.com/partnerconnections/%s/auth?%s' % (project, urllib.parse.urlencode({
        'redirect_uri': REDIRECT, 'access_type': 'offline', 'prompt': 'consent', 'client_id': client_id,
        'response_type': 'code', 'scope': SCOPES}))
    print('\nYour browser opens Google\'s sign-in. Pick the home and the cameras to share, allow everything asked,')
    print('and you land on google.com. Copy that page\'s whole address from the address bar and paste it here.')
    print('("Google hasn\'t verified this app" is your own app: Advanced, then Go to it.)\n')
    webbrowser.open(url)
    landed = input('Address after sign-in: ').strip()
    code = urllib.parse.parse_qs(urllib.parse.urlparse(landed).query).get('code', [''])[0]
    if not code:
        sys.exit('That address has no code= in it. Run this again and paste the address of the google.com page.')

    form = urllib.parse.urlencode({'code': code, 'client_id': client_id, 'client_secret': secret,
                                   'redirect_uri': REDIRECT, 'grant_type': 'authorization_code'}).encode()
    try:
        with urllib.request.urlopen('https://oauth2.googleapis.com/token', form, timeout=20) as r:
            tokens = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit('Google refused the sign-in (%s). Check the client secret and try again.' % e.code)
    if not tokens.get('refresh_token'):
        sys.exit('Google gave no lasting sign-in. Run this again (it asks Google for one each time).')

    # Which devices this sign-in reaches, by name only.
    req = urllib.request.Request('https://smartdevicemanagement.googleapis.com/v1/enterprises/%s/devices' % project,
                                 headers={'Authorization': 'Bearer ' + tokens['access_token']})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            devices = json.load(r).get('devices', [])
    except urllib.error.HTTPError as e:
        sys.exit('Signed in, but Google wouldn\'t list the devices (%s). Is the Smart Device Management API on?' % e.code)
    for d in devices:
        info = d.get('traits', {}).get('sdm.devices.traits.Info', {})
        room = (d.get('parentRelations') or [{}])[0].get('displayName', '')
        print('  found: %s (%s)' % (info.get('customName') or room or 'device', d.get('type', '').split('.')[-1].title()))
    if not devices:
        print('  No devices came back: in the sign-in, pick your home and tick the cameras and doorbell.')

    config = {'project': project, 'clientId': client_id, 'clientSecret': secret, 'refreshToken': tokens['refresh_token'],
              'subscription': sub}
    out = install.luna(ip, key, 'luna://com.webos.applicationManager/launch',
                       {'id': install.APP_ID, 'params': {'nestSetup': config}})
    if '"returnValue":true' not in out.replace(' ', ''):
        sys.exit('Couldn\'t reach the TV (%s). Is it on, with Developer Mode on?' % (out.strip() or 'no answer'))
    print('\nDone: Free My TV on the TV is signed in to your Nest devices.')


if __name__ == '__main__':
    main()
