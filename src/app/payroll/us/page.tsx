'use client';
export const dynamic = 'force-dynamic';

const SECTIONS = [
  { title: 'Tolls', desc: 'Upload the toll transaction CSV; tolls are matched to each tech per pay period.', href: '/payroll/us/tolls', status: 'available' as const },
  { title: 'Main Payroll Tracker', desc: 'Weekly pay periods with a week dropdown, including historical data.', href: '/payroll/us/tracker', status: 'coming-soon' as const },
  { title: 'Team Tracker', desc: 'Team assignments and structure.', href: '/payroll/us/team', status: 'coming-soon' as const },
  { title: 'Raise Tracker', desc: 'Employee pay, positions, and raise history.', href: '/payroll/us/raises', status: 'available' as const },
  { title: 'Probation Tracker', desc: 'Probation status and review dates.', href: '/payroll/us/probation', status: 'coming-soon' as const },
  { title: 'PTO Tracker', desc: 'PTO balances and usage.', href: '/payroll/us/pto', status: 'coming-soon' as const },
  { title: 'Reviews', desc: 'Google reviews (temporary — planned for removal).', href: '/payroll/us/reviews', status: 'coming-soon' as const },
];

export default function USPayrollPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/payroll" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Payroll</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>🇺🇸 US Payroll</h1>
      <p style={{ fontSize: 14, color: '#888780', margin: '0 0 24px' }}>Pay periods, tolls, and team tracking.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {SECTIONS.map(s => {
          const inner = (
            <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 18, background: '#fff', height: '100%', opacity: s.status === 'coming-soon' ? 0.7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#2C2C2A' }}>{s.title}</div>
                {s.status === 'coming-soon' && <span style={{ fontSize: 10, fontWeight: 600, color: '#BA7517', background: '#FBF3E5', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>Coming soon</span>}
              </div>
              <div style={{ fontSize: 13, color: '#888780', marginTop: 6, lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          );
          return s.status === 'available'
            ? <a key={s.title} href={s.href} style={{ textDecoration: 'none' }}>{inner}</a>
            : <div key={s.title}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
