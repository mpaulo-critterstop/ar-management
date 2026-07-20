import { useState, useEffect } from 'react';
import React from 'react';

// ─── DESIGN TOKENS (matches Hub AR/Dispatch warm neutral palette) ─────────────
export const ACCENT   = '#0052cc';
export const BG_PAGE  = '#F0F2F5';
export const BG_CARD  = '#ffffff';
export const BG_ALT   = '#F8F7F4';
export const BG_TILE  = '#F1EFE8';
export const BORDER   = '#E8E7E3';
export const BORDER_MED = '#D3D1C7';
export const TEXT_PRIMARY = '#2C2C2A';
export const TEXT_SECONDARY = '#888780';
export const TEXT_MUTED = '#b0aea6';

// Team colors
export const TEAM_COLORS = {
  WP:  { bg: '#E6F0FB', text: '#0C447C', border: '#B8D4F5' },
  PMP: { bg: '#E1F5EE', text: '#085041', border: '#9ADEC8' },
  IP:  { bg: '#F5EBF9', text: '#5B1E7A', border: '#D4AAEC' },
};

// Score thresholds
export const SCORE_GREEN = { bg: '#EAFBF0', text: '#0A5C2A', bar: '#22C55E' };
export const SCORE_AMBER = { bg: '#FEF6E4', text: '#7A4500', bar: '#F59E0B' };
export const SCORE_RED   = { bg: '#FEF0F0', text: '#7A1A1A', bar: '#EF4444' };

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
      background: active ? '#EAFBF0' : '#FEF0F0',
      color: active ? '#0A5C2A' : '#7A1A1A',
      border: `0.5px solid ${active ? '#9ADEC8' : '#F5A0A0'}`,
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
  fontSize: 11,
  fontWeight: 500,
  color: TEXT_SECONDARY,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 10,
};

export const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 500,
  color: TEXT_SECONDARY,
  padding: '7px 12px',
  borderBottom: `0.5px solid ${BORDER}`,
  background: BG_ALT,
  whiteSpace: 'nowrap',
  letterSpacing: '0.02em',
};

export const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: `0.5px solid #F3F2EF`,
  fontSize: 13,
  color: TEXT_PRIMARY,
  verticalAlign: 'middle',
};

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
