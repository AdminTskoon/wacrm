import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelCalcomBooking,
  createCalcomBooking,
  rescheduleCalcomBooking,
  syncCalcomEventType,
} from "./client";

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
let responses: Array<{ status: number; body: unknown }>;

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubEnv("CAL_API_KEY", "cal_test");
  vi.stubEnv("CAL_API_URL", "https://cal.test/v2");
  vi.stubEnv("CAL_USERNAME", "owner");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const next = responses.shift() ?? { status: 200, body: { data: {} } };
      return new Response(JSON.stringify(next.body), { status: next.status });
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("syncCalcomEventType", () => {
  it("returns an error instead of a fake event type when creation fails on a slug error", async () => {
    responses.push(
      { status: 200, body: { data: [] } },
      { status: 400, body: { message: "slug must be a valid slug" } }
    );

    const res = await syncCalcomEventType({ title: "Coupe", length: 30 });

    expect(res).toEqual({ ok: false, error: "slug must be a valid slug" });
  });

  it("updates the existing event type matching the slug", async () => {
    responses.push(
      { status: 200, body: { data: [{ id: 7, title: "Coupe", slug: "coupe", lengthInMinutes: 30 }] } },
      { status: 200, body: { data: { id: 7, title: "Coupe", slug: "coupe", lengthInMinutes: 45 } } }
    );

    const res = await syncCalcomEventType({ title: "Coupe", length: 45 });

    expect(res).toMatchObject({ ok: true, eventType: { id: 7, slug: "coupe", length: 45 } });
    expect(calls[1]).toMatchObject({ url: "https://cal.test/v2/event-types/7", method: "PATCH" });
  });
});

describe("bookings", () => {
  it("reschedules by uid and returns the new uid", async () => {
    responses.push({ status: 201, body: { data: { uid: "new-uid", start: "2026-11-02T10:00:00Z" } } });

    const res = await rescheduleCalcomBooking("old-uid", { start: "2026-11-02T10:00:00Z" });

    expect(res).toMatchObject({ ok: true, booking: { uid: "new-uid" } });
    expect(calls[0]).toMatchObject({
      url: "https://cal.test/v2/bookings/old-uid/reschedule",
      method: "POST",
      body: { start: "2026-11-02T10:00:00Z" },
    });
  });

  it("treats a 404 on cancel as already cancelled", async () => {
    responses.push({ status: 404, body: { message: "not found" } });

    expect(await cancelCalcomBooking("gone")).toEqual({ ok: true });
  });

  it("plus-addresses the fallback mailbox when the contact has no e-mail", async () => {
    vi.stubEnv("CAL_ATTENDEE_EMAIL_FALLBACK", "rdv@example.com");
    responses.push(
      { status: 200, body: { data: [{ id: 3, title: "Coupe", slug: "coupe" }] } },
      { status: 201, body: { data: { uid: "u1", start: "2026-11-02T10:00:00Z" } } }
    );

    const res = await createCalcomBooking({
      start: "2026-11-02T10:00:00Z",
      eventTypeSlug: "coupe",
      attendee: { name: "Rija", email: "", phoneNumber: "+33612345678" },
    });

    expect(res).toMatchObject({ ok: true, booking: { uid: "u1" } });
    expect(calls[1].body).toMatchObject({
      eventTypeId: 3,
      attendee: { email: "rdv+33612345678@example.com" },
    });
  });
});
