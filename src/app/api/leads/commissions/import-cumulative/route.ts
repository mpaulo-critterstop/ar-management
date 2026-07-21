import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/leads/commissions/import-cumulative?token=critterstop2026
// One-time: patch cumulativeBookedRevenue onto existing CommissionHistory rows (keyed "pmName|YYYY-MM").
const CUM: Record<string, number> = {"Jordan Price|2023-11":124045.44,"Jordan Price|2023-12":257926.31,"Jordan Price|2024-01":385568.94,"Jordan Price|2024-02":535104.81,"Jordan Price|2024-03":652736.68,"Jordan Price|2024-04":795674.15,"Jordan Price|2024-05":900720.14,"Jordan Price|2024-06":987393.49,"Jordan Price|2024-07":1101540.36,"Jordan Price|2024-08":1240970.3,"Jordan Price|2024-09":1367362.88,"Jordan Price|2024-10":1528242.44,"Jordan Price|2024-11":1732878.84,"Jordan Price|2024-12":1955176.45,"Jordan Price|2025-01":2144608.03,"Jordan Price|2025-02":2289483.09,"Jordan Price|2025-03":2489616.37,"Jordan Price|2025-04":2665219.5,"Jordan Price|2025-05":2805833.62,"Jordan Price|2025-06":2969086.22,"Jordan Price|2025-07":3000478.77,"Jordan Price|2025-08":3116058.7,"Jordan Price|2025-09":3241133.42,"Jordan Price|2025-10":3378956.85,"Jordan Price|2025-11":3577590.61,"Jordan Price|2025-12":3681503.85,"Jordan Price|2026-01":3788414.62,"Jordan Price|2026-02":3881681.48,"Jordan Price|2026-03":3982901.77,"Jordan Price|2026-04":4110225.37,"Jordan Price|2026-05":4191513.0,"Jordan Price|2026-06":4316325.83,"Jared Brown|2025-01":392785.21,"Jared Brown|2025-02":567980.61,"Jared Brown|2025-03":718207.86,"Jared Brown|2025-04":941636.74,"Jared Brown|2025-05":1089201.4,"Jared Brown|2025-06":1140554.23,"Jared Brown|2025-07":1286404.31,"Jared Brown|2025-08":1399136.72,"Jared Brown|2025-09":1494781.6,"Jared Brown|2025-10":1631030.56,"Jared Brown|2025-11":1743350.62,"Jared Brown|2025-12":1957484.04,"Jared Brown|2026-01":2109416.38,"Jared Brown|2026-02":2314454.31,"Jared Brown|2026-03":2475825.97,"Jared Brown|2026-04":2651761.98,"Jared Brown|2026-05":2812020.34,"Jared Brown|2026-06":2934873.31,"Brant Hauser|2025-01":41683.87,"Brant Hauser|2025-02":155627.06,"Brant Hauser|2025-03":316434.84,"Brant Hauser|2025-04":447435.58,"Brant Hauser|2025-05":596015.07,"Brant Hauser|2025-06":731583.83,"Brant Hauser|2025-07":885751.34,"Brant Hauser|2025-08":963864.79,"Brant Hauser|2025-09":1084442.91,"Brant Hauser|2025-10":1233654.17,"Brant Hauser|2025-11":1409649.09,"Brant Hauser|2025-12":1576609.43,"Brant Hauser|2026-01":1715990.53,"Brant Hauser|2026-02":1870355.84,"Brant Hauser|2026-03":1992184.21,"Brant Hauser|2026-04":2172539.0,"Brant Hauser|2026-05":2354679.85,"Brant Hauser|2026-06":2505901.01,"Warren Loignon|2025-12":33461.66,"Warren Loignon|2026-01":113214.59,"Warren Loignon|2026-02":191619.22,"Warren Loignon|2026-03":272496.22,"Warren Loignon|2026-04":369262.98,"Warren Loignon|2026-05":366131.94,"Warren Loignon|2026-06":365779.88,"Adrian Valerio|2025-03":28127.52,"Adrian Valerio|2025-04":70524.93,"Adrian Valerio|2025-05":111235.09,"Adrian Valerio|2025-06":134573.13,"Adrian Valerio|2025-07":160025.79,"Adrian Valerio|2025-08":170807.79,"Adrian Valerio|2025-09":185949.42,"Adrian Valerio|2025-10":199859.72,"Adrian Valerio|2025-11":280367.82,"Adrian Valerio|2025-12":321678.24,"Adrian Valerio|2026-01":391167.26,"Adrian Valerio|2026-02":410379.88,"Adrian Valerio|2026-03":461363.2,"Adrian Valerio|2026-04":509817.58,"Adrian Valerio|2026-05":553534.73,"Adrian Valerio|2026-06":609768.71,"Blake Creswell|2025-05":12404.17,"Blake Creswell|2025-07":12313.61,"Blake Creswell|2025-08":0.0,"Blake Creswell|2025-09":26974.27,"Blake Creswell|2025-10":26974.27,"Blake Creswell|2025-11":35887.03,"Blake Creswell|2025-12":84511.56,"Blake Creswell|2026-01":142206.79,"Blake Creswell|2026-02":199620.15,"Blake Creswell|2026-03":225320.97,"Blake Creswell|2026-04":266888.33,"Blake Creswell|2026-05":298211.67,"Blake Creswell|2026-06":315354.43,"Travis Doyle|2026-02":95755.77,"Travis Doyle|2026-03":431669.21,"Travis Doyle|2026-04":657425.35,"Travis Doyle|2026-05":909745.2,"Travis Doyle|2026-06":1158032.22,"Han Bien|2026-04":19119.64,"Han Bien|2026-05":106799.89,"Han Bien|2026-06":187861.04,"Cynthia Barrientos|2026-06":7266.59};

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || req.headers.get('x-cron-secret');
  if (token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let updated = 0, missing = 0;
  for (const [key, val] of Object.entries(CUM)) {
    const [pmName, ym] = key.split('|');
    const [y, m] = ym.split('-').map(Number);
    const month = new Date(Date.UTC(y, m - 1, 1));
    try {
      await prisma.commissionHistory.update({
        where: { pmName_month: { pmName, month } },
        data: { cumulativeBookedRevenue: val },
      });
      updated++;
    } catch { missing++; }
  }
  return NextResponse.json({ success: true, updated, missing });
}
