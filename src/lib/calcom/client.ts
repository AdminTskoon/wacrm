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
  locations?: unknown[];
}

export interface CalcomBookingAttendee {
  name: string;
  email: string;
  timeZone?: string;
  phoneNumber?: string;
}

export interface CreateBookingInput {
  start: string; // ISO 8601 UTC string (ex: "2026-10-20T10:00:00.000Z")
  eventTypeId?: number;
  eventTypeSlug?: string;
  username?: string;
  attendee: CalcomBookingAttendee;
  metadata?: Record<string, unknown>;
  notes?: string;
}

export interface CalcomBooking {
  id: number | string;
  uid: string;
  title?: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  status: string; // 'accepted' | 'cancelled' | 'pending' | ...
  eventTypeId?: number;
  eventType?: {
    slug?: string;
    title?: string;
  };
  attendees?: Array<{
    name?: string;
    email?: string;
    phoneNumber?: string;
  }>;
}

export function slugify(text: string): string {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getCalcomConfig(): CalcomConfig {
  let apiUrl = (process.env.CAL_API_URL || 'https://api.cal.com/v2').replace(/\/+$/, '');
  if (apiUrl.endsWith('/v1')) {
    apiUrl = apiUrl.replace(/\/v1$/, '/v2');
  }
  return {
    apiKey: process.env.CAL_API_KEY?.trim(),
    username: (process.env.CAL_USERNAME || process.env.NEXT_PUBLIC_CAL_USERNAME)?.trim(),
    apiUrl,
    publicUrl: (process.env.CAL_PUBLIC_URL || 'https://cal.com').replace(/\/+$/, ''),
  };
}

/**
 * Returns HTTP headers for Cal.com API v2
 * Note: event-types and bookings use specific API version dates in Cal.com Platform v2
 */
export function getCalcomHeaders(
  apiKey: string,
  scope: 'event-types' | 'bookings' = 'event-types'
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'cal-api-version': scope === 'event-types' ? '2024-06-14' : '2024-08-13',
  };
}

/**
 * Robustly formats error responses returned by Cal.com API into a readable string
 */
function parseCalcomError(data: any, status: number, statusText: string, rawText?: string): string {
  if (typeof data === 'string' && data.trim()) return data.trim();

  if (data?.message) {
    if (typeof data.message === 'string') return data.message;
    if (Array.isArray(data.message)) {
      return data.message
        .map((item: any) =>
          typeof item === 'string'
            ? item
            : item?.message || (item?.path ? `${item.path.join('.')}: ${item.message}` : JSON.stringify(item))
        )
        .filter(Boolean)
        .join('; ');
    }
  }

  if (data?.error) {
    if (typeof data.error === 'string') return data.error;
    if (typeof data.error.message === 'string') return data.error.message;
    if (Array.isArray(data.error)) {
      return data.error
        .map((item: any) =>
          typeof item === 'string' ? item : item?.message || JSON.stringify(item)
        )
        .filter(Boolean)
        .join('; ');
    }
    return JSON.stringify(data.error);
  }

  if (rawText && typeof rawText === 'string') {
    const clean = rawText.replace(/<[^>]*>?/gm, '').trim();
    if (clean) return clean.slice(0, 200);
  }

  return `Erreur Cal.com (${status}: ${statusText})`;
}

/**
 * Creates an Event Type in Cal.com (API v2)
 */
export async function createCalcomEventType(
  input: CreateEventTypeInput,
  overrideApiKey?: string
): Promise<{ ok: true; eventType: CalcomEventType } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non trouvée. Veuillez renseigner CAL_API_KEY dans votre fichier .env.local.',
    };
  }

  const slug = input.slug?.trim() || slugify(input.title);
  const length = Number(input.length) || 30;

  try {
    const url = `${config.apiUrl}/event-types`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getCalcomHeaders(apiKey, 'event-types'),
      body: JSON.stringify({
        title: input.title,
        slug,
        length,
        lengthInMinutes: length,
        description: input.description || '',
        hidden: input.hidden ?? false,
      }),
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const msg = parseCalcomError(data, response.status, response.statusText, rawText);
      console.error('[Cal.com create error]', { status: response.status, data, rawText, msg });
      return { ok: false, error: msg };
    }

    const eventType = data?.data || data?.event_type || data?.eventType || data;
    return {
      ok: true,
      eventType: {
        id: eventType.id,
        title: eventType.title || input.title,
        slug: eventType.slug || slug,
        length: eventType.lengthInMinutes || eventType.length || length,
        description: eventType.description,
        hidden: eventType.hidden,
      },
    };
  } catch (err: any) {
    console.error('[Cal.com network error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors de la communication avec Cal.com',
    };
  }
}

