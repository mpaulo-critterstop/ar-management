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
    out.gps = {
      totalDayPoints: pts.length, insideGeofence: inside.length, stoppedInside: stopped.length,
      firstInside: inside[0]?.timestamp, lastInside: inside[inside.length - 1]?.timestamp,
      firstStopped: stopped[0]?.timestamp, lastStopped: stopped[stopped.length - 1]?.timestamp,
      speedDistribution: { zero: stopped.length, nonzero: inside.length - stopped.length },
      sampleInside: inside.slice(0, 15).map(p => ({ t: p.timestamp, speed: p.speed, dist: Math.round(haversine(p.lat, p.lng, cust.lat!, cust.lng!)) })),
      // gaps between consecutive stopped points (to see why segments break)
      stoppedGaps: stopped.slice(1).map((p, i) => Math.round((p.timestamp.getTime() - stopped[i].timestamp.getTime()) / 1000)).filter(g => g > 60).slice(0, 20),
    };
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
