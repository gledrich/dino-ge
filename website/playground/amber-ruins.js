import { addTouchArrows } from './touch-arrows.js';

try {
  addTouchArrows();
  await import('/templates/amber-ruins/game.js');
} catch (error) {
  const message = document.querySelector('#standalone-game-error');
  message.textContent = 'Amber Ruins could not load. Reload the page to try again.';
  message.hidden = false;
  console.error('Could not start Amber Ruins', error);
}