/**
 * Updates an Event Type in Cal.com (API v2)
 */
export async function updateCalcomEventType(
  id: number,
  input: Partial<CreateEventTypeInput>,
  overrideApiKey?: string
): Promise<{ ok: true; eventType: CalcomEventType } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non configurée. Veuillez renseigner CAL_API_KEY dans votre fichier .env.local',
    };
  }

  try {
    const url = `${config.apiUrl}/event-types/${id}`;
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.slug !== undefined) body.slug = input.slug;
    if (input.length !== undefined) {
      body.lengthInMinutes = Number(input.length);
    }
    if (input.description !== undefined) body.description = input.description;
    if (input.hidden !== undefined) body.hidden = input.hidden;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: getCalcomHeaders(apiKey, 'event-types'),
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const msg = parseCalcomError(data, response.status, response.statusText, rawText);
      console.error('[Cal.com update error]', { status: response.status, data, rawText, msg });
      return { ok: false, error: msg };
    }

    const eventType = data?.data || data?.event_type || data?.eventType || data;
    return {
      ok: true,
      eventType: {
        id: eventType.id || id,
        title: eventType.title || input.title || '',
        slug: eventType.slug || input.slug || '',
        length: eventType.lengthInMinutes || eventType.length || input.length || 30,
        description: eventType.description,
        hidden: eventType.hidden,
      },
    };
  } catch (err: any) {
    console.error('[Cal.com network error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors de la communication avec Cal.com',
    };
  }
}

/**
 * Deletes an Event Type in Cal.com by ID (API v2)
 */
