// Shared close-out detection — used by the daily Slack report, dispatch sync, and Field Performance so the
// definition stays consistent across the hub.
//
// A CO job counts as CLOSED OUT if EITHER:
//   (a) the appointment notes contain a closeout keyword (legacy signal), OR
//   (b) the customer has a template-86 "Closed-Out" marker form uploaded within ±CLOSEOUT_FORM_WINDOW_DAYS
//       of the CO appointment date, in ANY state (WIP included — the forms are kept internal, not completed).
//
// Rationale: not all techs write the keyword note, but almost all upload the Closed-Out form. The mere
// EXISTENCE of a template-86 form near the appointment date is the closeout indicator (we don't read the
// form's fields — WIP forms don't expose them, and completing them would send them to the customer).

export const CLOSEOUT_KEYWORDS = ['ready for insulation', 'ready for far', 'closed out'];
export const CLOSEOUT_FORM_TEMPLATE_ID = 86; // the blank "Closed-Out" marker form
export const CLOSEOUT_FORM_WINDOW_DAYS = 2;  // lenient: form uploaded within ±2 days of the CO appt counts

export function hasCloseoutNote(appt: any): boolean {
  const text = [appt?.officeNotes, appt?.techNotes, appt?.notes].filter(Boolean).join(' ').toLowerCase();
  return CLOSEOUT_KEYWORDS.some(k => text.includes(k));
}

// Fetch a customer's Closed-Out (template-86) form upload dates. Returns an array of Date (dateAdded).
// frFetchJson: a caller-provided function (url) => Promise<any> so this helper stays transport-agnostic and
// reuses each caller's existing throttled FR fetch.
export async function getCloseoutFormDates(
  customerID: string | number,
  frBase: string,
  key: string,
  token: string,
  frFetchJson: (url: string) => Promise<any>,
): Promise<Date[]> {
  const searchUrl = `${frBase}/form/search?customerID=${customerID}&authenticationKey=${key}&authenticationToken=${token}`;
  const search = await frFetchJson(searchUrl).catch(() => ({}));
  const ids: any[] = search?.contractIDs || search?.formIDs || [];
  if (!ids.length) return [];
  const idParam = ids.length === 1 ? `${ids[0]},${ids[0]}` : ids.join(',');
  const getUrl = `${frBase}/form/get?contractIDs=${idParam}&authenticationKey=${key}&authenticationToken=${token}`;
  const got = await frFetchJson(getUrl).catch(() => ({}));
  const forms: any[] = got?.forms || got?.contracts || [];
  return forms
    .filter(f => parseInt(String(f.formTemplateID)) === CLOSEOUT_FORM_TEMPLATE_ID)
    .map(f => new Date(f.dateAdded))
    .filter(d => !isNaN(d.getTime()));
}

// Does any Closed-Out form fall within ±window days of the appointment date?
export function formWithinWindow(formDates: Date[], apptDate: Date, windowDays = CLOSEOUT_FORM_WINDOW_DAYS): boolean {
  const ms = windowDays * 24 * 60 * 60 * 1000;
  const t = apptDate.getTime();
  return formDates.some(d => Math.abs(d.getTime() - t) <= ms);
}

// Load Closed-Out form dates from the closeout_forms CACHE TABLE (populated by closeout-forms-sync) for a set
// of customers. Returns a Map<customerId, Date[]>. This is the scalable path — no live FR calls — used by the
// detection systems that run across offices/wide windows (dispatch, Field Performance).
export async function loadCloseoutFormDates(prisma: any, customerIds: string[]): Promise<Map<string, Date[]>> {
  const map = new Map<string, Date[]>();
  if (!customerIds.length) return map;
  const rows = await prisma.closeoutForm.findMany({
    where: { customerId: { in: customerIds }, formTemplateId: CLOSEOUT_FORM_TEMPLATE_ID },
    select: { customerId: true, dateAdded: true },
  });
  for (const r of rows) {
    if (!map.has(r.customerId)) map.set(r.customerId, []);
    map.get(r.customerId)!.push(new Date(r.dateAdded));
  }
  return map;
}
