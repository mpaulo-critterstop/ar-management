import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { perm } from '@/lib/access';

// GET /api/my-team — crew-scoped performance for a team leader (isTeamLeader).
// Crew = active technicians whose crewLeader = the leader's own name (leader included).
// View-only: returns each member's latest week + YTD + the metrics needed for the
// team / driving / attendance / TC-accountability views. No editing.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sUser = session.user as any;

  // Must be a team leader.
  if (!perm(sUser, 'isTeamLeader')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Resolve the leader's own technician record (by linked techId, else email).
  const leader = sUser.techId
    ? await prisma.technician.findFirst({ where: { techId: sUser.techId } })
    : await prisma.technician.findFirst({ where: { email: sUser.email } });
  if (!leader) return NextResponse.json({ error: 'No technician linked to this account. Contact your administrator.' }, { status: 404 });

  // Crew: active techs whose crewLeader is this leader (includes the leader themselves).
  const crew = await prisma.technician.findMany({
    where: { crewLeader: leader.name, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });
  const crewIds = crew.map(c => c.techId);

  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);

  // All weeks for the whole crew this year, one query.
  const allWeeks = await prisma.techWeek.findMany({
    where: { techId: { in: crewIds }, weekEnd: { gte: yearStart } },
    orderBy: { weekEnd: 'desc' },
  });

  // Most recent week-end present, to scope the daily attendance drill-down.
  const latestWeekEnd = allWeeks[0]?.weekEnd || null;

  // Daily attendance rows for the crew for the latest week (for the per-member day breakdown).
  const dayRows = latestWeekEnd
    ? await prisma.techDayAttendance.findMany({
        where: { techId: { in: crewIds }, weekEnd: latestWeekEnd },
        orderBy: { date: 'asc' },
      })
    : [];

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  // Build per-member summary.
  const members = crew.map(c => {
    const weeks = allWeeks.filter(w => w.techId === c.techId);
    const latest = weeks[0] || null;
    const ytd = avg(weeks.filter(w => w.totalScore !== null).map(w => w.totalScore!));
    const days = dayRows.filter(d => d.techId === c.techId).map(d => ({
      date: d.date, status: d.status, scheduledHrs: d.scheduledHrs,
      startTime: d.startTime, finishTime: d.finishTime, minutesLate: d.minutesLate, hrsWorked: d.hrsWorked,
    }));
    return {
      techId: c.techId,
      name: c.name,
      team: c.team,
      office: c.office,
      isLeader: c.techId === leader.techId,
      latest,          // full latest TechWeek row (driving raw incl. maxSpeed/safetyAlertsPer1k/idleRatio)
      ytd,
      weekCount: weeks.length,
      days,            // daily attendance rows for the latest week
    };
  });

  // Team average = avg of members' latest weekly totalScore (only those with a score).
  const latestScores = members.map(m => m.latest?.totalScore).filter((s): s is number => s !== null && s !== undefined);
  const teamAvgWeekly = avg(latestScores);
  const teamAvgYtd = avg(members.map(m => m.ytd).filter((s): s is number => s !== null && s !== undefined));

  return NextResponse.json({
    leader: { techId: leader.techId, name: leader.name, team: leader.team, office: leader.office },
    members,
    teamAvgWeekly,
    teamAvgYtd,
    memberCount: members.length,
    latestWeekEnd,
  });
}
