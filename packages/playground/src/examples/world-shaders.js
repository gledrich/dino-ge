import { Engine, Rectangle, Vector2 } from 'dino-ge';

const fragmentSource = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform float strength;
out vec4 colour;
void main() {
  vec4 source = texture(u_scene, v_uv);
  colour = vec4(mix(source.rgb, source.bgr, strength), source.a);
}`;

let enabled = false;
let strength = 1;

function toggleShader() {
  if (enabled) {
    game.setPostProcessShader(null);
    enabled = false;
  } else {
    enabled = game.setPostProcessShader({ fragmentSource, uniforms: { strength } }).ok;
  }
}

const game = new Engine({
  onLoad() {
    new Rectangle({
      tag: 'Shader swatch',
      position: new Vector2(20, 110),
      width: 220,
      height: 80,
      colour: '#e57459',
    });
    toggleShader();
  },
  drawUI(ui) {
    ui.button({ id: 'toggle', x: 12, y: 12, width: 138, height: 34, text: 'Toggle shader', onPress: toggleShader });
    ui.button({
      id: 'strength', x: 158, y: 12, width: 138, height: 34, text: 'Change strength',
      onPress: () => {
        strength = strength === 1 ? 0.5 : 1;
        if (enabled) game.setPostProcessUniforms({ strength });
      },
    });
    ui.label({ x: 12, y: 63, text: 'Shader status: ' + game.postProcessStatus });
  },
}, { containerId: 'playground-canvas-container', backgroundColour: '#162b32' });
