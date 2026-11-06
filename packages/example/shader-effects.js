import { Circle, Engine, Rectangle, Vector2 } from 'dino-ge';

const fragmentSource = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_time;
uniform float strength;
out vec4 colour;

void main() {
  vec4 scene = texture(u_scene, v_uv);
  float band = 0.5 + 0.36 * sin(u_time * 1.4);
  float distanceInPixels = abs(v_uv.x - band) * u_resolution.x;
  float glow = (1.0 - smoothstep(0.0, 42.0, distanceInPixels)) * 0.22;
  vec3 shifted = scene.bgr + vec3(glow);
  colour = vec4(mix(scene.rgb, shifted, strength), scene.a);
}`;

const button = document.getElementById('toggle');
const strength = document.getElementById('strength');
const status = document.getElementById('status');
document.getElementById('source').textContent = fragmentSource;

let enabled = true;
let installationMessage;

function configureShader() {
  const result = game.setPostProcessShader(enabled
    ? { fragmentSource, uniforms: { strength: Number(strength.value) } }
    : null);
  installationMessage = result.ok ? undefined : result.message;
}

function showStatus() {
  const state = game.postProcessStatus;
  const text = installationMessage ? `Canvas fallback. ${installationMessage}`
    : state === 'active' ? 'World shader active.'
    : state === 'disabled' ? 'World shader off.'
    : `Canvas fallback (${state}).`;
  if (status.textContent !== text) status.textContent = text;
}

const game = new Engine({
  onLoad() {
    const band = (y, colour) => new Rectangle({
      position: new Vector2(0, y), width: 480, height: 110, colour,
    });
    band(0, '#ba4b3e');
    band(110, '#3c6dbe');
    for (const [index, x] of [32, 103, 174, 245, 316, 387].entries()) {
      new Circle({
        position: new Vector2(x, 82 + 14 * (index % 2)),
        radius: 20, colour: '#f2bd68', zIndex: 1,
      });
    }
    button.disabled = false;
    configureShader();
    showStatus();
  },
  update: showStatus,
  drawUI: ui => ui.panel({ x: 12, y: 12, width: 38, height: 9 }, '#fff'),
}, { containerId: 'world', backgroundColour: '#273d46' });

button.addEventListener('click', () => {
  enabled = !enabled;
  button.setAttribute('aria-pressed', String(enabled));
  configureShader();
  showStatus();
});
strength.addEventListener('input', () => {
  game.setPostProcessUniforms({ strength: Number(strength.value) });
});
