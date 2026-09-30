'use client';
export const dynamic = 'force-dynamic';

const SECTIONS = [
  { title: 'Employee and Raise Tracker', desc: 'International employee pay, positions, and raise history.', href: '/payroll/international/raises', status: 'available' as const },
  { title: 'PTO Tracker', desc: 'PTO and holiday allotments, used, and remaining.', href: '/payroll/international/pto', status: 'available' as const },
];

export default function InternationalPayrollPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/payroll" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Payroll</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>🌎 International Payroll</h1>
      <p style={{ fontSize: 14, color: '#888780', margin: '0 0 24px' }}>International team payroll and PTO.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {SECTIONS.map(s => (
          <a key={s.title} href={s.href} style={{ textDecoration: 'none' }}>
            <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 18, background: '#fff', height: '100%' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#2C2C2A' }}>{s.title}</div>
              <div style={{ fontSize: 13, color: '#888780', marginTop: 6, lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
