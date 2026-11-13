'use client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';
import { canAccessModule, type ModuleKey } from '@/lib/access';

type Report = { title: string; desc: string; href?: string; status: 'available' | 'coming-soon'; module: ModuleKey };

const REPORTS: Report[] = [
  {
    title: 'AR Benchmark',
    desc: 'Actual days-to-pay by service line — Pest Control, Wildlife, and Insulation — at 30/60/90-day trailing. The real basis for what AR should be. Updated weekly (Sat–Fri).',
    href: '/reports/ar-benchmark',
    status: 'available',
    module: 'report-ar-benchmark',
  },
  {
    title: 'Insulation Revenue per Tech',
    desc: 'Weekly & monthly FAR + Top-Off revenue per job, crew size from the route, and revenue per tech. Direct Labor columns for manual entry.',
    href: '/reports/insulation-revenue',
    status: 'available',
    module: 'report-insulation',
  },
  {
    title: 'Exclusion Productivity',
    desc: 'Exclusion revenue per scheduled tech-hour by field professional, vs. the $225 (1-story) / $175 (2-story) standard. Shows where jobs are under- or over-allotted time — the scheduling blind spot. Base service charge only; trapping/fogging pulled separately.',
    href: '/reports/exclusion-revenue',
    status: 'available',
    module: 'report-insulation',
  },
  {
    title: 'Bad-Debt Accrual Calendar',
    desc: 'When each unpaid overdue invoice would have become bad debt under our collections rules, bucketed by month — for the scorecard baseline and the bookkeeper backdating conversation. Read-only projection; does not touch FieldRoutes.',
    href: '/reports/bad-debt-calendar',
    status: 'available',
    module: 'ar',
  },
];

export default function ReportsPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const visibleReports = REPORTS.filter(r => canAccessModule(user, r.module));
  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '30px 34px 70px' }}>
      <CCPageHeader icon="📈" title="Reports" subtitle="Operational and financial reports" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {visibleReports.map(r => {
          const inner = (
            <div style={{
              border: '0.5px solid #2A2A30', borderRadius: 12, padding: 18, background: '#1C1C21', height: '100%',
              opacity: r.status === 'coming-soon' ? 0.7 : 1, cursor: r.href ? 'pointer' : 'default',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#F0EEE8', margin: 0 }}>{r.title}</h3>
                {r.status === 'coming-soon' && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#DBA14E', background: '#352a16', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>Coming soon</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: '#908E85', margin: '8px 0 0', lineHeight: 1.5 }}>{r.desc}</p>
            </div>
          );
          return r.href
            ? <Link key={r.title} href={r.href} style={{ textDecoration: 'none' }}>{inner}</Link>
            : <div key={r.title}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
