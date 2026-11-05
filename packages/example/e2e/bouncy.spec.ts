import { expect, test } from '@playwright/test';

test('Bouncy Physics runs with hundreds of colliders', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('/bouncy.html');

  await expect.poll(() => page.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    return [...Engine.objects].filter(object => object.metadata.tag === 'bumper').length;
  })).toBe(216);

  await page.evaluate(async () => {
    const { Engine, PhysicsComponent } = await import('/built/index.js');
    const ball = [...Engine.objects].find(object => object.metadata.tag === 'bouncy-ball');
    ball.transform.position.set(195, 60);
    ball.getComponent(PhysicsComponent).velocity.set(0, 150);
    ball.on('collision', event => {
      if (event.detail.other.metadata.tag === 'bumper') document.body.dataset.bumperContact = 'yes';
    });
  });
  await expect(page.locator('body')).toHaveAttribute('data-bumper-contact', 'yes');
  expect(errors).toEqual([]);
});