export async function deleteCalcomEventType(
  id: number,
  overrideApiKey?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non configurée.',
    };
  }

  try {
    const url = `${config.apiUrl}/event-types/${id}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getCalcomHeaders(apiKey, 'event-types'),
    });

    if (response.ok || response.status === 404) {
      return { ok: true };
    }

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
    const msg = parseCalcomError(data, response.status, response.statusText, rawText);
    return { ok: false, error: msg };
  } catch (err: any) {
    console.error('[Cal.com delete error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors de la suppression de l’événement Cal.com',
    };
  }
}

/**
 * Lists Event Types from Cal.com (API v2)
 */
export async function listCalcomEventTypes(
  overrideApiKey?: string
): Promise<{ ok: true; eventTypes: CalcomEventType[] } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non configurée (CAL_API_KEY).',
    };
  }

  try {
    const url = `${config.apiUrl}/event-types`;
    const response = await fetch(url, {
      method: 'GET',
      headers: getCalcomHeaders(apiKey, 'event-types'),
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const msg = parseCalcomError(data, response.status, response.statusText, rawText);
      console.error('[Cal.com list error]', { status: response.status, data, rawText, msg });
      return { ok: false, error: msg };
    }

    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.event_types)
        ? data.event_types
        : Array.isArray(data?.eventTypes)
          ? data.eventTypes
          : Array.isArray(data)
            ? data
            : [];

    const eventTypes: CalcomEventType[] = rawList.map((item: any) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      length: item.lengthInMinutes || item.length,
      description: item.description,
      hidden: item.hidden,
    }));

    return { ok: true, eventTypes };
  } catch (err: any) {
    console.error('[Cal.com network error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors de la communication avec Cal.com',
    };
  }
}

/**
 * Deletes an Event Type in Cal.com by Slug (API v2)
 */
export async function deleteCalcomEventTypeBySlug(
  slug: string,
  overrideApiKey?: string
): Promise<{ ok: true; notFound?: boolean } | { ok: false; error: string }> {
  const cleanSlug = slug.trim().toLowerCase();
  const listRes = await listCalcomEventTypes(overrideApiKey);

  if (!listRes.ok) {
    return listRes;
  }

  const existing = listRes.eventTypes.find(
    (et) => et.slug.toLowerCase() === cleanSlug
  );

  if (!existing) {
    return { ok: true, notFound: true };
  }

  return deleteCalcomEventType(existing.id, overrideApiKey);
}

/**
 * Creates or updates an event type by slug, or links to existing if already on Cal.com
 */
export async function syncCalcomEventType(
  input: CreateEventTypeInput,
  existingSlug?: string | null,
  overrideApiKey?: string
): Promise<{ ok: true; eventType: CalcomEventType } | { ok: false; error: string }> {
  const candidateSlug = (existingSlug?.trim() || input.slug?.trim() || slugify(input.title)).toLowerCase();

  const listResult = await listCalcomEventTypes(overrideApiKey);

  if (listResult.ok && Array.isArray(listResult.eventTypes)) {
    const existing = listResult.eventTypes.find(
      (et) => et.slug.toLowerCase() === candidateSlug
    );

    if (existing) {
      // Événement trouvé dans Cal.com : mise à jour
      return updateCalcomEventType(
        existing.id,
        {
          title: input.title,
          length: input.length,
          description: input.description,
          ...(input.slug && input.slug.toLowerCase() !== existing.slug.toLowerCase()
            ? { slug: input.slug.toLowerCase() }
            : {}),
          ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
        },
        overrideApiKey
      );
    }
  }

  // Tente la création sur Cal.com
  const createResult = await createCalcomEventType(
    {
      ...input,
      slug: candidateSlug,
    },
    overrideApiKey
  );

  if (!createResult.ok) {
    const errLower = createResult.error.toLowerCase();
    const isConflict =
      errLower.includes('already has an event') ||
      errLower.includes('slug') ||
      errLower.includes('already exist') ||
      errLower.includes('conflict');

    if (isConflict) {
      console.log(`[Cal.com] Event type with slug "${candidateSlug}" already exists. Linking service to it.`);
      return {
        ok: true,
        eventType: {
          id: 0,
          title: input.title,
          slug: candidateSlug,
          length: input.length || 30,
          description: input.description,
        },
      };
    }
  }

  return createResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAL.COM BOOKINGS API (v2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a Booking in Cal.com (API v2)
 */
export async function createCalcomBooking(
  input: CreateBookingInput,
  overrideApiKey?: string
): Promise<{ ok: true; booking: CalcomBooking } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non configurée (CAL_API_KEY).',
    };
  }

  try {
    let resolvedEventTypeId = input.eventTypeId;

    // Si on a un slug d'événement mais pas d'eventTypeId, on résout son ID
    if (!resolvedEventTypeId && input.eventTypeSlug) {
      const listRes = await listCalcomEventTypes(apiKey);
      if (listRes.ok) {
        const found = listRes.eventTypes.find(
          (et) => et.slug.toLowerCase() === input.eventTypeSlug!.toLowerCase()
        );
        if (found) {
          resolvedEventTypeId = found.id;
        }
      }
    }

    // Email valide requis par Cal.com v2 (le domaine doit pouvoir recevoir du courrier)
    let attendeeEmail = input.attendee.email?.trim();
    if (!attendeeEmail || !attendeeEmail.includes('@')) {
      const fallback = process.env.CAL_ATTENDEE_EMAIL_FALLBACK?.trim();
      if (!fallback || !fallback.includes('@')) {
        return {
          ok: false,
          error:
            "Le contact n'a pas d'e-mail. Renseignez CAL_ATTENDEE_EMAIL_FALLBACK dans .env.local (adresse réelle).",
        };
      }
      const [local, domain] = fallback.split('@');
      const suffix =
        input.attendee.phoneNumber?.replace(/[^0-9]/g, '') ||
        slugify(input.attendee.name || 'client');
      // "vous@gmail.com" devient "vous+261340000000@gmail.com" (arrive dans la même boîte)
      attendeeEmail = local.includes('+') || !suffix ? fallback : `${local}+${suffix}@${domain}`;
    }

    const payload: Record<string, unknown> = {
      start: input.start,
      attendee: {
        name: input.attendee.name.trim() || 'Client',
        email: attendeeEmail,
        timeZone: input.attendee.timeZone || 'Europe/Paris',
        ...(input.attendee.phoneNumber ? { phoneNumber: input.attendee.phoneNumber.trim() } : {}),
      },
    };

    if (resolvedEventTypeId) {
      payload.eventTypeId = Number(resolvedEventTypeId);
    } else if (input.eventTypeSlug) {
      payload.eventTypeSlug = input.eventTypeSlug;
      if (input.username || config.username) {
        payload.username = input.username || config.username;
      }
    }

    if (input.metadata) {
      payload.metadata = input.metadata;
    }

    const url = `${config.apiUrl}/bookings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getCalcomHeaders(apiKey, 'bookings'),
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const msg = parseCalcomError(data, response.status, response.statusText, rawText);
      console.error('[Cal.com booking create error]', { status: response.status, data, rawText, msg });
      return { ok: false, error: msg };
    }

    const bookingData = data?.data || data?.booking || data;
    return {
      ok: true,
      booking: {
        id: bookingData.id,
        uid: bookingData.uid || String(bookingData.id),
        title: bookingData.title,
        description: bookingData.description,
        startTime: bookingData.start || bookingData.startTime || input.start,
        endTime: bookingData.end || bookingData.endTime,
        status: bookingData.status || 'accepted',
        eventTypeId: bookingData.eventTypeId || resolvedEventTypeId,
        eventType: bookingData.eventType,
        attendees: bookingData.attendees,
      },
    };
  } catch (err: any) {
    console.error('[Cal.com create booking network error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors de la création de la réservation sur Cal.com',
    };
  }
}

