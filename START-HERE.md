# Start here — Jake's LG C4

This folder is Free My TV, already set up for Philadelphia (°F, dark theme, no crypto prices) and built.
TV: LG OLED C4 at 192.168.86.42.

## 1. On the TV (5 min)
1. LG Content Store → search **Developer Mode** → install → open it.
2. Sign in with your free LG developer account (webostv.developer.lge.com).
3. Turn **Dev Mode Status** on. The TV restarts.
4. Open Developer Mode again, turn **Key Server** on. Leave this screen up; it shows a 6-character passphrase.

## 2. On your Mac (5 min)
1. Unzip this folder into `~/Dev/free-my-tv`.
2. Optional, for the trending picks: get a free TMDB key (themoviedb.org → Settings → API) and paste it after
   `tmdb_key=` in `config.properties`. You can also skip this and type it on the TV later.
3. Open Terminal and run:

```bash
cd ~/Dev/free-my-tv
python3 webos/build.py
python3 webos/install.py 192.168.86.42
```

4. When it asks, type the passphrase from the TV screen.
5. Free My TV opens on the TV. A message asks to allow access to your apps: choose **Allow**.
6. While it's open, **press and hold 1** on the remote to pin it to key 1.

## 3. Check (Phase 1 pass)
- Opens in under 2 seconds from key 1
- Shows all your apps with icons, and each one opens
- The Home button still opens LG's normal home screen

## Undo
`python3 webos/install.py 192.168.86.42 --uninstall`, or just turn off Developer Mode.

## Next
Open Claude Code in this folder and paste the kickoff prompt from PLAN.md (it starts from Phase 2).
