'use client';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';
export const dynamic = 'force-dynamic';

const TILES = [
  {
    title: 'US Payroll',
    desc: 'Tolls, Team Tracker, Raise Tracker, Probation, PTO, Reviews, and weekly pay periods.',
    href: '/payroll/us',
    icon: 'us-flag',
    status: 'available' as 'available' | 'coming-soon',
  },
  {
    title: 'International Payroll',
    desc: 'International team payroll and PTO.',
    href: '/payroll/international',
    icon: '🌎',
    status: 'available' as 'available' | 'coming-soon',
  },
];

function UsFlag() {
  return (
    <svg width="30" height="21" viewBox="0 0 30 21" style={{ borderRadius: 3, border: '0.5px solid #2A2A30', display: 'block' }} aria-label="US flag">
      <rect width="30" height="21" fill="#1C1C21" />
      {[0, 2, 4, 6, 8, 10, 12].map(i => <rect key={i} y={i * 1.615} width="30" height="1.615" fill="#B22234" />)}
      <rect width="12" height="11.3" fill="#3C3B6E" />
    </svg>
  );
}

export default function PayrollPage() {
  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '30px 34px 70px' }}>
      <CCPageHeader icon="💵" title="Payroll" subtitle="US and international payroll" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {TILES.map(t => {
          const inner = (
            <div style={{
              border: '0.5px solid #2A2A30', borderRadius: 12, padding: 22, background: '#1C1C21', height: '100%',
              opacity: t.status === 'coming-soon' ? 0.7 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontSize: 26, lineHeight: 1 }}>{t.icon === 'us-flag' ? <UsFlag /> : t.icon}</div>
                {t.status === 'coming-soon' && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#DBA14E', background: '#352a16', padding: '2px 8px', borderRadius: 999 }}>Coming soon</span>
                )}
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: '#F0EEE8', marginTop: 12 }}>{t.title}</div>
              <div style={{ fontSize: 13, color: '#908E85', marginTop: 6, lineHeight: 1.5 }}>{t.desc}</div>
            </div>
          );
          return t.status === 'available'
            ? <a key={t.title} href={t.href} style={{ textDecoration: 'none' }}>{inner}</a>
            : <div key={t.title}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
