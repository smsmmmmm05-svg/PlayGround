# Neon Rush

A neon-soaked 3D endless runner for desktop and mobile, built with Three.js from the supplied Unity-style runner concept. Three lanes, escalating speed, jumps, slides, coins, drones, barriers, maglev trains, and a synthwave city that never ends.

## Play

The game is a static site with no build step. Serve the project folder with any static HTTP server:

```bash
python3 -m http.server 3002
# then open http://localhost:3002
```

Or use the included `./start.sh` when the OMGithub runtime is available.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Change lane | `←` / `→` or `A` / `D` | Swipe left / right or arrow buttons |
| Jump | `Space`, `↑`, or `W` | Swipe up or jump button |
| Slide / fast-fall | `↓` or `S` | Swipe down or slide button |
| Pause | `P` or `Esc` | Pause button |
| Mute | `M` | Speaker button |
| Start / retry | `Enter` or `Space` | On-screen buttons |

Collect coins to boost the score, dodge anything solid, and stay alive as the speed climbs from 29 to 72 km/h. Best score and distance are saved in local storage.

## Tech

- Three.js r170 vendored locally (`vendor/three.module.js`)
- Self-hosted Orbitron and Rajdhani fonts
- Procedural geometry, textures, particles, city, and WebAudio music/SFX
- Responsive layout with safe-area support, portrait/landscape handling, and pointer/touch controls
- `window.NeonRush` exposes a small debug API for automated verification

## Notes

This is a browser reinterpretation of the supplied Unity `PlayerController` gameplay (three lanes, forward acceleration, jump, coins, game over), not a Unity build. No external art or audio assets are required.

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/smsmmmmm05-svg/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/smsmmmmm05-svg/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/smsmmmmm05-svg/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/smsmmmmm05-svg/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/smsmmmmm05-svg/PlayGround).
- 🛠️ [Check build runs](https://github.com/smsmmmmm05-svg/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/smsmmmmm05-svg/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/smsmmmmm05-svg).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->
