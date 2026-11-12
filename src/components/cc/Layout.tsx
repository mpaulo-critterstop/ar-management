'use client';
import React from 'react';
import { cc, toneColors, Tone } from './tokens';
import { Avatar } from './Primitives';

// --- PageHeader: gradient icon + title + subtitle + action buttons ---
export function PageHeader({ icon, title, subtitle, actions }:
  { icon: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg,${cc.blue},${cc.green})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flex: '0 0 auto' }}>{icon}</div>
        <div>
          <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: '-.02em', color: cc.ink }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 13, color: cc.muted, marginTop: 2 }}>{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div> : null}
    </div>
  );
}

// --- KpiStrip: a row of accent-bar metric cards ---
export type Kpi = { icon?: string; label: string; value: React.ReactNode; delta?: React.ReactNode; deltaTone?: Tone; tone?: Tone };
export function KpiStrip({ items }: { items: Kpi[] }) {
  // Fit all tiles on one line (one equal column per item). On narrow screens, fall back to auto-fit wrapping.
  return (
    <>
    <style>{`
      .cc-kpi-strip { grid-template-columns: repeat(${items.length}, minmax(0,1fr)); }
      @media (max-width: 1100px) { .cc-kpi-strip { grid-template-columns: repeat(3, minmax(0,1fr)) !important; } }
      @media (max-width: 680px)  { .cc-kpi-strip { grid-template-columns: repeat(2, minmax(0,1fr)) !important; } }
    `}</style>
    <div style={{ display: 'grid', gap: 12, marginBottom: 28 }} className="cc-kpi-strip">
      {items.map((k, i) => {
        const accent = toneColors(k.tone || 'blue').fg;
        const dTone = k.deltaTone ? toneColors(k.deltaTone).fg : cc.faint;
        return (
          <div key={i} style={{ background: cc.panel, border: `1px solid ${cc.line}`, borderRadius: cc.r, padding: '15px 15px', position: 'relative', overflow: 'hidden', minWidth: 0 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent, borderRadius: 3 }} />
            {k.icon ? <div style={{ fontSize: 14, opacity: 0.9 }}>{k.icon}</div> : null}
            <div style={{ fontSize: 12, color: cc.muted, fontWeight: 500, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', marginTop: 8, lineHeight: 1, color: cc.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.value}</div>
            {k.delta ? <div style={{ fontSize: 11, marginTop: 6, color: dTone, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.delta}</div> : null}
          </div>
        );
      })}
    </div>
    </>
  );
}

// --- SegTabs: pill segmented control with optional count badges ---
export type SegTab = { key: string; label: string; count?: number };
export function SegTabs({ tabs, active, onChange }: { tabs: SegTab[]; active: string; onChange: (k: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', background: cc.panel2, border: `1px solid ${cc.line}`, borderRadius: 11, padding: 4, gap: 3 }}>
      {tabs.map(t => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{ fontSize: 13, fontWeight: on ? 600 : 500,
            padding: '7px 15px', borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            background: on ? cc.elev : 'transparent', color: on ? cc.ink : cc.muted }}>
            {t.label}
            {t.count != null ? <span style={{ fontSize: 11, borderRadius: 20, padding: '1px 7px',
              background: on ? cc.blue : cc.line2, color: on ? '#06131f' : cc.ink2 }}>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// --- FilterChips: clickable mini-cards (status filters with count + sub) ---
export type Chip = { key: string; label: string; value: React.ReactNode; sub?: React.ReactNode; valueTone?: Tone; subTone?: Tone };
export function FilterChips({ chips, active, onChange }: { chips: Chip[]; active: string; onChange: (k: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 16 }}>
      {chips.map(c => {
        const on = c.key === active;
        const vTone = c.valueTone ? toneColors(c.valueTone).fg : cc.ink;
        const sTone = c.subTone ? toneColors(c.subTone).fg : cc.faint;
        return (
          <div key={c.key} onClick={() => onChange(c.key)} style={{ background: on ? cc.bluebg : cc.panel,
            border: `1px solid ${on ? cc.blue : cc.line}`, borderRadius: 11, padding: '11px 15px', minWidth: 118, cursor: 'pointer', transition: '.15s' }}>
            <div style={{ fontSize: 11.5, color: cc.muted, fontWeight: 500 }}>{c.label}</div>
            <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, letterSpacing: '-.01em', color: vTone }}>{c.value}</div>
            {c.sub != null ? <div style={{ fontSize: 11, marginTop: 2, color: sTone }}>{c.sub}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

// --- Toolbar + SearchBox ---
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>{children}</div>;
}
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: cc.panel2, border: `1px solid ${cc.line}`, borderRadius: 10, padding: '9px 13px', minWidth: 230 }}>
      <span>🔍</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ border: 'none', background: 'transparent', color: cc.ink, fontSize: 13, outline: 'none', width: '100%' }} />
    </div>
  );
}

// --- DataTable: the redesigned table (generous rows, hover, header) ---
export type Col = { key: string; label: React.ReactNode; align?: 'left' | 'right' | 'center'; render?: (row: any) => React.ReactNode; width?: number | string; wrap?: boolean };
export function DataTable({ cols, rows, empty = 'None.', rowKey }:
  { cols: Col[]; rows: any[]; empty?: string; rowKey?: (r: any, i: number) => string }) {
  // Sticky header (frozen while the table body scrolls). position:sticky + top:0 keeps the header row fixed.
  const thBase: React.CSSProperties = { padding: '11px 13px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em',
    textTransform: 'uppercase', color: cc.muted, background: cc.panel2, borderBottom: `1px solid ${cc.line}`, whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 2 };
  const tdBase: React.CSSProperties = { padding: '11px 13px', borderBottom: `1px solid ${cc.line}`, whiteSpace: 'nowrap', color: cc.ink2, fontSize: 13.5 };
  return (
    <div style={{ background: cc.panel, border: `1px solid ${cc.line}`, borderRadius: cc.r, overflow: 'auto', maxHeight: '64vh' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead><tr>{cols.map(c => <th key={c.key} style={{ ...thBase, textAlign: c.align || 'left', width: c.width }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} style={{ ...tdBase, textAlign: 'center', color: cc.faint, padding: 22 }}>{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = cc.panel2}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              style={{ transition: 'background .12s' }}>
              {cols.map(c => <td key={c.key} style={{ ...tdBase, textAlign: c.align || 'left', ...(c.wrap ? { whiteSpace: 'normal' } : {}) }}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// handy cell: customer with avatar + sub
export function CustomerCell({ name, sub }: { name: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Avatar name={name} />
      <div><div style={{ fontWeight: 600, color: cc.ink }}>{name}</div>{sub ? <div style={{ fontSize: 11.5, color: cc.faint }}>{sub}</div> : null}</div>
    </div>
  );
}
