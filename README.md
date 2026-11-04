# Dino GE: Dino Game Engine

A lightweight, developer-friendly 2D game engine built with TypeScript, designed for building expressive web-based games.

See [dino-ge](./packages/dino-ge//README.md) and [dino-ge-playground](./packages/playground/README.md).

**Beta preview.** APIs and workflows may change during the beta.

## Core Features

- **Entity Component System (ECS):** Flexible, composition-based architecture using Entities (GameObjects), Components (Data), and Systems (Logic).
- **Hierarchical Transform System:** Supports complex parent-child relationships with nested position, rotation, and scaling.
- **Decoupled Systems:** Dedicated `PhysicsSystem` and `RenderingSystem` for modular game logic.
- **Built-in Physics:** Impulse-based resolution with support for AABB and Circle collision primitives.
- **Scene Management:** Easily switch between game states.
- **Asset Loader:** Simplified loading for images and textures.
- **TypeScript Native:** Full type safety out of the box.

## Playground Features

The Dino GE playground provides a robust environment to prototype and test game logic live:

- **Live Code Editor:** Modify your game logic in the browser with an integrated code editor.
- **Property Inspector:** Toggle the UI to inspect and adjust game object properties in real-time.
- **Debug Mode:** Visualize collision boxes and engine state by clicking the bug icon.
- **Hot Refresh:** Quickly apply changes to your code (`Ctrl + Enter` or click the refresh icon).
- **Play/Pause Controls:** Easily manage the engine state during development.

## Get Started

### Installation

Use Node.js 26.13.0 LTS from `.nvmrc` for local development.

```bash
git clone https://github.com/gledrich/dino-ge.git
cd dino-ge
npm install
```

### Run the Playground

Explore the engine capabilities in the interactive playground:

```bash
npm run playground
```

Once running, access it at [http://localhost:3000](http://localhost:3000).

### Development

Run `npm run build -w dino-ge` and then `npm run example` to play **Amber Ruins**
at [http://localhost:3001](http://localhost:3001). Use WASD, the arrow keys or
a standard gamepad's left stick to explore three tiled rooms, avoid the spike
traps and bring three amber relics to the vault gate. The game includes music,
sound effects and independent volume controls.

The [example workspace](./packages/example/amber-ruins/README.md) describes
the assets and the engine APIs the game uses. The original Dino Survival demo
is still available at `/survival.html`.

_Note: The engine handles initialization; create your game instance directly in your entry file._

## Documentation

Comprehensive API documentation is available [here](https://gledrich.github.io/dino-ge/index.html).
