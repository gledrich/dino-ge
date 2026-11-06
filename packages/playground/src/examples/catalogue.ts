import animation from './animation-and-actions.js?raw';
import camera from './camera-and-input.js?raw';
import collision from './colliders-and-rays.js?raw';
import tiled from './tiled-and-assets.js?raw';
import shader from './world-shaders.js?raw';
import map from '../../../example/gameplay-foundations/relay-room.tmj?raw';
import floor from '../../../example/gameplay-foundations/floor.svg?raw';
import relay from '../../../example/gameplay-foundations/relay.svg?raw';
import tileset from '../../../example/gameplay-foundations/tiles/relay.tsj?raw';
import chime from '../../../example/amber-ruins/assets/pickup.wav?inline';

interface EngineExample {
  id: string;
  label: string;
  source: string;
  assets?: () => { path: string; file: File }[];
}

export const engineExamples: readonly EngineExample[] = [
  { id: 'animation-and-actions', label: 'Animation and actions', source: animation },
  { id: 'camera-and-input', label: 'Camera and input', source: camera },
  { id: 'colliders-and-rays', label: 'Colliders and raycasts', source: collision },
  {
    id: 'tiled-and-assets', label: 'Tiled maps and assets', source: tiled,
    assets: () => [
      { path: 'relay-room.tmj', file: new File([map], 'relay-room.tmj', { type: 'application/json' }) },
      { path: 'floor.svg', file: new File([floor], 'floor.svg', { type: 'image/svg+xml' }) },
      { path: 'relay.svg', file: new File([relay], 'relay.svg', { type: 'image/svg+xml' }) },
      { path: 'tiles/relay.tsj', file: new File([tileset], 'relay.tsj', { type: 'application/json' }) },
      { path: 'pickup.wav', file: new File([Uint8Array.from(atob(chime.split(',')[1]), byte => byte.charCodeAt(0))],
        'pickup.wav', { type: 'audio/wav' }) },
    ],
  },
  { id: 'world-shaders', label: 'World shaders', source: shader },
];
