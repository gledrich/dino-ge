# dino-ge

A lightweight, performant 2D game engine built from the ground up in TypeScript. `dino-ge` provides a robust, developer-friendly framework for building 2D web games. Friend of [dino-ge-playground](https://www.npmjs.com/package/dino-ge-playground).

**Beta preview.** APIs and workflows may change during the beta.

## Features

- **Composition-based ECS:** Built around a flexible Entity Component System for modular game design.
- **Hierarchical Transform System:** Supports complex parent-child relationships with nested position, rotation, and scaling.
- **Pixel-Perfect Sprite Animation:** Efficiently handles spritesheets with automatic frame calculation and smooth playback.
- **Robust 2D Physics:** Impulse-based resolution with support for AABB and Circle collision primitives.
- **Customisable Camera:** Built-in support for following targets, world-to-viewport coordinate mapping, and smooth zooming.
- **Playground Integration:** Seamlessly compatible with the Dino GE Playground for rapid prototyping and live editing.

## Installation

```bash
npm install dino-ge@beta
```

## Beta game APIs

- `Tilemap.fromTiled(map, { tileset, position })` imports a finite orthogonal Tiled
  JSON map with one embedded tileset, square tiles and one unencoded tile layer.
  Pass the loaded tileset image or its loader tag as `tileset`.
- `Input.getGamepad()` returns the first connected standard gamepad, or `null`.
  `Input.getGamepadAxes()` returns its left stick as a `Vector2` with a 0.2
  dead zone on each axis. Both methods accept an optional gamepad index.
- Call `await Sound.unlock()` from a user gesture. Use `Sound.load(url)` to
  decode audio, `sound.play()` for effects, and
  `sound.play({ loop: true, channel: 'music' })` for a music loop.
  Playback returns a stop function. `Sound.setVolume(channel, level)` controls
  the `master`, `music` or `effects` channel between zero and one.
- Pass `drawUI(ui)` to `Engine` to draw a screen-space interface over the world.
  The game supplies the state and actions. `ScreenUI` provides anchors,
  labels, panels, images, keyboard- and pointer-activated buttons, and
  progress bars. The `onDispose` callback can release game resources on reset.

## Quick Start

```typescript
import { Engine, Sprite, Vector2 } from 'dino-ge';

class MyGame {
  constructor() {
    new Engine(
      {
        onLoad: () => this.onLoad(),
        update: () => this.onUpdate()
      },
      {
        title: 'My Game',
        width: '100%',
        height: '100%'
      }
    );
  }

  onLoad() {
    const player = new Sprite({
      tag: 'player',
      img: 'player', // Asset tag from ResourceLoader
      rows: 1,
      cols: 4,
      position: new Vector2(400, 300),
      zIndex: 10,
      scale: 3
    });
    player.play();
  }

  onUpdate() {
    // Game logic here
  }
}
```

## Documentation

Full API documentation and guides are available at [https://gledrich.github.io/dino-ge/index.html](https://gledrich.github.io/dino-ge/index.html).

## License

Dino GE is released under the MIT License.

### Particle bursts

Create a `ParticleEmitter` while a scene is active to keep its visual effects
with that scene. Each burst starts at a world-space position and uses seconds
for its lifetime. The emitter caps the number of live particles and advances
them on the engine's fixed step.

```ts
const sparks = new ParticleEmitter({ capacity: 128, zIndex: 10 });
sparks.burst(new Vector2(120, 80), {
  count: 8,
  velocity: index => new Vector2((index - 3.5) * 20, -80),
  gravity: new Vector2(0, 160),
  lifetime: 0.4,
  startRadius: 4,
  endRadius: 0,
  colour: '#ffcf64',
});
```