/**
 * Reschedules an existing Cal.com booking (API v2)
 */
export async function rescheduleCalcomBooking(
  bookingUid: string,
  input: { start: string; reason?: string },
  overrideApiKey?: string
): Promise<{ ok: true; booking: Partial<CalcomBooking> } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non configurée.',
    };
  }

  try {
    const url = `${config.apiUrl}/bookings/${encodeURIComponent(bookingUid)}/reschedule`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getCalcomHeaders(apiKey, 'bookings'),
      body: JSON.stringify({
        start: input.start,
        reschedulingReason: input.reason || 'Déplacement du rendez-vous',
      }),
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const msg = parseCalcomError(data, response.status, response.statusText, rawText);
      console.error('[Cal.com reschedule error]', { status: response.status, data, rawText, msg });
      return { ok: false, error: msg };
    }

    const bookingData = data?.data || data?.booking || data;
    return {
      ok: true,
      booking: {
        id: bookingData?.id,
        uid: bookingData?.uid || bookingUid,
        startTime: bookingData?.start || input.start,
        status: bookingData?.status || 'accepted',
      },
    };
  } catch (err: any) {
    console.error('[Cal.com reschedule network error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors du report de la réservation sur Cal.com',
    };
  }
}

/**
 * Cancels an existing Cal.com booking (API v2)
 */
export async function cancelCalcomBooking(
  bookingUid: string,
  reason?: string,
  overrideApiKey?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non configurée.',
    };
  }

  try {
    const url = `${config.apiUrl}/bookings/${encodeURIComponent(bookingUid)}/cancel`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getCalcomHeaders(apiKey, 'bookings'),
      body: JSON.stringify({
        cancellationReason: reason || 'Annulation depuis WA-CRM',
      }),
    });

    if (response.ok || response.status === 404) {
      return { ok: true };
    }

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
    const msg = parseCalcomError(data, response.status, response.statusText, rawText);
    return { ok: false, error: msg };
  } catch (err: any) {
    console.error('[Cal.com cancel network error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors de l’annulation sur Cal.com',
    };
  }
}

/**
 * Lists Bookings from Cal.com (API v2)
 */
export async function listCalcomBookings(
  options?: { status?: string; take?: number; skip?: number },
  overrideApiKey?: string
): Promise<{ ok: true; bookings: CalcomBooking[] } | { ok: false; error: string }> {
  const config = getCalcomConfig();
  const apiKey = overrideApiKey?.trim() || config.apiKey;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Clé API Cal.com non configurée.',
    };
  }

  try {
    const searchParams = new URLSearchParams();
    if (options?.status) searchParams.set('status', options.status);
    if (options?.take) searchParams.set('take', String(options.take));
    if (options?.skip) searchParams.set('skip', String(options.skip));

    const qs = searchParams.toString();
    const url = `${config.apiUrl}/bookings${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: getCalcomHeaders(apiKey, 'bookings'),
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok) {
      const msg = parseCalcomError(data, response.status, response.statusText, rawText);
      console.error('[Cal.com list bookings error]', { status: response.status, data, rawText, msg });
      return { ok: false, error: msg };
    }

    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.bookings)
        ? data.bookings
        : Array.isArray(data)
          ? data
          : [];

    const bookings: CalcomBooking[] = rawList.map((item: any) => ({
      id: item.id,
      uid: item.uid || String(item.id),
      title: item.title,
      description: item.description,
      startTime: item.start || item.startTime,
      endTime: item.end || item.endTime,
      status: item.status,
      eventTypeId: item.eventTypeId,
      eventType: item.eventType,
      attendees: item.attendees,
    }));

    return { ok: true, bookings };
  } catch (err: any) {
    console.error('[Cal.com list bookings network error]', err);
    return {
      ok: false,
      error: err?.message || 'Erreur réseau lors de la récupération des réservations Cal.com',
    };
  }
}
