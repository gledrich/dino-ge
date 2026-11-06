# Dino GE

Dino GE is a TypeScript engine for 2D browser games with zero runtime dependencies. It provides scenes, physics, sprite animation and tile maps. The Playground lets you edit scripts and inspect scenes in the browser.

## Run locally

Use the Node.js version in [`.nvmrc`](.nvmrc). From the repository root:

```sh
npm ci
npm run build
npm run playground
```

Open [the Playground](http://localhost:3000). A new workspace starts with an editable copy of Amber Ruins.

To run the standalone examples, use `npm run example` after building:

- [Amber Ruins](http://localhost:3001/) — an exploration game. See the [game notes](packages/example/amber-ruins/README.md) for controls and implementation details.
- [Gameplay Foundations](http://localhost:3001/gameplay-foundations.html) — a short demo of Tiled maps, sprite animation and scripted sequences. See the [demo notes](packages/example/gameplay-foundations/README.md).
- [Bounded Camera Follow](http://localhost:3001/camera-bounds.html) — compare camera bounds and try named keyboard and controller bindings.
- [Dino Survival](http://localhost:3001/survival.html) and [Bouncy Physics](http://localhost:3001/bouncy.html) — smaller demos.

## Documentation

- [Engine package](packages/dino-ge/README.md) — install the engine and build your first game.
- [Playground package](packages/playground/README.md) — install the editor, manage scripts and import games.
- [Engine guide](docs/guide/index.md) — learn the engine through runnable examples. Run `npm run docs` to generate the API reference.

For development checks, run `npm run lint` and `npm test`.

[MIT licence](LICENSE)
