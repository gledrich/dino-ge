import { expect, test } from '@playwright/test';

test('Survival emits its explosion through the engine particle emitter', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('/survival.html');
  await expect.poll(() => page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    return Engine.currentScene?.constructor.name;
  })).toBe('MenuScene');

  const result = await page.evaluate(async () => {
    const { Engine, Vector2, ParticleEmitter } = await import('/built/index.js');
    Engine.emit('START_GAME');
    const scene = Engine.currentScene;
    Engine.paused = true;
    scene.spawnExplosion(new Vector2(200, 100), 10, 'gold');
    const emitter = [...scene.objects].find(object => object instanceof ParticleEmitter);
    return emitter?.activeCount;
  });

  expect(result).toBe(8);
  expect(errors).toEqual([]);
});
