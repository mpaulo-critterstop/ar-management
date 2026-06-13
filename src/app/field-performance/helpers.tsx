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
  if (score === null || score === undefined) return <span style={{ color: TEXT_MUTED, fontSize: 12 }}>—</span>;
  const { bg, text } = scoreColors(score);
  return (
    <span style={{
      background: bg, color: text,
      fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 99,
      display: 'inline-block', letterSpacing: '0.01em',
      fontFamily: 'var(--font-mono-data, "DM Mono", monospace)',
    }}>
      {(score * 100).toFixed(1)}%
    </span>
  );
}

export function scoreBar(score: number | null, width = 72) {
  if (score === null || score === undefined) return null;
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
  fontWeight: 600,
  color: TEXT_SECONDARY,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  marginBottom: 10,
};

export const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
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
      <div style={{ fontSize: 22, fontWeight: 600, color: TEXT_PRIMARY, lineHeight: 1.2, fontFamily: 'var(--font-mono-data, "DM Mono", monospace)' }}>{value}</div>
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
