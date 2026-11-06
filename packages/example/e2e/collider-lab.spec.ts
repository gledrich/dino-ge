import { expect, test } from '@playwright/test';

test('casts against a compound collider and moves a probe through a sensor', async ({ page }) => {
  await page.clock.install();
  await page.goto('/collider-lab.html');
  await expect(page.getByRole('heading', { name: 'Collider lab' })).toBeVisible();
  const ray = page.locator('#ray-result');
  await expect(ray).toHaveText('Ray hits the relay first. 2 fixture hits.');

  await page.getByRole('checkbox', { name: 'Include sensors' }).check();
  await expect(ray).toHaveText('Ray hits the sensor first. 3 fixture hits.');

  const aim = page.getByRole('slider', { name: 'Ray target height' });
  await aim.press('Home');
  await expect(ray).toHaveText('Ray misses every fixture.');

  await page.getByRole('button', { name: 'Launch probe' }).click();
  await page.clock.runFor(460);
  const probe = page.locator('#probe-result');
  await expect(probe).toHaveText('Probe crossed the sensor.');
  await page.clock.runFor(700);
  await expect(probe).toHaveText('Probe reached the relay.');
});
