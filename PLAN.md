# LG C4 Custom Home Screen — Build Plan

Nov 1, 2026 · @Jake Herschman

## Summary

We fork [Free My TV](https://github.com/simbasjungles/free-my-tv) (open source, MIT), install its LG version through LG's official Developer Mode, and restyle it toward Apple TV with Claude Code. Nothing on the TV is rooted, uninstalled, or replaced, so the native LG experience stays one button away.

Three things about the C4 shape every decision below:

1. **It can't be rooted.** 2024 LG models shipped with the known exploits already patched, so the plan assumes a stock TV.
2. **Without root, our home screen is an app, not the system launcher.** The Home button still opens LG's home. We get one-press access via a number key, and we'll test whether it can open at power-on.
3. **Developer Mode needs a renewal about every 40 days.** If it lapses, only our app disappears. Your installed apps and settings are untouched.

## What the C4 allows

The C4 runs webOS 24. Here is what that means in practice.

| Capability | On your C4 | Notes |
| --- | --- | --- |
| Install a custom home screen app | Yes | Through LG's Developer Mode app over Wi-Fi, port 9922 |
| Replace the Home button | No | Needs root; [dejavuln](https://github.com/throwaway96/dejavuln-autoroot) and faultmanager are patched on 2024 models |
| One-press access | Yes | Hold a number key while the app is open to pin it (e.g. key 1) |
| Open automatically at power-on | Maybe | Likely, no root needed: the app registers itself as an input on launch, then Power On Screen is set to last input (Phase 4) |
| See and launch your installed apps | Yes | Allow the one-time access prompt on the TV so it can list all apps with icons |
| Picture, sound, HDMI, inputs | Untouched | All stay in LG's own menus |

**Do not try to root it.** There's no working exploit for current C4 firmware, and random root tools are the main way people break these TVs.

## Fallback and undo

The native LG home screen never goes away, so falling back is always one button press. Your Content Store apps live in a separate part of the TV's storage from Developer Mode apps, so turning Dev Mode on or off doesn't touch them. Nothing needs reinstalling.

Four levels of undo, lightest first:

1. **Press Home.** LG's home opens as normal. Use this any time the custom screen misbehaves.
2. **Unpin the number key.** The TV goes back to behaving exactly as today.
3. **Uninstall the app.** Run `python3 webos/install.py <TV IP> --uninstall`, or remove it from the TV's app list.
4. **Turn off Developer Mode.** Removes every Dev Mode app and the SSH access. The TV is fully stock again.

If we get power-on launch working in Phase 4, the undo for that is changing **Power On Screen** back to Home in Settings > General > System > Additional Settings > Home Settings.

## Pre-flight checklist

Do these before opening Claude Code. About 30 minutes total.

**Baseline (so you can always compare and restore)**

- [ ] Take phone photos of your current LG home screen, app order, and Settings > General > System > Additional Settings > Home Settings
- [ ] Note your firmware version in Settings > Support > Software Update
- [ ] Write down which apps you actually use daily; this becomes the shelf

**Network**

- [ ] Plug the TV into Ethernet if you can (faster, more stable installs and streaming)
- [ ] In your router or mesh app, reserve a fixed IP for the TV so the install address never changes
- [ ] Confirm the laptop and TV are on the same network

**LG Developer Mode**

- [ ] Create a free LG developer account at [webostv.developer.lge.com](https://webostv.developer.lge.com)
- [ ] On the TV, install **Developer Mode** from the LG Content Store and sign in
- [ ] Turn on **Dev Mode Status** (the TV restarts), reopen the app, turn on **Key Server**
- [ ] Note the 6-character passphrase shown on screen
- [ ] Set a recurring reminder every 30 days to open Developer Mode and press Extend

**Laptop**

- [ ] Python 3, Git, and Claude Code installed
- [ ] Fork `simbasjungles/free-my-tv` to your own GitHub so your changes are saved and versioned
- [ ] Get a free TMDB API key for the trending picks row

## Build phases

Each phase ends with a check you do on the TV. Don't start the next phase until it passes.

1. **Stock install.** Install Free My TV unchanged, allow the app-access prompt, pin it to key 1.
   - Pass: it opens in under 2 seconds, shows all your apps with icons, and each one launches.
2. **Configure.** Set city (Philadelphia), TMDB key, and the shelf order from your daily-apps list. Remove the crypto prices.
   - Pass: shelf matches your list; weather is right; Home still opens LG's screen.
3. **Apple TV restyle.** Claude Code edits the shared web UI to the spec in the next section. Redeploy after each change.
   - Pass: scrolling the shelf feels instant with the remote's arrow keys, with no dropped frames.
4. **Power-on experiment.** Have the app register itself as an input on every launch (luna://com.webos.service.eim addDevice; appinfo.json needs supportGIP and a largeIcon), then set Power On Screen to last input. Also test whether a tile can open LG's Multi View. Stop if either needs root.
   - Pass: TV turns on into the custom screen, or we document that it can't and keep key 1.
5. **Polish and harden.** Test the Magic Remote pointer and arrow keys, test after a full power cut, write a short README of your changes.
   - Pass: it survives a week of daily use by both of you without anyone reaching for the LG home.

## Design spec: Apple TV look, minimal lag

The goal is tvOS calm: one row of big app tiles, a full-bleed hero above it, nothing that moves unless you move.

**Look**

- Top: full-bleed hero image for the focused app or trending pick, with a soft bottom gradient into the shelf
- Shelf: one row of large rounded tiles (about 16px radius), 6 to 8 visible, your daily apps first
- Focus: the focused tile scales up about 1.1x with a soft shadow and slight parallax; everything else stays still
- Type: SF-style system sans, large and sparse; clock top right, no other chrome
- Theme: dark by default (better for OLED and evenings), with the existing sunset-based light mode as an option

**Speed rules for Claude Code**

- Animate only `transform` and `opacity`; never animate size, position, or shadows directly
- Test frosted-glass blur on the TV itself. It's the most expensive effect; if scrolling stutters, swap it for a semi-transparent solid panel
- No autoplaying video; hero images only, preloaded and sized for 4K
- Cache app icons and the trending picks locally so the screen renders before the network answers
- Arrow-key focus must respond on the same frame; no transitions longer than about 200ms

**OLED care:** dim static elements like the clock and shelf after a few minutes idle, and let LG's own screen saver take over.

## Google integration

The C4 has Google Cast built in, which is the strongest Google link. Google Assistant on the TV itself is gone: [LG ended it on May 1, 2025](https://9to5google.com/?p=667456), and the remote's mic now uses LG's own voice service.

| What | Works? | How |
| --- | --- | --- |
| Cast from phones, YouTube, Google Photos | Yes | Built into webOS 24; the TV shows up as a Cast target |
| Voice control from Nest speakers (on/off, volume, inputs) | Yes | Link the TV in the LG ThinQ app, then add LG ThinQ in Google Home |
| Music to the TV in a Google speaker group | Unreliable | Owners report the C4 casts alone but [won't join speaker groups](https://www.googlenestcommunity.com/t5/user/viewprofilepage/user-id/715217) |
| Google Assistant on the TV remote | No | Discontinued |

**Stretch ideas for the custom screen** (later, each needs a Google sign-in flow): a Google Calendar "today" strip in the drawer, or a Google Photos album as the hero background. Both are doable but add login complexity, so they come after Phase 5.

## Picture-in-picture

The C4's built-in Multi View covers HDMI + AirPlay, but not two AirPlay devices, AirPlay + a streaming app, or two HDMI inputs. Those limits are in LG's firmware and the TV's single HDMI decoder, so no app can lift them. Anything beyond the built-in combinations needs an external box.

**Built-in Multi View (Settings button > Multi View)**

| Main screen | Second screen | On C4 |
| --- | --- | --- |
| HDMI input | AirPlay or phone screen share | Yes |
| Live TV | Screen share, camera, YouTube, Spotify | Yes |
| YouTube | Camera or screen share | Yes |
| AirPlay | AirPlay | No |
| AirPlay | Netflix, Hulu, other apps | No |
| HDMI | HDMI | No (G4 and up only) |

Both screens drop to standard dynamic range, and Dolby Vision or HDR AirPlay content forces full screen. [LG's Multi View guide](https://www.lg.com/us/support/help-library/lg-tv-how-to-use-multiview-CT10000018-20153280988637) lists the full rules.

**What the custom home screen adds:** a Multi View tile, only if webOS lets a Developer Mode app open it. On older webOS it could only be launched as root, so treat this as a Phase 4 experiment that may come back "not possible".

**For any-source picture-in-picture: an HDMI multiviewer**

A 4-in, 1-out multiviewer combines up to four HDMI boxes into one picture (side by side, PiP, or quad) and feeds one TV input. For AirPlay you'd add an Apple TV box as one of the sources. Streaming apps on the TV itself can't be included; every source must be an external box.

| Model | Max resolution | Notes |
| --- | --- | --- |
| [OREI UHD-401MV](https://orei.com/products/ultra-hd-4k-quad-multi-viewer-4x1-hdmi-seamless-switch-uhd-401mv) | 4K60 | Up to 8 layouts, consumer-friendly |
| [BZBGEAR BG-UHD-MVS41A](https://www.markertek.com/product/bg-uhd-mvs41a/bzbgear-bg-uhd-mvs41a-4x1-quad-hdmi-multi-viewer-4k60-18gbps-with-seamless-switcher-and-audio-de-embedder) | 4K60 4:4:4 | Pro-grade, independent audio selection |
| [J-Tech MV41AE](https://www.newegg.com/j-tech-digital-jtech-mv41ae-hdmi-multiviewer-switch-4-in-1-out-seamless-switcher-audio-extraction/p/2W4-005V-00076) | 4K30 | Budget; 30Hz looks choppy for sports |

Before buying, confirm HDCP 2.2 support (streaming boxes need it). Expect no HDR, no Dolby Vision, and added lag through the box, so keep your game console on its own HDMI input. Layouts are switched with the multiviewer's own remote.

## Things you might not be thinking about

- **Clean up the LG home too.** Since it's still the fallback and the Home button target, turn off its recommendations and promos in Home Settings. Both screens end up calmer.
- **Turn off viewing-data collection.** In Settings > General > System > Additional Settings, turn off Live Plus and review User Agreements. Less tracking and less background work on the TV.
- **Turn on Always Ready / Quick Start.** Faster power-on matters more for "feels fast" than anything in the app.
- **Two users.** Hanna needs to know key 1 opens the new screen and Home opens the old one. Keep the layout predictable for her.
- **Firmware updates are fine.** Because nothing is rooted, LG updates won't break the install. Re-run Phase 1's check after any big update.
- **The 40-day renewal is the most likely failure.** Put it on a shared calendar, not just your phone.
- **Magic Remote has two modes.** The pointer and the arrow keys both need good focus states, or the app will feel broken half the time.
- **Keep your changes small and committed.** One change per commit in your fork means any bad change rolls back in seconds.

## Kickoff prompt for Claude Code

Download this doc as Markdown, save it as PLAN.md in the root of your forked repo, then open Claude Code in that folder and paste this. Replace the IP with the one you reserved.

```markdown
Read PLAN.md, CLAUDE.md, and the webos/ folder before doing anything. PLAN.md is the source of truth for this project.

I want to install and customize Free My TV on my LG OLED C4 (webOS 24, not rooted) at 192.168.86.42. I live in Philadelphia.

Rules:
- Use only LG Developer Mode. Never attempt rooting, never uninstall or disable any app on the TV, never change TV settings without asking me.
- I will type the Developer Mode passphrase myself.
- Work one phase at a time from PLAN.md. At the end of each phase, tell me exactly what to check on the TV and wait for my OK.
- Commit each change separately with a clear message.
- If something in PLAN.md turns out to be wrong or impossible, stop and tell me instead of working around it.

Phase 1 is done (stock app installed, pinned to key 1). Start with Phase 2: ask me for my daily apps for the shelf order.
```

## Sources

- [Free My TV repo and README](https://github.com/simbasjungles/free-my-tv)
- [Free My TV releases (LG support details)](https://github.com/simbasjungles/free-my-tv/releases)
- [Free My TV write-up, The Menon Lab](https://themenonlab.blog/blog/free-my-tv-claude-code-ad-free-smart-tv-home-screen)
- [Decrypt: a Free My TV install that went wrong](https://decrypt.co/381717/how-vibe-coded-my-smart-tv-claude-killed-it)
- [webOS Homebrew: Developer Mode guide](https://www.webosbrew.org/devmode/)
- [faultmanager-autoroot patch status](https://github.com/throwaway96/faultmanager-autoroot)
- [dejavuln-autoroot: 2024 models patched](https://github.com/throwaway96/dejavuln-autoroot)
- [TV Home for webOS: limits without root](https://github.com/theboringhumane/theboringtv-lgwebos/wiki)
- [LG: Choosing your Power On Screen](https://www.lg.com/ae/support/product-help/CT20076005-20154564869120)
- [9to5Google: LG TVs lose Google Assistant](https://9to5google.com/?p=667456)
- [LG: How to use Multi View (webOS 24)](https://www.lg.com/us/support/help-library/lg-tv-how-to-use-multiview-CT10000018-20153280988637)
- [openlgtv webOS notes: registering an app as an input, Multi View app](https://gist.github.com/Informatic/1983f2e501444cf1cbd182e50820d6c1?permalink_comment_id=4416052)
- [TWiT: dual HDMI Multi View on LG OLEDs](https://twit.tv/posts/tech/can-you-view-2-hdmi-inputs-side-side-lg-oled-tvs)
