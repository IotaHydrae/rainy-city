# 雨城 · Rainy City

A fully animated rainy-city page drawn in real time with Canvas 2D — no image assets for the background. It also has a **street walk** mode: a 2D pseudo-3D side view of a rainy street you can wander, with four landmark facades — a neon block (霓虹街区), a 24-hour convenience store (24 小时便利店), a cloud observation deck (云端观景台), and a rainy-night radio station (雨夜电台).

## Features

- **Live rainy night** — `assets/scene.js`
  - Scalloped cloud bands drifting at different speeds with parallax
  - Black skyline with randomly flickering yellow windows
  - Angled rain streaks, random lightning (with thunder), WebAudio rain ambience
- **Street walk** — `assets/walk.js`
  - Simple perspective projection (ground converges to a vanishing point with 1/z depth)
  - Wet asphalt road, a 12 cm curb, and a narrow raised sidewalk
  - Street lamps with warm light pools and cones, neon sign spill, puddles, foreground rain
  - A hooded walker with a full walk cycle (tapered limbs, profile face, opposite arm/leg swing)
  - The four landmarks appear in **random order on every page load**
- **UI** — `assets/app.js`
  - Weather readouts, live clock, rain-intensity / lightning / rain-sound / motion toggles
  - Immersive mode and a **test scene switcher** (bottom-right) that locks the walker in front of a chosen landmark for inspection

## Run

No build step. Open `index.html` directly, or serve the folder:

```sh
python -m http.server 8777 --directory .
```

Then open <http://127.0.0.1:8777/>.

## Controls

| Where | Action |
|---|---|
| Home | `进入雨夜` — immersive mode; `逛逛城市` — enter the street |
| Street | `←` `→` or `A` `D` to walk, `Esc` to leave |
| Anywhere | `M` toggles the rain sound |
| Test dropdown (bottom-right) | switch to / lock onto a specific landmark inside the street |

## Structure

```
index.html          page structure
assets/scene.js     rainy-night renderer: sky, clouds, city, rain, lightning, audio
assets/walk.js      pseudo-3D street renderer: projection, road/kerb/sidewalk, lamps, landmarks, walker
assets/app.js       UI wiring: controls, HUD, test scene switcher
assets/styles.css   theme and layout
_verify/            headless self-tests (Node geometry check + Chrome probes)
```

## Notes

- The whole background is procedural — nothing is a static image.
- `assets/rainy-city.png` (an earlier reference screenshot, not referenced by the page) is git-ignored because it is third-party game art.
- The `prefers-reduced-motion` preference is intentionally ignored by default: the animation is the content here. A `动效` toggle lets you stop it.
- Display text uses the Google Fonts "Press Start 2P" with system-font fallbacks when offline.
