'use client';
import React from 'react';
import { cc } from './tokens';

// Command Center modal shell + form field primitives — so all module modals look consistent.

export function Modal({ open, onClose, title, icon, width = 440, children, busy }:
  { open: boolean; onClose: () => void; title: string; icon?: string; width?: number; children: React.ReactNode; busy?: boolean }) {
  if (!open) return null;
  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cc.panel, border: `1px solid ${cc.line2}`, borderRadius: cc.r,
        padding: 22, width, maxWidth: '94vw', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: cc.ink, display: 'flex', alignItems: 'center', gap: 9 }}>
            {icon ? <span>{icon}</span> : null}{title}
          </div>
          <button onClick={() => !busy && onClose()} style={{ fontSize: 20, lineHeight: 1, border: 'none', background: 'transparent', color: cc.muted, cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: cc.muted, marginBottom: 5, marginTop: 14, ...style }}>{children}</label>;
}

export const fieldStyle: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '10px 12px', borderRadius: cc.r3, border: `1px solid ${cc.line2}`,
  background: cc.panel2, color: cc.ink, boxSizing: 'border-box', outline: 'none',
};

export function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...fieldStyle, ...(props.style || {}) }} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...fieldStyle, ...(props.style || {}) }}>{props.children}</select>;
}

// summary box (e.g. invoice details in the Take Payment flow)
export function InfoBox({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' }) {
  const bg = tone === 'green' ? cc.greenbg : cc.panel2;
  return <div style={{ background: bg, borderRadius: cc.r2, padding: '12px 14px', marginBottom: 14 }}>{children}</div>;
}
