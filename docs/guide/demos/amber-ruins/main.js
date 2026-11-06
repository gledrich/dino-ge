import { addTouchArrows } from 'touch-arrows';

const status = document.querySelector('#status');
try {
  addTouchArrows();
  await import('amber-game');
} catch (error) {
  status.textContent = `Amber Ruins could not start: ${error.message}`;
  throw error;
}
