import { Engine, getViewportBounds, getViewportGeometry, Rectangle, snapToGrid, Vector2 } from 'dino-ge';

const status = document.querySelector('#status');
const pause = document.querySelector('#pause');
let marker;
let showBounds = false;

new Engine({
  onLoad() {
    marker = new Rectangle({
      tag: 'marker', position: new Vector2(73, 91), width: 76, height: 42, colour: '#578281',
    });
    status.textContent = 'Marker at (73, 91)';
  },
  drawUI(ui) {
    if (!showBounds) return;
    const { left, right, top, bottom } = getViewportBounds(getViewportGeometry(marker));
    ui.panel({ x: left, y: top, width: right - left, height: bottom - top }, '#ffc46f55');
  },
}, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });

pause.addEventListener('click', () => {
  Engine.paused = !Engine.paused;
  pause.textContent = Engine.paused ? 'Resume' : 'Pause';
  status.textContent = Engine.paused ? 'Paused' : 'Running';
});
document.querySelector('#bounds').addEventListener('click', () => {
  showBounds = !showBounds;
  status.textContent = showBounds ? 'Bounds shown' : 'Bounds hidden';
});
document.querySelector('#snap').addEventListener('click', () => {
  const position = marker.transform.position;
  position.set(snapToGrid(position.x, 32), snapToGrid(position.y, 32));
  status.textContent = `Marker at (${position.x}, ${position.y})`;
});
