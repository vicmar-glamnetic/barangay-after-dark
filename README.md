# Hari ng Kanto

A first-person 3D browser game set in a Filipino barangay at night. Walk around, find the kids playing Laro ng Lahi, and join their games to earn **Tropa Points**.

Runs on iPhone/Android browsers and on Mac (Safari + Chrome). Built with Vite, TypeScript, Three.js and Rapier physics. There is no backend, and every model, texture and sound is generated in code.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also printed: a LAN URL for your phone)
```

To test on a real phone, connect it to the same Wi-Fi and open the **Network** URL that Vite prints.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload, exposed on your LAN |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally (service worker active) |
| `npm run typecheck` | TypeScript only |
| `npm run icons` | Regenerate the PWA icons in `public/icons/` |
| `npm run deploy` | Build and publish `dist/` to the `gh-pages` branch (GitHub Pages) |

### Debug URL flags

- `?touch=1` forces the touch HUD (use it with Chrome DevTools device mode). `?touch=0` forces mouse/keyboard.
- `?fps=1` shows FPS, draw calls and triangle count.
- `?q=low` or `?q=high` forces a quality preset for that session.

## Controls

| | Desktop (Mac) | Phone |
| --- | --- | --- |
| Move | WASD / arrows | Left-side joystick (push all the way to run) |
| Run | Shift | Joystick at full tilt |
| Look | Mouse (Pointer Lock) | Drag on the right half |
| Jump | Space | **Talon** |
| Throw / kick | Left click (hold to aim) | **Bato** / **Sipa** (hold to aim) |
| Interact | E | **Laro!** |
| Pause | Esc | Pause button (top right) |

Settings (in the pause menu) include look sensitivity, invert Y, Low/High quality and volume. They are saved.

## Games

1. **Tumbang Preso** (done): throw your tsinelas at the can from behind the line. If it falls, grab your slipper and get back behind the line before the taya sets the can up and tags you. 3 rounds.
2. **Sipa** (done): kick the sipa when it drops into the ring. Every kick gets faster. Score = streak.
3. **Patintero** (done): on the covered court. Cross all 5 lines to the far end and back. Each line tagger can only slide along its own line and only tags you while you are crossing it; the center-line tagger guards the middle. Do not step outside the grid. 3 lives, 90 seconds.
4. **Taguan** (done): count to ten in the dark ("Isa... dalawa..."), then find the 4 hidden kids within 90 seconds. Giggles and footsteps are positional, so they get louder as you get closer, and the HUD says "Malamig / Malapit-lapit / Mainit na!". A kid is found when you are close, looking at them, and no wall is in the way.
5. **Langit-Lupa** (done): survive 60 seconds. Raised things are langit (safe), the ground is lupa. You cannot stay on one perch longer than 5 seconds (bawal tumambay). The taya walks around crates to reach you; 2 tayas in lobbies of 3+.

All games are open from the start. Progress, best scores and Tropa Points are saved in `localStorage`.

## Multiplayer (lobbies)

Every game can be played solo or in a lobby of up to 6 players.

- At a game spot press **E** / **Laro!**, then choose **Mag-isa** (solo), **Gumawa ng lobby** (you get a 4-letter code like `KAPE`), or **Sumali gamit ang code**. You can also join from the pause menu from anywhere.
- The lobby creator is the **host**. They pick the game (walk to another spot and choose "Laruin ito sa lobby") and press **Simulan!**. Everyone is pulled into the game; after it ends, the host can press **Ulit?** for everyone.
- **Tumbang Preso:** one player is the taya (2+ players). The taya cannot cross the line; walks to a fallen can to pick it up, carries it back into the circle, and while it stands tags anyone past the line by touching them. Whoever gets tagged is the next taya. Solo uses the AI taya.
- **Sipa:** side-by-side streak battle with a live leaderboard.
- **Patintero:** everyone runs the grid against the AI taggers.
- **Taguan:** real hide and seek. One player seeks (rotates every round), the rest hide, and AI kids fill in up to 4 hiders. Hiders' name tags are hidden from the seeker.

**Custom face:** choose "Mukha mo" (in Settings, at a game spot, or in the lobby) and pick a picture. It is center-cropped and shrunk to a 96x96 JPEG (a few KB), kept on your device only, and sent directly to the players in your lobby, who see it on your character and next to your name. The host only accepts small JPEG / PNG / WebP image data.

How it works: peer-to-peer WebRTC through [PeerJS](https://peerjs.com/). The free PeerJS cloud server only introduces players; game traffic goes directly between devices. The host runs the game logic and broadcasts state at 15 Hz; others send their position and actions. Code lives in `src/net/` (`session.ts`, `avatars.ts`) and each game's `onHostMsg` / `onClientMsg`.

Limits to know:
- If the host leaves, the lobby ends. A guest who leaves mid-game also leaves the lobby.
- A few strict networks (some mobile carriers, corporate Wi-Fi) block direct WebRTC connections. There is no relay (TURN) server, so those players cannot join.
- If the host switches away from the tab, their phone may slow the game down for everyone. Keep the host's screen on.

## Project structure

```
src/
  main.ts               App: boot, state machine (title / play / pause), frame loop
  core/                 renderer, loop, input, audio, save, physics, device detection
  world/                barangay map, props, lighting bake, sky, NPC kids, blob shadows, textures
  player/               first-person controller, view-model hand/leg, tsinelas model
  ui/                   HUD, menus, mobile controls, overlays, styles
  games/                gameManager + one module per street game
  net/                  peer-to-peer lobby session and remote player avatars
