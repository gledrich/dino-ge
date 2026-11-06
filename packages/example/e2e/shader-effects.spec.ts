import { expect, test } from '@playwright/test';
import type Engine from '../../dino-ge/src/core/Engine.js';

declare global {
  interface Window {
    shaderTest?: { game: Engine; gl?: WebGL2RenderingContext; lose?: WEBGL_lose_context };
  }
}

test.skip(({ browserName }) => browserName !== 'chromium', 'Requires a Chromium software WebGL2 context');
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('composites GLSL pixels before the HUD and recovers after context loss', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      const context = Reflect.apply(getContext, this, [type, ...options]);
      if (type === 'webgl2' && context && window.shaderTest) {
        window.shaderTest.gl = context;
        window.shaderTest.lose = context.getExtension('WEBGL_lose_context');
      }
      return context;
    };
  });
  await page.goto('/bouncy.html');
  await page.evaluate(async () => {
    const { Engine, Rectangle, Vector2 } = await import('/built/index.js');
    Engine.terminateCurrent();
    Engine.resetState();

    const container = document.createElement('div');
    container.id = 'shader-test';
    container.style.cssText = 'width: 80px; height: 40px';
    document.body.append(container);

    const game = new Engine({
      onLoad: () => {
        new Rectangle({ position: new Vector2(0, 0), width: 64, height: 20, colour: '#ff0000' });
        new Rectangle({ position: new Vector2(0, 20), width: 64, height: 20, colour: '#0000ff' });
        const installed = game.setPostProcessShader({
          fragmentSource: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float amount;
out vec4 colour;
void main() {
vec4 source = texture(u_scene, v_uv);
colour = vec4(mix(source.rgb, source.bgr, amount), source.a);
if (v_uv.x > 0.8) colour = vec4(u_resolution.x / 100.0, 0.0, 0.0, 1.0);
}`,
          uniforms: { amount: 1 },
        });
        if (!installed.ok) throw new Error(installed.message);
      },
      drawUI: ui => ui.panel({ x: 4, y: 4, width: 10, height: 10 }, '#00ff00'),
    }, { containerId: container.id, backgroundColour: 'transparent' });
    window.shaderTest = { game };
  });

  const sample = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#shader-test canvas')!;
    const ctx = canvas.getContext('2d')!;
    const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    return {
      status: window.shaderTest?.game.postProcessStatus,
      top: pixel(24, 10), bottom: pixel(24, 30), hud: pixel(6, 6), right: pixel(canvas.width - 2, 10),
    };
  });
  const red = [255, 0, 0, 255];
  const blue = [0, 0, 255, 255];
  const green = [0, 255, 0, 255];
  const transparent = [0, 0, 0, 0];
  await expect.poll(sample).toEqual({
    status: 'active', top: blue, bottom: red, hud: green, right: [204, 0, 0, 255],
  });

  const invalid = await page.evaluate(() => window.shaderTest!.game.setPostProcessShader({
    fragmentSource: '#version 300 es\nvoid main() { not_glsl; }',
  }));
  expect(invalid).toMatchObject({ ok: false, reason: 'compile', message: expect.any(String) });
  await expect.poll(async () => (await sample()).top).toEqual(blue);

  await page.evaluate(() => window.shaderTest!.game.setPostProcessUniforms({ amount: 0.5 }));
  await expect.poll(async () => (await sample()).top.slice(0, 3)).toEqual([128, 0, 128]);
  await page.locator('#shader-test').evaluate(node => { node.style.width = '100px'; });
  await expect.poll(async () => (await sample()).right).toEqual(red);

  await page.evaluate(() => window.shaderTest!.lose!.loseContext());
  await expect.poll(sample).toEqual({
    status: 'context-lost', top: red, bottom: blue, hud: green, right: transparent,
  });
  const invalidDuringLoss = await page.evaluate(() => {
    try {
      window.shaderTest!.game.setPostProcessUniforms({ amount: [0, 1] });
      return false;
    } catch (error) {
      return error instanceof TypeError;
    }
  });
  expect(invalidDuringLoss).toBe(true);
  await page.evaluate(() => {
    window.shaderTest!.game.setPostProcessUniforms({ amount: 1 });
    window.shaderTest!.lose!.restoreContext();
  });
  await expect.poll(sample).toEqual({
    status: 'active', top: blue, bottom: red, hud: green, right: red,
  });

  await page.evaluate(() => window.shaderTest!.game.setPostProcessShader(null));
  await expect.poll(sample).toEqual({
    status: 'disabled', top: red, bottom: blue, hud: green, right: transparent,
  });
  expect(errors).toEqual([]);
});

test('uses Canvas for an origin-restricted image and retries after removal', async ({ page }) => {
  await page.route('http://shader-foreign.test/sprite.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path fill="blue" d="M0 0h16v16H0z"/></svg>',
  }));
  await page.goto('/bouncy.html');
  await page.evaluate(async () => {
    const { Engine, Sprite } = await import('/built/index.js');
    Engine.terminateCurrent();
    Engine.resetState();
    const image = new Image();
    image.src = 'http://shader-foreign.test/sprite.svg';
    await image.decode();

    const game = new Engine({
      onLoad: () => {
        new Sprite({ tag: 'foreign', img: image, rows: 1, cols: 1 }).play();
        const installed = game.setPostProcessShader({
          fragmentSource: `#version 300 es
precision highp float;
out vec4 colour;
void main() { colour = vec4(0.0, 1.0, 0.0, 1.0); }`,
        });
        if (!installed.ok) throw new Error(installed.message);
      },
    }, { width: '80px', height: '40px' });
    window.shaderTest = { game };
  });

  const status = () => page.evaluate(() => window.shaderTest?.game.postProcessStatus);
  await expect.poll(status).toBe('source-security');
  const wasTainted = await page.locator('#canvas').evaluate(canvas => {
    try {
      (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(1, 1, 1, 1);
      return false;
    } catch (error) {
      return error instanceof DOMException && error.name === 'SecurityError';
    }
  });
  expect(wasTainted).toBe(true);

  await page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    for (const object of Engine.objects.findAll('foreign')) Engine.destroyObject(object);
  });
  await expect.poll(status).toBe('active');
});

test('the standalone demo exposes its Canvas fallback and shader toggle', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      return type === 'webgl2' ? null : Reflect.apply(getContext, this, [type, ...options]);
    };
  });
  await page.goto('/shader-effects.html');
  await expect(page.getByRole('heading', { name: 'World shaders' })).toBeVisible();
  const status = page.getByRole('status');
  const toggle = page.getByRole('button', { name: 'World shader' });
  await expect(status).toContainText('Canvas fallback');
  await toggle.click();
  await expect(status).toHaveText('World shader off.');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
