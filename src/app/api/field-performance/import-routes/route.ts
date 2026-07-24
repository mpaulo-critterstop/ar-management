import { NextRequest, NextResponse } from 'next/server';

// DEPRECATED (2026-07-23). Production + completion are now populated by the `week` endpoint
// (writes tech_routes + techWeek with the no-show fix applied). This CSV importer used to write
// the SAME techWeek.productionValue / completionPct, so running it would OVERWRITE the
// authoritative pipeline values with CSV data — a footgun. It is no longer part of the weekly
// pipeline (see PIPELINE.md) and is disabled.
//
// The original CSV-import implementation is preserved in git history (pre-commit e7f8549)
// if a manual import is ever needed again.
export async function POST(_req: NextRequest) {
  return NextResponse.json({
    error: 'import-routes is deprecated. Production and completion are populated by the `week` endpoint. See PIPELINE.md.',
    deprecated: true,
  }, { status: 410 });
}
