'use client';
export const dynamic = 'force-dynamic';
import Link from 'next/link';

const SECTIONS = [
  { title: 'Employees', desc: 'Unified employee directory — roster, roles, probation, pay & raises in one place.', href: '/payroll/employees', status: 'available' as const },
  { title: 'Tolls', desc: 'Upload the toll transaction CSV; tolls are matched to each tech per pay period.', href: '/payroll/us/tolls', status: 'available' as const },
  { title: 'Main Payroll Tracker', desc: 'Weekly pay periods with a week dropdown, including historical data.', href: '/payroll/us/tracker', status: 'coming-soon' as const },
  { title: 'Team Tracker', desc: 'Team assignments and structure.', href: '/payroll/us/team', status: 'coming-soon' as const },
  { title: 'Raise Tracker', desc: 'Pay, positions, and raise history (opens inside Employees).', href: '/payroll/employees', status: 'available' as const },
  { title: 'Probation Tracker', desc: 'New hires, probation status, and OnPay (opens inside Employees).', href: '/payroll/employees', status: 'available' as const },
  { title: 'Clock-In vs. Arrival', desc: 'Upload the OnTheClock CSV; compares clock-in/out vs. actual Bouncie arrival at first stop. Flags gaps over 10 min.', href: '/payroll/us/clock-vs-arrival', status: 'available' as const },
  { title: 'Reviews', desc: 'Google reviews (temporary — planned for removal).', href: '/payroll/us/reviews', status: 'coming-soon' as const },
];

export default function USPayrollPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '30px 34px 70px' }}>
      <Link href="/payroll" style={{ fontSize: 13, color: '#908E85', textDecoration: 'none' }}>↩ Payroll</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F0EEE8', margin: '8px 0 4px' }}>🇺🇸 US Payroll</h1>
      <p style={{ fontSize: 14, color: '#908E85', margin: '0 0 24px' }}>Pay periods, tolls, and team tracking.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {SECTIONS.map(s => {
          const inner = (
            <div style={{ border: '0.5px solid #2A2A30', borderRadius: 12, padding: 18, background: '#1C1C21', height: '100%', opacity: s.status === 'coming-soon' ? 0.7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#F0EEE8' }}>{s.title}</div>
                {s.status === 'coming-soon' && <span style={{ fontSize: 10, fontWeight: 600, color: '#DBA14E', background: '#352a16', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>Coming soon</span>}
              </div>
              <div style={{ fontSize: 13, color: '#908E85', marginTop: 6, lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          );
          return s.status === 'available'
            ? <Link key={s.title} href={s.href} style={{ textDecoration: 'none' }}>{inner}</Link>
            : <div key={s.title}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
