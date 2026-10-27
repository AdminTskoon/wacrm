import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { syncCalcomEventType } from '@/lib/calcom/client';
import { getCalcomConfig } from '@/lib/calcom/client';

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    const { data, error } = await ctx.supabase
      .from('services')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('vertical', { ascending: true })
      .order('title', { ascending: true });

    if (error) {
      console.error('[services GET] supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ services: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const config = getCalcomConfig();

    const body = (await request.json().catch(() => null)) as {
      title?: string;
      vertical?: string;
      booking_mode?: string;
      description?: string;
      price?: number;
      currency?: string;
      image_url?: string;
      attributes?: unknown;
      status?: string;
      cal_event_slug?: string;
      cal_username?: string;
      duration_minutes?: number;
      sync_calcom?: boolean;
    } | null;

    if (!body?.title?.trim()) {
      return NextResponse.json({ error: 'Le titre du service est requis' }, { status: 400 });
    }
    if (!body?.vertical?.trim()) {
      return NextResponse.json({ error: 'La vertical est requise' }, { status: 400 });
    }

    let resolvedSlug = body.cal_event_slug?.trim() ?? null;
    let resolvedUsername = body.cal_username?.trim() || config.username || null;

    // ── 1. Sync with Cal.com if requested ────────────────────────
    if (body.sync_calcom && config.apiKey) {
      const calResult = await syncCalcomEventType(
        {
          title: body.title.trim(),
          slug: resolvedSlug || undefined,
          length: Number(body.duration_minutes) || 30,
          description: body.description?.trim() || undefined,
        },
        resolvedSlug || undefined,
      );

      if (!calResult.ok) {
        return NextResponse.json({ error: calResult.error }, { status: 400 });
      }

      resolvedSlug = calResult.eventType.slug ?? resolvedSlug;
      resolvedUsername = config.username || resolvedUsername;
    }

    // ── 2. Insert into Supabase ───────────────────────────────────
    const payload = {
      account_id: ctx.accountId,
      vertical: body.vertical?.trim() || null,
      booking_mode: body.booking_mode?.trim() || null,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      price: body.price != null ? Number(body.price) : null,
      currency: body.currency || 'EUR',
      image_url: body.image_url?.trim() || null,
      attributes: body.attributes ?? null,
      status: body.status?.trim() || 'active',
      cal_event_slug: resolvedSlug || null,
      cal_username: resolvedUsername || null,
    };

    const { data, error } = await ctx.supabase
      .from('services')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('[services POST] supabase insert error:', error);
      return NextResponse.json(
        { error: `Erreur base de données: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      service: data,
      cal_event_slug: resolvedSlug,
      cal_username: resolvedUsername,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const config = getCalcomConfig();

    const body = (await request.json().catch(() => null)) as {
      id?: string;
      title?: string;
      vertical?: string;
      booking_mode?: string;
      description?: string;
      price?: number;
      currency?: string;
      image_url?: string;
      attributes?: unknown;
      status?: string;
      cal_event_slug?: string;
      cal_username?: string;
      duration_minutes?: number;
      sync_calcom?: boolean;
    } | null;

    if (!body?.id) {
      return NextResponse.json({ error: 'id du service requis' }, { status: 400 });
    }
    if (!body?.title?.trim()) {
      return NextResponse.json({ error: 'Le titre du service est requis' }, { status: 400 });
    }

    let resolvedSlug = body.cal_event_slug?.trim() ?? null;
    let resolvedUsername = body.cal_username?.trim() || config.username || null;

    // ── 1. Sync with Cal.com if requested ────────────────────────
    if (body.sync_calcom && config.apiKey) {
      const calResult = await syncCalcomEventType(
        {
          title: body.title.trim(),
          slug: resolvedSlug || undefined,
          length: Number(body.duration_minutes) || 30,
          description: body.description?.trim() || undefined,
        },
        resolvedSlug || undefined,
      );

      if (!calResult.ok) {
        return NextResponse.json({ error: calResult.error }, { status: 400 });
      }

      resolvedSlug = calResult.eventType.slug ?? resolvedSlug;
      resolvedUsername = config.username || resolvedUsername;
    }

    // ── 2. Update in Supabase ─────────────────────────────────────
    const payload: Record<string, unknown> = {
      vertical: body.vertical?.trim() || null,
      booking_mode: body.booking_mode?.trim() || null,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      price: body.price != null ? Number(body.price) : null,
      currency: body.currency || 'EUR',
      image_url: body.image_url?.trim() || null,
      attributes: body.attributes ?? null,
      status: body.status?.trim() || 'active',
      cal_event_slug: resolvedSlug || null,
      cal_username: resolvedUsername || null,
    };

    const { data, error } = await ctx.supabase
      .from('services')
      .update(payload)
      .eq('id', body.id)
      .eq('account_id', ctx.accountId)
      .select()
      .single();

    if (error) {
      console.error('[services PATCH] supabase update error:', error);
      return NextResponse.json(
        { error: `Erreur base de données: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      service: data,
      cal_event_slug: resolvedSlug,
      cal_username: resolvedUsername,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
