'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const ACCENT = '#0052cc';

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function HomePage() {
  const sessionData = useSession();
  const session = sessionData?.data;
  const status = sessionData?.status;
  const router = useRouter();
  const [kpis, setKpis] = useState<any>(null);
  const [leadsKpis, setLeadsKpis] = useState<any>(null);
  const [dispatchKpis, setDispatchKpis] = useState<any>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated') {
      const role = (session?.user as any)?.role;
      if (role === 'TECHNICIAN') {
        router.replace('/my-performance');
        return;
      }
    }
  }, [status, router, session]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/kpi').then(r => r.json()).then(setKpis).catch(() => {});
    fetch('/api/leads').then(r => r.json()).then(setLeadsKpis).catch(() => {});
    fetch('/api/dispatch').then(r => r.json()).then(setDispatchKpis).catch(() => {});
  }, [status]);

  if (!session) return null;

  const role = (session?.user as any)?.role;
  if (role === 'TECHNICIAN') return null;

  const cards = [
    {
      icon: '🎯',
      title: 'Leads tracker',
      desc: 'Track wildlife inspection leads, PM performance, and conversion rates.',
      href: '/leads',
      stats: leadsKpis ? [
        { label: 'Total leads', value: leadsKpis.kpis?.total || 0 },
        { label: 'Sold', value: leadsKpis.kpis?.sold || 0, color: '#1D9E75' },
        { label: 'Close rate', value: leadsKpis.kpis ? (leadsKpis.kpis.conversionRate).toFixed(1) + '%' : '—' },
      ] : null,
      main: leadsKpis?.kpis?.total || '—',
      mainLabel: 'Total leads',
    },
    {
      icon: '🚛',
      title: 'Dispatcher',
      desc: 'Manage active exclusion jobs, trap checks, FAR progress, and close-outs.',
      href: '/dispatch',
      stats: dispatchKpis ? [
       { label: 'Active jobs', value: dispatchKpis.kpis?.total || 0 },
       { label: 'FAR pending', value: dispatchKpis.kpis?.farPending || 0, color: '#BA7517' },
       { label: 'Closed this month', value: dispatchKpis.kpis?.closedThisMonth || 0, color: '#1D9E75' },
      ] : null,
      main: dispatchKpis?.kpis?.total || '—',
      mainLabel: 'Active jobs',
    },
    {
      icon: '📋',
      title: 'Accounts receivable',
      desc: 'Monitor AR aging, open invoices, and collections across all offices.',
      href: '/accounts-receivable',
      stats: kpis ? [
        { label: 'Total AR', value: fmt(kpis.totalAR || 0), color: ACCENT },
        { label: 'Overdue', value: fmt(kpis.overdueAR || 0), color: '#A32D2D' },
        { label: 'Open invoices', value: kpis.openCount || 0 },
      ] : null,
      main: kpis ? fmt(kpis.totalAR || 0) : '—',
      mainLabel: 'Total AR',
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#2C2C2A', marginBottom: 4 }}>
          Good morning 👋
        </div>
        <div style={{ fontSize: 14, color: '#888780' }}>
          Welcome back, {(session.user as any)?.name || (session.user as any)?.email?.split('@')[0]}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {cards.map(card => (
          <a
            key={card.href}
            href={card.href}
            style={{
              background: '#fff',
              borderRadius: 12,
              border: '0.5px solid #E8E7E3',
              padding: 20,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
              display: 'block',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = ACCENT)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#E8E7E3')}
          >
            <div style={{ width: 40, height: 40, borderRadius: 8, background: '#E8F4FC', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, fontSize: 20 }}>
              {card.icon}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#2C2C2A', marginBottom: 6 }}>{card.title}</div>
            <div style={{ fontSize: 12, color: '#888780', lineHeight: 1.5, marginBottom: 16 }}>{card.desc}</div>
            <div style={{ fontSize: 24, fontWeight: 500, color: ACCENT }}>{card.main}</div>
            <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2, marginBottom: 12 }}>{card.mainLabel}</div>
            {card.stats && (
              <div style={{ display: 'flex', gap: 16, borderTop: '0.5px solid #E8E7E3', paddingTop: 12 }}>
                {card.stats.map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize: 16, fontWeight: 500, color: (s as any).color || '#2C2C2A' }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: '#B4B2A9' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
