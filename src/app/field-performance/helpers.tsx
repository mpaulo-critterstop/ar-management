import { useState, useEffect } from 'react';
import React from 'react';

export const ACCENT = '#0052cc';

export function scoreBadge(score: number | null): React.ReactNode {
  if (score === null || score === undefined) return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
  const { bg, text } = scoreColors(score);
  return (
    <span style={{ background: bg, color: text, fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 99, display: 'inline-block' }}>
      {score.toFixed(2)}
    </span>
  );
}

export function scoreColors(score: number) {
  if (score >= 0.90) return { bg: '#EAF3DE', text: '#27500A' };
  if (score >= 0.75) return { bg: '#FAEEDA', text: '#633806' };
  return { bg: '#FCEBEB', text: '#791F1F' };
}

export function scoreBar(score: number | null, width = 72) {
  if (score === null || score === undefined) return null;
  const pct = Math.min((score / 1.1) * 100, 100);
  const color = score >= 0.90 ? '#639922' : score >= 0.75 ? '#BA7517' : '#E24B4A';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
      <div style={{ width, height: 5, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

export function teamPill(team: string) {
  const styles: Record<string, { bg: string; color: string }> = {
    WP:  { bg: '#E6F1FB', color: '#0C447C' },
    PMP: { bg: '#E1F5EE', color: '#085041' },
    IP:  { bg: '#FBEAF0', color: '#72243E' },
  };
  const s = styles[team] || { bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 99 }}>
      {team}
    </span>
  );
}

export function statusPill(status: string) {
  const active = status === 'ACTIVE';
  return (
    <span style={{ background: active ? '#EAF3DE' : '#FCEBEB', color: active ? '#27500A' : '#791F1F', fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 99 }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function pctFmt(v: number | null) {
  if (v === null || v === undefined) return '—';
  return (v * 100).toFixed(0) + '%';
}

export function deltaFmt(d: number | null) {
  if (d === null || d === undefined) return '—';
  if (d > 0) return <span style={{ color: '#3B6D11', fontSize: 11 }}>▲ +{d.toFixed(2)}</span>;
  if (d < 0) return <span style={{ color: '#A32D2D', fontSize: 11 }}>▼ {d.toFixed(2)}</span>;
  return <span style={{ color: '#94a3b8', fontSize: 11 }}>— 0.00</span>;
}

export const card: React.CSSProperties = {
  background: '#fff',
  border: '0.5px solid #e2e8f0',
  borderRadius: 12,
  marginBottom: 10,
  overflow: 'hidden',
};

export const cardHead: React.CSSProperties = {
  padding: '12px 16px 0',
  fontSize: 11,
  fontWeight: 500,
  color: '#64748b',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  marginBottom: 10,
};

export const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 500,
  color: '#64748b',
  padding: '7px 12px',
  borderBottom: '0.5px solid #e2e8f0',
  background: '#f8fafc',
  whiteSpace: 'nowrap',
};

export const td: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '0.5px solid #f1f5f9',
  fontSize: 13,
  color: '#0f172a',
  verticalAlign: 'middle',
};

export const kpiCard = (value: React.ReactNode, label: string, sub?: string, valueColor?: string): React.ReactNode => (
  <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px' }}>
    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 21, fontWeight: 500, color: valueColor || '#0f172a' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{sub}</div>}
  </div>
);

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
