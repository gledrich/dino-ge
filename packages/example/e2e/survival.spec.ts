import { expect, test } from '@playwright/test';

test('Survival uses transitions and emits its explosion through the engine particle emitter', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('/survival.html');
  await expect.poll(() => page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    return Engine.currentScene?.constructor.name;
  })).toBe('MenuScene');

  expect(await page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    Engine.emit('START_GAME');
    return Engine.currentScene?.constructor.name;
  })).toBe('MenuScene');
  await expect.poll(() => page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    return Engine.currentScene?.constructor.name;
  })).toBe('PlayScene');

  const result = await page.evaluate(async () => {
    const { Engine, Vector2, ParticleEmitter } = await import('/built/index.js');
    const scene = Engine.currentScene;
    Engine.paused = true;
    scene.spawnExplosion(new Vector2(200, 100), 10, 'gold');
    const emitter = [...scene.objects].find(object => object instanceof ParticleEmitter);
    return emitter?.activeCount;
  });

  expect(result).toBe(8);

  const lives = await page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    const scene = Engine.currentScene;
    scene.lives = 1;
    const meteor = { metadata: { tag: 'meteor' } };
    Engine.paused = false;
    scene.player.emit('collision', { other: meteor });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    scene.player.emit('collision', { other: meteor });
    return scene.lives;
  });
  expect(lives).toBe(0);
  await expect.poll(() => page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    return Engine.currentScene?.constructor.name;
  })).toBe('GameOverScene');
  expect(errors).toEqual([]);
});
