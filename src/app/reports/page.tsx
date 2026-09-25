'use client';

type Report = { title: string; desc: string; href?: string; status: 'available' | 'coming-soon' };

const REPORTS: Report[] = [
  {
    title: 'Insulation Revenue per Tech',
    desc: 'Weekly & monthly FAR (insulation) revenue per job, crew size from the route, and revenue per tech. Labor-cost columns for Direct Labor %.',
    href: undefined,
    status: 'coming-soon',
  },
];

export default function ReportsPage() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <a href="/" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Home</a>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>📈 Reports</h1>
      <p style={{ fontSize: 14, color: '#888780', margin: '0 0 24px' }}>Operational and financial reports.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {REPORTS.map(r => {
          const inner = (
            <div style={{
              border: '0.5px solid #E8E7E3', borderRadius: 12, padding: 18, background: '#fff', height: '100%',
              opacity: r.status === 'coming-soon' ? 0.7 : 1, cursor: r.href ? 'pointer' : 'default',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#2C2C2A', margin: 0 }}>{r.title}</h3>
                {r.status === 'coming-soon' && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#BA7517', background: '#FBF3E5', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>Coming soon</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: '#888780', margin: '8px 0 0', lineHeight: 1.5 }}>{r.desc}</p>
            </div>
          );
          return r.href
            ? <a key={r.title} href={r.href} style={{ textDecoration: 'none' }}>{inner}</a>
            : <div key={r.title}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
