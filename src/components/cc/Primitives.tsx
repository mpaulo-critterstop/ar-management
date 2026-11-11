'use client';
import React from 'react';
import { cc, avatarColor, initials, toneColors, Tone } from './tokens';

// --- Avatar: colored initials badge (deterministic color by name) ---
export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: avatarColor(name),
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.37),
      fontWeight: 600, color: '#fff', flex: '0 0 auto' }}>
      {initials(name)}
    </div>
  );
}

// --- StatusPill: small rounded tone chip ---
export function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }) {
  const { fg, bg } = toneColors(tone);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
      padding: '3px 10px', borderRadius: 20, background: bg, color: fg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// --- Btn: primary / blue / secondary / danger ---
export function Btn({ children, onClick, variant = 'secondary', disabled, title, style }:
  { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'blue' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; title?: string; style?: React.CSSProperties }) {
  const base: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: cc.r2,
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid',
    opacity: disabled ? 0.55 : 1, transition: '.15s', whiteSpace: 'nowrap' };
  const v: Record<string, React.CSSProperties> =
    { primary: { background: cc.green, borderColor: cc.green, color: '#05140e' },
      blue: { background: cc.blue, borderColor: cc.blue, color: '#06131f' },
      secondary: { background: cc.panel2, borderColor: cc.line2, color: cc.ink },
      danger: { background: cc.redbg, borderColor: '#4a2626', color: cc.red },
      ghost: { background: 'transparent', borderColor: 'transparent', color: cc.muted } };
  return <button onClick={onClick} disabled={disabled} title={title} style={{ ...base, ...v[variant], ...style }}>{children}</button>;
}

// --- SectionHeader: uppercase label + divider line + optional right note ---
export function SectionHeader({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: cc.muted,
      margin: '30px 0 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>{children}</span>
      <span style={{ flex: 1, height: 1, background: cc.line }} />
      {note ? <span style={{ textTransform: 'none', fontWeight: 400, color: cc.faint }}>{note}</span> : null}
    </div>
  );
}

// --- Card: generic dark panel ---
export function Card({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  return <div onClick={onClick} style={{ background: cc.panel, border: `1px solid ${cc.line}`, borderRadius: cc.r, ...style }}>{children}</div>;
}
