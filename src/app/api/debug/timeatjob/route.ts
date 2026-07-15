export const maxDuration = 60;
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const R_M = 500;
function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const frId = searchParams.get('frId') || '198941';

  const appt = await prisma.tcAppointment.findUnique({ where: { frAppointmentId: frId } });
  if (!appt) return NextResponse.json({ error: 'appt not found' });

  const tech = await prisma.technician.findUnique({ where: { techId: appt.techId || '' }, select: { techId: true, name: true, bouncieDevice: { select: { deviceId: true } } } });
  const cust = appt.customerId ? await prisma.customer.findFirst({ where: { externalId: appt.customerId }, select: { lat: true, lng: true, serviceAddr: true } }) : null;

  const imei = tech?.bouncieDevice?.deviceId;
  const out: any = {
    appt: { frId, techId: appt.techId, date: appt.date, customerId: appt.customerId, timeAtJobMins: appt.timeAtJobMins },
    tech: { name: tech?.name, imei }, cust,
  };

  if (imei && cust?.lat) {
    const dayStr = appt.date.toISOString().split('T')[0];
    const dayStart = new Date(dayStr + 'T09:00:00.000Z');
    const dayEnd = new Date(dayStr + 'T05:00:00.000Z'); dayEnd.setDate(dayEnd.getDate() + 1);
    const pts = await prisma.bouncieTripEvent.findMany({ where: { imei, timestamp: { gte: dayStart, lte: dayEnd } }, orderBy: { timestamp: 'asc' }, select: { timestamp: true, lat: true, lng: true, speed: true } });
    const inside = pts.filter(p => haversine(p.lat, p.lng, cust.lat!, cust.lng!) <= R_M);
    const stopped = inside.filter(p => p.speed === 0);

    // Corrected computation preview: arrival->departure per visit, new visit only on real leave
    const mask = pts.map(p => haversine(p.lat, p.lng, cust.lat!, cust.lng!) <= R_M);
    let totalMins = 0, visits = 0, vStart = -1, vEnd = -1, lastIn = false, leftSince = false;
    for (let i = 0; i < pts.length; i++) {
      if (mask[i]) {
        const t = pts[i].timestamp.getTime();
        if (vStart < 0) { vStart = t; vEnd = t; }
        else if (!lastIn && leftSince && vEnd !== vStart) { totalMins += (vEnd - vStart) / 60000; visits++; vStart = t; }
        vEnd = t; lastIn = true; leftSince = false;
      } else { if (lastIn) leftSince = true; lastIn = false; }
    }
    if (vStart >= 0) { totalMins += (vEnd - vStart) / 60000; visits++; }
    out.correctedComputation = { timeAtJobMins: Math.round(totalMins * 10) / 10, visits };

    out.gps = {
      totalDayPoints: pts.length, insideGeofence: inside.length, stoppedInside: stopped.length,
      firstInside: inside[0]?.timestamp, lastInside: inside[inside.length - 1]?.timestamp,
      firstStopped: stopped[0]?.timestamp, lastStopped: stopped[stopped.length - 1]?.timestamp,
      speedDistribution: { zero: stopped.length, nonzero: inside.length - stopped.length },
    };
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
