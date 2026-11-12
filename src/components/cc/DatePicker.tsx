'use client';
import React, { useState, useRef, useEffect } from 'react';
import { cc } from './tokens';

// cc DatePicker — a dark calendar popup matching the command-center design, used in place of the browser's
// native <input type="date"> (which can't be restyled). Value in/out is a YYYY-MM-DD string, so it's a
// drop-in: <CCDatePicker value={from} onChange={setFrom} />.

const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parse(v: string): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function DatePicker({ value, onChange, placeholder = 'Select date', max, min, style }:
  { value: string; onChange: (v: string) => void; placeholder?: string; max?: string; min?: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const [viewMonth, setViewMonth] = useState<Date>(selected || new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open && selected) setViewMonth(selected); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const maxD = parse(max || ''), minD = parse(min || '');
  const y = viewMonth.getFullYear(), m = viewMonth.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));

  const disabled = (d: Date) => (maxD && d > maxD) || (minD && d < minD);
  const today = new Date();

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '8px 11px', borderRadius: 9,
          border: `1px solid ${open ? cc.blue : cc.line2}`, background: cc.panel2, color: value ? cc.ink : cc.muted, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 13 }}>📅</span>
        {value || placeholder}
        {value && <span onClick={(e) => { e.stopPropagation(); onChange(''); }} style={{ marginLeft: 2, color: cc.faint, fontSize: 14 }}>×</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 1000, background: cc.panel, border: `1px solid ${cc.line2}`,
          borderRadius: cc.r2, padding: 12, boxShadow: '0 16px 50px rgba(0,0,0,.5)', width: 256 }}>
          {/* header: month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" onClick={() => setViewMonth(new Date(y, m - 1, 1))} style={navBtn}>‹</button>
            <div style={{ fontSize: 13, fontWeight: 600, color: cc.ink }}>{MONTHS[m]} {y}</div>
            <button type="button" onClick={() => setViewMonth(new Date(y, m + 1, 1))} style={navBtn}>›</button>
          </div>
          {/* weekday headings */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
            {WD.map(w => <div key={w} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 600, color: cc.faint, padding: '2px 0' }}>{w}</div>)}
          </div>
          {/* day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const isSel = selected && sameDay(d, selected);
              const isToday = sameDay(d, today);
              const dis = disabled(d);
              return (
                <button key={i} type="button" disabled={!!dis}
                  onClick={() => { onChange(toStr(d)); setOpen(false); }}
                  style={{ height: 30, borderRadius: 7, border: 'none', cursor: dis ? 'not-allowed' : 'pointer', fontSize: 12.5,
                    fontWeight: isSel ? 700 : 400, opacity: dis ? 0.3 : 1,
                    background: isSel ? cc.blue : 'transparent', color: isSel ? '#06131f' : cc.ink2,
                    outline: isToday && !isSel ? `1px solid ${cc.line2}` : 'none' }}
                  onMouseEnter={e => { if (!isSel && !dis) (e.currentTarget as HTMLElement).style.background = cc.panel2; }}
                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          {/* footer: Today / Clear */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${cc.line}` }}>
            <button type="button" onClick={() => { const t = new Date(); if (!disabled(t)) { onChange(toStr(t)); setOpen(false); } }} style={footBtn}>Today</button>
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} style={footBtn}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 7, border: `1px solid ${cc.line2}`, background: cc.panel2, color: cc.ink, cursor: 'pointer', fontSize: 14, lineHeight: 1 };
const footBtn: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: cc.blue, background: 'transparent', border: 'none', cursor: 'pointer' };
