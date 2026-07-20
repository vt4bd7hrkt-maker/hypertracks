// Y2K / hyperpop track-name generator. Purely cosmetic, but naming each
// generation makes every beat feel like a found object instead of output #47.

const A = [
  'angel', 'crystal', 'heaven', 'pixel', 'glitter', 'cyber', 'cherry',
  'chrome', 'milky', 'star', 'bubble', 'neon', 'ghost', 'candy', 'velvet',
  'plastic', 'diamond', 'hologram', 'sugar', 'laser', 'dolphin', 'baby',
  'mirror', 'cloud', 'ice', 'satin', 'electric', 'lucid', 'vapor', 'gel',
];

const B = [
  'tears', 'dust', 'heart', 'rush', 'dream', 'wave', 'sky', 'luv',
  'forever', 'gloss', 'juice', 'core', 'fairy', 'drip', 'halo', 'spark',
  'bloom', 'crash', 'girl', 'boy', 'angel', 'world', 'garden', 'static',
];

const TAIL = ['2000', '99', 'xtc', '.exe', '4u', '∞', '2k', 'ultra', 'v2', 'fm'];

export function makeName(rng) {
  const a = rng.pick(A);
  let b = rng.pick(B);
  while (b === a) b = rng.pick(B);
  let name = `${a} ${b}`;
  if (rng.chance(0.45)) name += ` ${rng.pick(TAIL)}`;
  return name;
}
