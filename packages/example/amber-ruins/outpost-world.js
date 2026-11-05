const lanternreach = {
  name: 'Lanternreach',
  subtitle: 'THE LAST LIGHT ON THE MARSH',
  terrain: [
    '~~~~~~~~~~~~~',
    '~~~~~~gggg~~~',
    '~~~~~~ggggb~~',
    '~gggggggggbg~',
    '~gggggpppppg~',
    '~ggppppppppp~',
    '~ggpggpgpggg~',
    '~ggggggggggg~',
    '~~~~~~~~~~~~~',
  ],
  props: [
    ['tree', 1, 3], ['tree', 3, 3], ['tree', 6, 2], ['tree', 1, 7],
    ['cabin', 4, 4], ['keeper', 9, 5], ['lantern', 6, 4],
    ['lantern', 8, 6], ['tree', 11, 7], ['post', 10, 3],
  ],
  exits: [
    [11, 5, 'reedbank', 2, 5],
    [10, 2, 'skywell', 6, 6],
  ],
  actions: [
    [9, 5, 'Talk to Iona', 'keeper'],
    [10, 3, 'Inspect the bridge', 'bridge'],
    [4, 5, 'Rest at the cabin', 'rest'],
  ],
};

const reedbank = {
  name: 'The Reedbank',
  subtitle: 'WHERE THE RIVER KEEPS ITS SECRETS',
  terrain: [
    '~~~~~~~~~~~~~',
    '~~~~~~ggg~~~~',
    '~~~~gggggg~~~',
    '~~gggpgpggg~~',
    '~~ggppppppg~~',
    '~ppppppppgg~~',
    '~~gpg~ggg~~~~',
    '~~~gg~~~~gg~~',
    '~~~~~~~~~~~~~',
  ],
  props: [
    ['reeds', 1, 4], ['tree', 3, 3], ['reeds', 2, 6], ['reeds', 5, 6],
    ['wood', 4, 5], ['reeds', 7, 6], ['tree', 8, 2], ['reeds', 10, 4],
    ['flowers', 7, 3], ['arch', 6, 4], ['scout', 8, 4], ['reeds', 9, 7],
  ],
  exits: [
    [1, 5, 'lanternreach', 10, 5],
    [6, 5, 'archive', 2, 5],
  ],
  actions: [
    [4, 5, 'Gather reedwood', 'wood'],
    [7, 3, 'Gather moonbells', 'flowers'],
    [8, 4, 'Talk to Tern', 'scout'],
  ],
};

const archive = {
  name: 'The Sunken Archive',
  subtitle: 'THE WATER TOOK EVERYTHING BUT THE STARS',
  terrain: [
    '#############',
    '#ss#ssss#s###',
    '#ss#s~^~#s###',
    '#sssssss#sss#',
    '##ssssss#sss#',
    '#sssss^s|sss#',
    '###ss^^s#sss#',
    '#sssssss#s###',
    '#############',
  ],
  props: [
    ['arch', 1, 4], ['lantern', 3, 5], ['post', 4, 5], ['arch', 8, 5],
    ['plinth', 10, 5], ['lantern', 9, 2], ['lantern', 9, 6], ['post', 10, 4],
    ['reeds', 2, 2], ['reeds', 4, 7],
  ],
  exits: [[1, 5, 'reedbank', 5, 5]],
  actions: [
    [4, 5, 'Open the sluice', 'sluice'],
    [10, 5, 'Lift the amber lens', 'lens'],
    [10, 4, 'Read the field notes', 'notes'],
  ],
};

const skywell = {
  name: 'The Skywell',
  subtitle: 'A PLACE TO LEAVE A LIGHT',
  terrain: [
    '~~~~~~~~~~~~~',
    '~~~sssssss~~~',
    '~~ssggggsss~~',
    '~~sggsgggss~~',
    '~~sgssssgss~~',
    '~~gggsgggg~~~',
    '~~~ggsggg~~~~',
    '~~~~bsb~~~~~~',
    '~~~~~~~~~~~~~',
  ],
  props: [
    ['tree', 3, 2], ['tree', 9, 2], ['tree', 2, 4], ['tree', 10, 4],
    ['lantern', 4, 4], ['lantern', 8, 4], ['beacon', 6, 4],
    ['flowers', 4, 6], ['flowers', 8, 6], ['arch', 6, 6],
  ],
  exits: [[6, 7, 'lanternreach', 10, 3]],
  actions: [[6, 4, 'Light the beacon', 'beacon']],
};

export const maps = { lanternreach, reedbank, archive, skywell };
export const tiles = { g: 0, p: 1, '~': 2, s: 3, '#': 4, b: 5, '^': 6, broken: 7 };
export const propFrames = {
  tree: 0, cabin: 1, keeper: 2, lantern: 3, reeds: 4, wood: 5,
  arch: 6, plinth: 7, post: 8, beacon: 9, lit: 10, flowers: 11, scout: 12,
};

const key = 'amber-ruins.chapter.v1';
const flags = ['wood', 'sluice', 'lens', 'bridge', 'beacon', 'flowers', 'gift', 'notes'];

export function readChapter() {
  try {
    const data = JSON.parse(window.localStorage.getItem(key));
    if (data && flags.every(flag => typeof data[flag] === 'boolean') &&
        (!data.beacon || data.bridge) && (!data.bridge || data.wood && data.lens) &&
        (!data.lens || data.sluice) && (!data.gift || data.flowers)) return data;
  } catch {
    // Storage may be disabled or contain a partially written save.
  }
  return null;
}

export function newChapter() {
  return Object.fromEntries(flags.map(flag => [flag, false]));
}

export function saveChapter(progress) {
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
