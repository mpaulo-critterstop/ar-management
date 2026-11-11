// Command Center design tokens — the single source of truth for the Hub's redesigned (dark) UI.
// Every cc/* component reads from here, so changing the look in one place updates every module.

export const cc = {
  // surfaces
  bg: '#121216',
  panel: '#1C1C21',
  panel2: '#232329',
  elev: '#2A2A31',
  // text
  ink: '#F0EEE8',
  ink2: '#C9C7BF',
  muted: '#908E85',
  faint: '#63615A',
  // lines
  line: '#2A2A30',
  line2: '#35353C',
  // accents
  blue: '#5B9BE0', bluebg: '#15263a',
  green: '#43B892', greenbg: '#143229',
  amber: '#DBA14E', amberbg: '#352a16',
  red: '#E57C7C', redbg: '#361e1e',
  violet: '#9D8BE6', violetbg: '#241f36',
  // radii
  r: 14, r2: 10, r3: 8,
  // avatar palette (deterministic by name)
  avatars: ['#5B9BE0', '#43B892', '#C77D3A', '#9D8BE6', '#C85A5A', '#2E7D7D', '#9A5B2E', '#5B5BA3'],
} as const;

export const avatarColor = (s: string) =>
  cc.avatars[[...String(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % cc.avatars.length];

export const initials = (n: string) =>
  String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

// money helpers
export const money = (n: number) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moneyK = (n: number) => {
  const v = Number(n || 0);
  return Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(v).toLocaleString();
};

export type Tone = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'neutral';
export const toneColors = (t: Tone): { fg: string; bg: string } => {
  switch (t) {
    case 'green': return { fg: cc.green, bg: cc.greenbg };
    case 'blue': return { fg: cc.blue, bg: cc.bluebg };
    case 'amber': return { fg: cc.amber, bg: cc.amberbg };
    case 'red': return { fg: cc.red, bg: cc.redbg };
    case 'violet': return { fg: cc.violet, bg: cc.violetbg };
    default: return { fg: cc.muted, bg: cc.panel2 };
  }
};
