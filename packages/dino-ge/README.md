# dino-ge

A TypeScript engine for 2D browser games with zero runtime dependencies. It provides scenes, physics, sprite animation and Tiled map import.

**Beta preview.** APIs and workflows may change.

## Install

```sh
npm install dino-ge@beta
```

## Draw your first scene

In a browser project with a bundler, add a container to your HTML:

```html
<div id="game" style="width: 100%; height: 240px"></div>
```

Load this code from your project's JavaScript or TypeScript entry point:

```ts
import { Circle, Engine, Scene, Vector2 } from 'dino-ge';

class Clearing extends Scene {
  onLoad() {
    this.add(new Circle({
      position: new Vector2(80, 80),
      radius: 16,
      colour: '#ffc46f',
    }));
  }
}

new Engine({
  onLoad() {
    Engine.currentScene = new Clearing();
  },
}, { containerId: 'game', width: '100%', height: '100%' });
```

## World shaders

`game.setPostProcessShader({ fragmentSource, uniforms })` adds a GLSL ES 3.00
fragment pass to the Canvas-rendered world. The shader can sample the scene
through `u_scene` and read the backing resolution and game time from
`u_resolution` and `u_time`. Use `setPostProcessUniforms()` to update custom
float or vector uniforms and `setPostProcessShader(null)` to disable the pass.
The Canvas world remains visible when WebGL2 cannot apply the shader. See the
[HUD and effects guide](../../docs/guide/hud-audio-and-effects.md) for a shader
and a local demo.

## Learn more

- [Engine guide](../../docs/guide/index.md) covers scenes, physics, animation, input, tile maps, audio and effects.
- [Gameplay Foundations](../example/gameplay-foundations/README.md) shows layered Tiled maps, named sprite clips and object actions working together.
- [Dino GE Playground](https://www.npmjs.com/package/dino-ge-playground) lets you edit scripts and inspect scenes in the browser.

Run `npm run docs` from the repository root to generate the API reference in `docs/api/`.

MIT licence.
