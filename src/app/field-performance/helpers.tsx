import { useState, useEffect } from 'react';
import React from 'react';

// ─── DESIGN TOKENS (matches Hub AR/Dispatch warm neutral palette) ─────────────
export const ACCENT   = '#5B9BE0';
export const BG_PAGE  = '#232329';
export const BG_CARD  = '#1C1C21';
export const BG_ALT   = '#232329';
export const BG_TILE  = '#232329';
export const BORDER   = '#2A2A30';
export const BORDER_MED = '#2A2A30';
export const TEXT_PRIMARY = '#F0EEE8';
export const TEXT_SECONDARY = '#908E85';
export const TEXT_MUTED = '#63615A';

// Team colors
export const TEAM_COLORS = {
  WP:  { bg: '#15263a', text: '#5B9BE0', border: '#2e4a6e' },
  PMP: { bg: '#143229', text: '#085041', border: '#2e5a4c' },
  IP:  { bg: '#241f36', text: '#5B1E7A', border: '#3a3357' },
};

// Score thresholds
export const SCORE_GREEN = { bg: '#143229', text: '#43B892', bar: '#43B892' };
export const SCORE_AMBER = { bg: '#352a16', text: '#DBA14E', bar: '#DBA14E' };
export const SCORE_RED   = { bg: '#361e1e', text: '#E57C7C', bar: '#E57C7C' };

export function scoreColors(score: number | null) {
  if (score === null || score === undefined) return { bg: BG_ALT, text: TEXT_MUTED, bar: BORDER };
  if (score >= 0.90) return SCORE_GREEN;
  if (score >= 0.75) return SCORE_AMBER;
  return SCORE_RED;
}

export function scoreBadge(score: number | null): React.ReactNode {
  if (score === null || score === undefined || isNaN(score) || score === 0) return <span style={{ color: TEXT_MUTED, fontSize: 12 }}>—</span>;
  const { bg, text } = scoreColors(score);
  return (
    <span style={{
      background: bg, color: text,
      fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 99,
      display: 'inline-block', letterSpacing: '0.01em',
      
    }}>
      {(score * 100).toFixed(1)}%
    </span>
  );
}

export function scoreBar(score: number | null, width = 72) {
  if (score === null || score === undefined || isNaN(score) || score === 0) return null;
  const pct = Math.min((score / 1.1) * 100, 100);
  const { bar } = scoreColors(score);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
      <div style={{ width, height: 6, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 3,
          background: `linear-gradient(90deg, ${bar}cc, ${bar})`,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

export function teamPill(team: string) {
  const s = TEAM_COLORS[team as keyof typeof TEAM_COLORS] || { bg: BG_TILE, text: TEXT_SECONDARY, border: BORDER };
  return (
    <span style={{
      background: s.bg, color: s.text,
      border: `0.5px solid ${s.border}`,
      fontSize: 10, fontWeight: 600,
      padding: '2px 7px', borderRadius: 99,
      letterSpacing: '0.03em',
    }}>
      {team}
    </span>
  );
}

export function statusPill(status: string) {
  const active = status === 'ACTIVE';
  return (
    <span style={{
      background: active ? '#143229' : '#361e1e',
      color: active ? '#43B892' : '#E57C7C',
      border: `0.5px solid ${active ? '#2e5a4c' : '#E57C7C'}`,
      fontSize: 10, fontWeight: 600,
      padding: '2px 7px', borderRadius: 99,
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function pctFmt(v: number | null) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(0) + '%';
}

// Card styles
export const card: React.CSSProperties = {
  background: BG_CARD,
  border: `0.5px solid ${BORDER}`,
  borderRadius: 12,
  marginBottom: 10,
  overflow: 'hidden',
};

export const cardHead: React.CSSProperties = {
  padding: '12px 16px 0',
  fontSize: 12,
  fontWeight: 600,
  color: TEXT_SECONDARY,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 10,
};

// Matches the cc DataTable header/cell styling (same as Stax, AR, Leads, etc.)
export const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: TEXT_SECONDARY,
  padding: '13px 16px',
  borderBottom: `1px solid ${BORDER}`,
  background: BG_ALT,
  whiteSpace: 'nowrap',
  letterSpacing: '0.05em',
};

export const td: React.CSSProperties = {
  padding: '13px 16px',
  borderBottom: `1px solid #2A2A30`,
  fontSize: 13.5,
  color: TEXT_PRIMARY,
  verticalAlign: 'middle',
};

export type Period =
  | { mode: 'week'; week: Date }
  | { mode: 'month'; month: number; year: number; monthStart: string; monthEnd: string };

// Build the querystring params for a period (week= OR monthStart=&monthEnd=).
export function periodParams(period?: Period): string {
  if (!period || period.mode === 'week') {
    const wk = period?.mode === 'week' ? period.week : null;
    return wk ? `week=${wk.toLocaleDateString('en-CA')}` : '';
  }
  return `monthStart=${encodeURIComponent(period.monthStart)}&monthEnd=${encodeURIComponent(period.monthEnd)}`;
}

// ─── REUSABLE COLUMN SORTING ──────────────────────────────────────────────────
// Usage in a tab:
//   const sort = useSort('score', 'desc');
//   const rows = sortRows(filtered, sort, { score: r => r.drivingScore, name: r => r.technician?.name });
//   <SortableTh sortKey="score" sort={sort} style={{ width: 110 }}>Driving score</SortableTh>
export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir; set: (key: string) => void; }

export function useSort(initialKey: string, initialDir: SortDir = 'desc'): SortState {
  const [key, setKey] = useState(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const set = (k: string) => {
    if (k === key) { setDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setKey(k); setDir('desc'); } // new column starts descending (high→low, the common case)
  };
  return { key, dir, set };
}

// accessors maps a sortKey -> function returning the comparable value for a row.
export function sortRows<T>(rows: T[], sort: SortState, accessors: Record<string, (r: T) => any>): T[] {
  const acc = accessors[sort.key];
  if (!acc) return rows;
  const mult = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = acc(a), vb = acc(b);
    // nulls/undefined always sort to the bottom regardless of direction
    const na = va === null || va === undefined, nb = vb === null || vb === undefined;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va).localeCompare(String(vb)) * mult;
    }
    return (va - vb) * mult;
  });
}

export function SortableTh({ sortKey, sort, children, style, align = 'left' }: {
  sortKey: string; sort: SortState; children: React.ReactNode;
  style?: React.CSSProperties; align?: 'left' | 'right' | 'center';
}) {
  const active = sort.key === sortKey;
  const arrow = !active ? '' : sort.dir === 'asc' ? ' ▲' : ' ▼';
  return (
    <th
      onClick={() => sort.set(sortKey)}
      title="Click to sort"
      style={{ ...th, textAlign: align, cursor: 'pointer', userSelect: 'none', color: active ? TEXT_PRIMARY : TEXT_SECONDARY, ...style }}
    >
      {children}<span style={{ fontSize: 9, color: ACCENT }}>{arrow}</span>
    </th>
  );
}

export function kpiTile(
  value: React.ReactNode,
  label: string,
  sub?: string,
  accent?: string
): React.ReactNode {
  return (
    <div style={{
      background: BG_CARD,
      border: `0.5px solid ${BORDER}`,
      borderLeft: `3px solid ${accent || BORDER_MED}`,
      borderRadius: 10,
      padding: '12px 16px',
    }}>
      <div style={{ fontSize: 11, color: TEXT_SECONDARY, marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, color: TEXT_PRIMARY, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function initials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

export function useApi<T>(url: string, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError('Failed to load'); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
