import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createCalcomBooking, cancelCalcomBooking } from '@/lib/calcom/client';

// Cal.com attend un numéro au format international (+...)
function toE164(raw?: string) {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : undefined;
}

export async function POST(request: Request) {
  try {
    await requireRole('agent');

    const body = (await request.json().catch(() => null)) as {
      eventTypeSlug?: string;
      username?: string;
      start?: string;
      name?: string;
      phone?: string;
      email?: string;
      timeZone?: string;
    } | null;

    if (!body?.eventTypeSlug?.trim() || !body?.start) {
      return NextResponse.json(
        { ok: false, error: "Slug d'événement et date de début requis" },
        { status: 400 }
      );
    }

    const result = await createCalcomBooking({
      start: body.start,
      eventTypeSlug: body.eventTypeSlug.trim(),
      username: body.username?.trim() || undefined,
      attendee: {
        name: body.name?.trim() || 'Client',
        email: body.email?.trim() || '',
        timeZone: body.timeZone,
        phoneNumber: toE164(body.phone),
      },
      // Permet au webhook Cal.com de reconnaître les réservations créées depuis l'interface
      metadata: { source: 'wacrm_ui' },
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, booking: result.booking });
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Annulation (utilisée pour le rollback si l'enregistrement en base échoue)
export async function DELETE(request: Request) {
  try {
    await requireRole('agent');

    const body = (await request.json().catch(() => null)) as {
      uid?: string;
      reason?: string;
    } | null;

    if (!body?.uid) return NextResponse.json({ ok: true, skipped: true });

    const result = await cancelCalcomBooking(body.uid, body.reason);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}