export interface CalcomConfig {
  apiKey?: string;
  username?: string;
  apiUrl: string;
  publicUrl: string;
}

export interface CreateEventTypeInput {
  title: string;
  slug?: string;
  length: number; // in minutes
  description?: string;
  hidden?: boolean;
}

export interface CalcomEventType {
  id: number;
  title: string;
  slug: string;
  length: number;
  description?: string | null;
  hidden?: boolean;
}

export interface CalcomBookingAttendee {
  name: string;
  email: string;
  timeZone?: string;
  phoneNumber?: string;
}

export interface CreateBookingInput {
  start: string; // ISO 8601 UTC
  eventTypeSlug?: string;
  username?: string;
  attendee: CalcomBookingAttendee;
  metadata?: Record<string, unknown>;
}

export interface CalcomBooking {
  id?: number | string;
  uid: string;
  startTime: string;
  endTime?: string;
  status: string;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Json = Record<string, unknown>;

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getCalcomConfig(): CalcomConfig {
  const apiUrl = (process.env.CAL_API_URL || 'https://api.cal.com/v2')
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '/v2');
  return {
    apiKey: process.env.CAL_API_KEY?.trim(),
    username: (process.env.CAL_USERNAME || process.env.NEXT_PUBLIC_CAL_USERNAME)?.trim(),
    apiUrl,
    publicUrl: (process.env.CAL_PUBLIC_URL || 'https://cal.com').replace(/\/+$/, ''),
  };
}

function errorMessage(data: unknown, status: number, rawText: string): string {
  const d = data as { message?: unknown; error?: unknown } | null;
  const pick = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map((i) => pick(i) ?? JSON.stringify(i)).join('; ');
    if (v && typeof v === 'object' && 'message' in v) return pick((v as { message: unknown }).message);
    return null;
  };
  return (
    pick(d?.message) ??
    pick(d?.error) ??
    (rawText.replace(/<[^>]*>?/gm, '').trim().slice(0, 200) || `Erreur Cal.com (${status})`)
  );
}

// One place for auth, API-version header, JSON parsing and error shaping.
async function calRequest(
  scope: 'event-types' | 'bookings',
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: Json,
  okStatuses: number[] = []
): Promise<Result<{ data: unknown; status: number }>> {
  const { apiKey, apiUrl } = getCalcomConfig();
  if (!apiKey) return { ok: false, error: 'Clé API Cal.com non configurée (CAL_API_KEY).' };

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'cal-api-version': scope === 'event-types' ? '2024-06-14' : '2024-08-13',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const rawText = await response.text();
    let data: unknown = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
    if (!response.ok && !okStatuses.includes(response.status)) {
      const error = errorMessage(data, response.status, rawText);
      console.error(`[Cal.com ${method} ${path}]`, response.status, error);
      return { ok: false, error };
    }
    const inner = (data as { data?: unknown } | null)?.data ?? data;
    return { ok: true, data: inner, status: response.status };
  } catch (err) {
    console.error(`[Cal.com ${method} ${path}] network error`, err);
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau Cal.com' };
  }
}

function toEventType(raw: unknown, fallback: Partial<CalcomEventType> = {}): CalcomEventType {
  const e = (raw ?? {}) as Json;
  return {
    id: Number(e.id ?? fallback.id),
    title: String(e.title ?? fallback.title ?? ''),
    slug: String(e.slug ?? fallback.slug ?? ''),
    length: Number(e.lengthInMinutes ?? e.length ?? fallback.length ?? 30),
    description: (e.description as string | null | undefined) ?? fallback.description,
    hidden: (e.hidden as boolean | undefined) ?? fallback.hidden,
  };
}

export async function listCalcomEventTypes(): Promise<Result<{ eventTypes: CalcomEventType[] }>> {
  const res = await calRequest('event-types', '/event-types', 'GET');
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  return { ok: true, eventTypes: list.map((e) => toEventType(e)) };
}

async function findEventTypeBySlug(slug: string): Promise<Result<{ eventType?: CalcomEventType }>> {
  const list = await listCalcomEventTypes();
  if (!list.ok) return list;
  const wanted = slug.trim().toLowerCase();
  return { ok: true, eventType: list.eventTypes.find((e) => e.slug.toLowerCase() === wanted) };
}

export async function deleteCalcomEventTypeBySlug(
  slug: string
): Promise<Result<{ notFound?: boolean }>> {
  const found = await findEventTypeBySlug(slug);
  if (!found.ok) return found;
  if (!found.eventType) return { ok: true, notFound: true };
  const res = await calRequest('event-types', `/event-types/${found.eventType.id}`, 'DELETE', undefined, [404]);
  return res.ok ? { ok: true } : res;
}

