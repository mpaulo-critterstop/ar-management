// Debug: fetch one SmarterLaunch proposal (by uuid) using the env key, and surface the per-line-item pricing
// so we can see standard vs. discounted amounts across ALL line items (for the discount-audit feature).
//   GET ?token=critterstop2026&uuid=<proposal uuid>[&raw=1]
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uuid = sp.get('uuid');
  if (!uuid) return NextResponse.json({ error: 'pass &uuid=' });
  const KEY = process.env.SMARTERLAUNCH_API_KEY;
  if (!KEY) return NextResponse.json({ error: 'SMARTERLAUNCH_API_KEY not set' }, { status: 400 });

  const d = await fetch(`https://api.smarterlaunch.com/api/v1/proposals/${uuid}`, { headers: { 'X-API-Key': KEY, 'Accept': 'application/json' } })
    .then(r => r.json()).then(j => j.data).catch(e => ({ error: String(e) }));
  if (!d || d.error) return NextResponse.json({ error: d?.error || 'fetch failed' });

  if (sp.get('raw') === '1') return NextResponse.json(d);

  // Walk service_plans -> pricing_groups, pulling every amount-ish field so we can spot discount vs standard.
  const sections: any[] = [];
  for (const plan of (d.service_plans || [])) {
    const items = (plan.pricing_groups || []).map((g: any) => {
      // capture every numeric/price-ish field on the group to compare standard vs actual
      const picked: any = { name: g.name, selected: g.selected };
      for (const k of Object.keys(g)) {
        if (/price|amount|revenue|discount|total|standard|list|original|ppu|value|mod/i.test(k) && (typeof g[k] === 'number' || typeof g[k] === 'string')) picked[k] = g[k];
      }
      // also peek into nested pricing_data / custom_values if present
      if (g.pricing_data) picked._pricing_data = g.pricing_data;
      if (g.custom_values) picked._custom_values = g.custom_values;
      return picked;
    });
    sections.push({ section: plan.name, items });
  }
  // also surface proposal-level discount/adjustment fields
  const topLevel: any = {};
  for (const k of Object.keys(d)) {
    if (/discount|adjustment|general_adjust|initial_billing|first_year|annual_revenue/i.test(k)) topLevel[k] = d[k];
  }
  return NextResponse.json({ uuid, title: d.title, topLevel, sections });
}
