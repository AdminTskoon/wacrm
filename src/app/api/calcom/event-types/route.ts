import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  getCalcomConfig,
  listCalcomEventTypes,
  syncCalcomEventType,
  deleteCalcomEventTypeBySlug,
} from '@/lib/calcom/client';

export async function GET() {
  try {
    await requireRole('agent');
    const config = getCalcomConfig();

    if (!config.apiKey) {
      return NextResponse.json({
        configured: false,
        username: config.username || null,
        publicUrl: config.publicUrl,
        eventTypes: [],
        message: 'CAL_API_KEY non configurée',
      });
    }

    const result = await listCalcomEventTypes();

    if (!result.ok) {
      return NextResponse.json({
        configured: true,
        username: config.username || null,
        publicUrl: config.publicUrl,
        eventTypes: [],
        error: result.error,
      });
    }

    return NextResponse.json({
      configured: true,
      username: config.username || null,
      publicUrl: config.publicUrl,
      eventTypes: result.eventTypes,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole('agent');
    const config = getCalcomConfig();

    const body = (await request.json().catch(() => null)) as {
      title?: string;
      slug?: string;
      existingSlug?: string;
      length?: number;
      description?: string;
      hidden?: boolean;
    } | null;

    if (!body?.title?.trim()) {
      return NextResponse.json(
        { error: 'Le titre du service est requis pour Cal.com' },
        { status: 400 }
      );
    }

    const length = Number(body.length) || 30;

    const result = await syncCalcomEventType(
      {
        title: body.title.trim(),
        slug: body.slug?.trim() || undefined,
        length,
        description: body.description?.trim() || undefined,
        hidden: body.hidden,
      },
      body.existingSlug?.trim() || undefined
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      eventType: result.eventType,
      slug: result.eventType.slug,
      username: config.username || null,
      publicUrl: config.publicUrl,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    // Supprimer un event type = supprimer un service : réservé aux admins (cf. RLS services_delete)
    await requireRole('admin');

    const body = (await request.json().catch(() => null)) as { slug?: string } | null;
    const slug = body?.slug?.trim();

    if (!slug) return NextResponse.json({ ok: true, skipped: true });

    const result = await deleteCalcomEventTypeBySlug(slug);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, notFound: result.notFound ?? false });
  } catch (error) {
    return toErrorResponse(error);
  }
}

