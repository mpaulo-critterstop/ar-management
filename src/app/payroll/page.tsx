'use client';
export const dynamic = 'force-dynamic';

const TILES = [
  {
    title: 'US Payroll',
    desc: 'Tolls, Team Tracker, Raise Tracker, Probation, PTO, Reviews, and weekly pay periods.',
    href: '/payroll/us',
    icon: '🇺🇸',
    status: 'available' as const,
  },
  {
    title: 'International Payroll',
    desc: 'International team payroll and PTO.',
    href: '/payroll/international',
    icon: '🌎',
    status: 'available' as const,
  },
];

export default function PayrollPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Home</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>💵 Payroll</h1>
      <p style={{ fontSize: 14, color: '#888780', margin: '0 0 24px' }}>US and international payroll.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {TILES.map(t => {
          const inner = (
            <div style={{
              border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 22, background: '#fff', height: '100%',
              opacity: t.status === 'coming-soon' ? 0.7 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontSize: 26 }}>{t.icon}</div>
                {t.status === 'coming-soon' && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#BA7517', background: '#FBF3E5', padding: '2px 8px', borderRadius: 999 }}>Coming soon</span>
                )}
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: '#2C2C2A', marginTop: 12 }}>{t.title}</div>
              <div style={{ fontSize: 13, color: '#888780', marginTop: 6, lineHeight: 1.5 }}>{t.desc}</div>
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
