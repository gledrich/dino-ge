# Examples

[Documentation](index.html) · [Core engine guide](guide/index.html)

## Example games

Run these examples from a clone of the repository. From its root, run:

```sh
npm ci
npm run build -w dino-ge
npm run example
```

| Example | What it demonstrates | Run locally | GitHub source |
| --- | --- | --- | --- |
| Amber Ruins · Lanternreach | Exploration, interactions, a journal and browser saves | `http://localhost:3001/` | [Chapter logic](https://github.com/gledrich/dino-ge/blob/main/packages/example/amber-ruins/outpost.js) · [Maps and saves](https://github.com/gledrich/dino-ge/blob/main/packages/example/amber-ruins/outpost-world.js) |
| Amber Ruins · Original expedition | Tiled maps, room cameras, relics, hazards and a HUD | `http://localhost:3001/?expedition` | [Expedition logic](https://github.com/gledrich/dino-ge/blob/main/packages/example/amber-ruins/game.js) · [Assets and setup](https://github.com/gledrich/dino-ge/tree/main/packages/example/amber-ruins) |
| Bouncy Physics | Dynamic and static bodies, collisions and bounce | `http://localhost:3001/bouncy.html` | [JavaScript](https://github.com/gledrich/dino-ge/blob/main/packages/example/bouncy.js) · [HTML](https://github.com/gledrich/dino-ge/blob/main/packages/example/bouncy.html) |
| Dino Survival | Shooting, collision events, particles and scene transitions | `http://localhost:3001/survival.html` | [JavaScript](https://github.com/gledrich/dino-ge/blob/main/packages/example/index.js) · [HTML](https://github.com/gledrich/dino-ge/blob/main/packages/example/survival.html) |

Both versions of Amber Ruins are also [playable in the guide](guide/amber-ruins.html).

## Core guide demos

| Example | GitHub source |
| --- | --- |
| [Build a first scene](guide/first-scene.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/first-scene) |
| [Compose objects with components](guide/objects-and-components.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/objects-and-components) |
| [Draw and animate sprites](guide/drawing-and-animation.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/drawing-and-animation) |
| [Read input and walk a tilemap](guide/input-and-tilemaps.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/input-and-tilemaps) |
| [Move the camera and switch scenes](guide/camera-and-scenes.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/camera-and-scenes) |
| [Simulate bodies and collisions](guide/physics-and-collisions.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/physics-and-collisions) |
| [Add a HUD, audio and effects](guide/hud-audio-and-effects.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/hud-audio-and-effects) |
| [Debug and inspect a scene](guide/debugging-and-tools.html) | [Demo source](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/debugging-and-tools) |
| [Read and play Amber Ruins](guide/amber-ruins.html) | [Demo entry point](https://github.com/gledrich/dino-ge/tree/main/docs/guide/demos/amber-ruins) |

## Website quickstart demos

- First scene draws a circle in an engine canvas. [JavaScript](https://github.com/gledrich/dino-ge/blob/main/website/docs/first-scene.js)
- Collect a relic adds keyboard movement and a pickup. [JavaScript](https://github.com/gledrich/dino-ge/blob/main/website/docs/collect-a-relic.js) · [HTML](https://github.com/gledrich/dino-ge/blob/main/website/docs/collect-a-relic.html)
