export function addTouchArrows() {
  if (!matchMedia("(pointer: coarse)").matches) return;
  const controls = document.createElement("div");
  controls.className = "touch-arrows";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Touch movement");
  for (const [direction, symbol] of [["Left", "←"], ["Up", "↑"], ["Down", "↓"], ["Right", "→"]]) {
    const button = document.createElement("button");
    const key = "Arrow" + direction;
    button.type = "button";
    button.textContent = symbol;
    button.setAttribute("aria-label", "Move " + direction.toLowerCase());
    let pressedAt = 0;
    let releaseTimer;
    const send = type => document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    const release = () => {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => send("keyup"), Math.max(0, 150 - (performance.now() - pressedAt)));
    };
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      clearTimeout(releaseTimer);
      pressedAt = performance.now();
      send("keydown");
    });
    button.addEventListener("lostpointercapture", release);
    controls.append(button);
  }
  document.body.append(controls);
}