public/                 manifest, service worker, icons
scripts/make-icons.mjs  dependency-free PNG icon generator
```

### Adding a new street game

1. Create `src/games/myGame.ts` extending `BaseGame` (see `games/baseGame.ts`).
2. Set `id`, `name`, `where`, `implemented`, and a `layout` (interact spot, label position, kid placements).
3. Implement `start()`, `update(dt)`, `stop()` (and `postPhysics()` if you use Rapier bodies). Call `this.ctx.finish(result)` when the game ends.
4. Add it to the `games` array in `games/gameManager.ts`. The array order is the unlock order.

## Performance notes

- **Baked lighting:** every lamp and window light is baked into vertex colors at load time. The whole static world is one merged mesh drawn with `MeshBasicMaterial`, so it costs almost nothing per pixel.
- **Dynamic lighting:** moving objects use Lambert materials lit by a hemisphere light plus a pool of 3 point lights that follow the nearest lamps.
- **Instancing:** electric posts/lamps and perimeter fences are `InstancedMesh`es. Roofs are merged into the static mesh instead, so they still get baked light.
- **Shadows:** there are no shadow maps. All blob shadows are drawn from one instanced mesh.
- **Budget:** about 40 to 46k triangles and roughly 60 to 130 draw calls, depending on the view. DPR is capped at 1.5 on mobile (High) or 1.0 (Low).
- **Physics:** Rapier runs at a variable timestep clamped between 1/240 and 1/30 s.

## Deploy

**Live:** https://haringkanto.vercel.app

```bash
npm run deploy      # Vercel production (project "haringkanto", Vercel builds it with Vite)
npm run deploy:gh   # optional: GitHub Pages copy on the gh-pages branch
```

### Other hosts

The build is a static site in `dist/`. `vite.config.ts` uses `base: './'`, so the same build works at a domain root or in a subfolder.

**Vercel:** import the repo. Framework preset: Vite. Build command `npm run build`, output directory `dist`.

**Netlify:** build command `npm run build`, publish directory `dist`.
Or drag and drop the `dist/` folder into the Netlify dashboard.

**GitHub Pages:**

```bash
npm run deploy    # builds, then force-pushes dist/ to the gh-pages branch of "origin"
```

The first time, enable Pages for the `gh-pages` branch (repo Settings, Pages). The game is then served at `https://<user>.github.io/<repo>/`.

### Add to Home Screen (fullscreen)

- **iPhone (Safari):** Share, then Add to Home Screen. iOS Safari cannot go fullscreen inside a normal tab, so launching from the home screen icon is how you get fullscreen.
- **Android (Chrome):** menu, then Install app / Add to Home screen. In a normal tab the game also asks for fullscreen + landscape when you tap start.

After the first visit, the service worker caches the game so it works offline.

## Notes

- Audio starts only after the first tap/click, as iOS requires. On iPhone the hardware silent switch also mutes Web Audio.
- The UI font is Baloo 2 from Google Fonts, which is free. If the font cannot load, a system font is used.
- There are no paid assets or services.