/** Updates the event type whose slug matches, or creates it. */
export async function syncCalcomEventType(
  input: CreateEventTypeInput,
  existingSlug?: string | null
): Promise<Result<{ eventType: CalcomEventType }>> {
  const slug = (existingSlug?.trim() || input.slug?.trim() || slugify(input.title)).toLowerCase();
  const found = await findEventTypeBySlug(slug);
  if (!found.ok) return found;

  const length = Number(input.length) || 30;
  const fields: Json = {
    title: input.title,
    lengthInMinutes: length,
    description: input.description ?? '',
    ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
  };

  if (found.eventType) {
    const newSlug = input.slug?.trim().toLowerCase();
    const res = await calRequest('event-types', `/event-types/${found.eventType.id}`, 'PATCH', {
      ...fields,
      ...(newSlug && newSlug !== found.eventType.slug.toLowerCase() ? { slug: newSlug } : {}),
    });
    return res.ok ? { ok: true, eventType: toEventType(res.data, found.eventType) } : res;
  }

  const res = await calRequest('event-types', '/event-types', 'POST', { ...fields, slug });
  return res.ok
    ? { ok: true, eventType: toEventType(res.data, { title: input.title, slug, length }) }
    : res;
}

function toBooking(raw: unknown, fallbackStart: string): Result<{ booking: CalcomBooking }> {
  const b = (raw ?? {}) as Json;
  const uid = String(b.uid ?? b.id ?? '');
  // Sans uid, la réservation est introuvable ensuite (report, annulation, webhook)
  if (!uid) return { ok: false, error: 'Réponse Cal.com sans uid de réservation' };
  return {
    ok: true,
    booking: {
      id: b.id as number | string | undefined,
      uid,
      startTime: String(b.start ?? b.startTime ?? fallbackStart),
      endTime: (b.end ?? b.endTime) as string | undefined,
      status: String(b.status ?? 'accepted'),
    },
  };
}

// Cal.com v2 requires an attendee e-mail; contacts reached on WhatsApp often have none.
function resolveAttendeeEmail(attendee: CalcomBookingAttendee): Result<{ email: string }> {
  const own = attendee.email?.trim();
  if (own?.includes('@')) return { ok: true, email: own };

  const fallback = process.env.CAL_ATTENDEE_EMAIL_FALLBACK?.trim();
  if (!fallback?.includes('@')) {
    return {
      ok: false,
      error: "Le contact n'a pas d'e-mail. Renseignez CAL_ATTENDEE_EMAIL_FALLBACK (adresse réelle).",
    };
  }
  const [local, domain] = fallback.split('@');
  const suffix = attendee.phoneNumber?.replace(/\D/g, '') || slugify(attendee.name || 'client');
  // "rdv@x.com" -> "rdv+33612345678@x.com" : même boîte, un attendee distinct par contact
  return { ok: true, email: local.includes('+') || !suffix ? fallback : `${local}+${suffix}@${domain}` };
}

export async function createCalcomBooking(
  input: CreateBookingInput
): Promise<Result<{ booking: CalcomBooking }>> {
  const email = resolveAttendeeEmail(input.attendee);
  if (!email.ok) return email;

  let eventTarget: Json = {};
  if (input.eventTypeSlug) {
    const found = await findEventTypeBySlug(input.eventTypeSlug);
    const username = input.username || getCalcomConfig().username;
    eventTarget =
      found.ok && found.eventType
        ? { eventTypeId: found.eventType.id }
        : { eventTypeSlug: input.eventTypeSlug, ...(username ? { username } : {}) };
  }

  const res = await calRequest('bookings', '/bookings', 'POST', {
    start: input.start,
    ...eventTarget,
    attendee: {
      name: input.attendee.name.trim() || 'Client',
      email: email.email,
      timeZone: input.attendee.timeZone || 'Europe/Paris',
      ...(input.attendee.phoneNumber ? { phoneNumber: input.attendee.phoneNumber.trim() } : {}),
    },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  return res.ok ? toBooking(res.data, input.start) : res;
}

/** Cal.com issues a new uid for the rescheduled booking. */
export async function rescheduleCalcomBooking(
  bookingUid: string,
  input: { start: string; reason?: string }
): Promise<Result<{ booking: CalcomBooking }>> {
  const res = await calRequest('bookings', `/bookings/${encodeURIComponent(bookingUid)}/reschedule`, 'POST', {
    start: input.start,
    reschedulingReason: input.reason || 'Déplacement du rendez-vous',
  });
  return res.ok ? toBooking(res.data, input.start) : res;
}

export async function cancelCalcomBooking(
  bookingUid: string,
  reason?: string
): Promise<Result<object>> {
  const res = await calRequest(
    'bookings',
    `/bookings/${encodeURIComponent(bookingUid)}/cancel`,
    'POST',
    { cancellationReason: reason || 'Annulation depuis WA-CRM' },
    [404] // already gone on Cal.com: nothing left to cancel
  );
  return res.ok ? { ok: true } : res;
}
