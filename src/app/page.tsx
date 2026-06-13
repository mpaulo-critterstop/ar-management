'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

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
      if (role === 'TECHNICIAN') { router.replace('/my-performance'); return; }
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
  const fpRoles = ['ADMIN', 'MANAGER', 'LEADERSHIP'];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const cards = [
    {
      icon: '🎯',
      title: 'Leads Tracker',
      desc: 'Track wildlife inspection leads, PM performance, and conversion rates.',
      href: '/leads',
      accentColor: '#1D9E75',
      main: leadsKpis?.kpis?.total || '—',
      mainLabel: 'Total leads',
      stats: leadsKpis ? [
        { label: 'Total leads', value: leadsKpis.kpis?.total || 0 },
        { label: 'Sold', value: leadsKpis.kpis?.sold || 0, color: '#1D9E75' },
        { label: 'Close rate', value: leadsKpis.kpis ? (leadsKpis.kpis.conversionRate).toFixed(1) + '%' : '—' },
      ] : null,
    },
    {
      icon: '🚛',
      title: 'Dispatcher',
      desc: 'Manage active exclusion jobs, trap checks, FAR progress, and close-outs.',
      href: '/dispatch',
      accentColor: '#BA7517',
      main: dispatchKpis?.kpis?.total || '—',
      mainLabel: 'Active jobs',
      stats: dispatchKpis ? [
        { label: 'Active jobs', value: dispatchKpis.kpis?.total || 0 },
        { label: 'FAR pending', value: dispatchKpis.kpis?.farPending || 0, color: '#BA7517' },
        { label: 'Closed this month', value: dispatchKpis.kpis?.closedThisMonth || 0, color: '#1D9E75' },
      ] : null,
    },
    {
      icon: '📋',
      title: 'Accounts Receivable',
      desc: 'Monitor AR aging, open invoices, and collections across all offices.',
      href: '/accounts-receivable',
      accentColor: '#0052cc',
      main: kpis ? fmt(kpis.totalAR || 0) : '—',
      mainLabel: 'Total AR',
      stats: kpis ? [
        { label: 'Total AR', value: fmt(kpis.totalAR || 0), color: '#0052cc' },
        { label: 'Overdue', value: fmt(kpis.overdueAR || 0), color: '#A32D2D' },
        { label: 'Open invoices', value: kpis.openCount || 0 },
      ] : null,
    },
    {
      icon: '📞',
      title: 'Dialpad Call Analytics',
      desc: 'Analyze inbound call volume, answer rates, agent performance, and first-time callers.',
      href: '/calls',
      accentColor: '#534AB7',
      main: '—',
      mainLabel: 'Total inbound',
      stats: null,
    },
    ...(fpRoles.includes(role) ? [{
      icon: '📊',
      title: 'Field Professional Effort Meter',
      desc: 'Track field technician performance scores, driving, reliability, and close-out rates.',
      href: '/field-performance',
      accentColor: '#0F6E56',
      main: '—',
      mainLabel: 'Active techs',
      stats: null,
    }] : []),
  ];

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#2C2C2A', marginBottom: 4 }}>
          {greeting} 👋
        </div>
        <div style={{ fontSize: 14, color: '#888780' }}>
          Welcome back, {(session.user as any)?.name || (session.user as any)?.email?.split('@')[0]}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {cards.map(card => (
          <a
            key={card.href}
            href={card.href}
            style={{
              background: '#fff',
              borderRadius: 12,
              border: '0.5px solid #E8E7E3',
              borderTop: `3px solid ${card.accentColor}`,
              padding: 20,
              cursor: 'pointer',
              display: 'block',
              textDecoration: 'none',
              transition: 'box-shadow 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(44,44,42,0.08)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#F1EFE8', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, fontSize: 20 }}>
              {card.icon}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#2C2C2A', marginBottom: 6 }}>{card.title}</div>
            <div style={{ fontSize: 12, color: '#888780', lineHeight: 1.6, marginBottom: 16 }}>{card.desc}</div>
            <div style={{ fontSize: 24, fontWeight: 500, color: card.accentColor }}>{card.main}</div>
            <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2, marginBottom: 12 }}>{card.mainLabel}</div>
            {card.stats && (
              <div style={{ display: 'flex', gap: 16, borderTop: '0.5px solid #E8E7E3', paddingTop: 12 }}>
                {card.stats.map((s: any) => (
                  <div key={s.label}>
                    <div style={{ fontSize: 16, fontWeight: 500, color: s.color || '#2C2C2A' }}>{s.value}</div>
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
