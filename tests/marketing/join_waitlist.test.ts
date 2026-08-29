import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { truncate } from "../helpers/database";
import { api } from "../helpers/server";
import { db } from "../../src/core/infra/database/drizzle/database";
import { waitlistLeadsTable } from "../../src/core/infra/database/drizzle/schema";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LANDING_ORIGIN = "https://www.sogio.app";

const validBody = {
  name: "Maria Silva",
  whatsapp: "11987654321",
  property_count: "2-3",
  source: "landing",
};

function joinWaitlist(body: unknown, headers?: Record<string, string>) {
  return api("/waitlist", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

type SuccessBody = { id: string; position?: number };
type ErrorBody = { message: string };

async function leadOfWhatsapp(whatsapp: string) {
  const rows = await db
    .select()
    .from(waitlistLeadsTable)
    .where(eq(waitlistLeadsTable.whatsapp, whatsapp));

  return rows[0];
}

describe("POST /waitlist", () => {
  beforeEach(async () => {
    await truncate(["waitlist_leads"]);
  });

  it("201 — registers a lead with no authentication header", async () => {
    const response = await joinWaitlist(validBody);
    const body = (await response.json()) as SuccessBody;

    expect(response.status).toBe(201);
    expect(typeof body.id).toBe("string");
    expect(body.id).toMatch(UUID_PATTERN);
    expect(body.position).toBeUndefined();

    const lead = await leadOfWhatsapp("11987654321");
    expect(lead?.name).toBe("Maria Silva");
    expect(lead?.property_count).toBe("2-3");
    expect(lead?.source).toBe("landing");
    expect(lead?.consented_at).toBeInstanceOf(Date);
  });

  it("201 — ignores an Authorization header instead of rejecting it", async () => {
    const response = await joinWaitlist(validBody, {
      Authorization: "Bearer not-a-real-token",
    });

    expect(response.status).toBe(201);
  });

  it("201 — the same WhatsApp twice updates the lead instead of duplicating it", async () => {
    const first = await joinWaitlist(validBody);
    const firstBody = (await first.json()) as SuccessBody;
    const firstLead = await leadOfWhatsapp("11987654321");

    await Bun.sleep(5);

    const second = await joinWaitlist({
      ...validBody,
      name: "Maria Silva Souza",
      property_count: "4-10",
    });
    const secondBody = (await second.json()) as SuccessBody;

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(secondBody.id).toBe(firstBody.id);

    const rows = await db.select().from(waitlistLeadsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Maria Silva Souza");
    expect(rows[0]?.property_count).toBe("4-10");
    expect(rows[0]?.consented_at.getTime()).toBe(
      firstLead?.consented_at.getTime()
    );
  });

  it("201 — accepts a masked WhatsApp and stores only digits", async () => {
    const response = await joinWaitlist({
      ...validBody,
      whatsapp: "(11) 98765-4321",
    });

    expect(response.status).toBe(201);

    const lead = await leadOfWhatsapp("11987654321");
    expect(lead).toBeDefined();
  });

  it("201 — defaults source to landing when it is absent", async () => {
    const { source, ...bodyWithoutSource } = validBody;
    void source;

    const response = await joinWaitlist(bodyWithoutSource);

    expect(response.status).toBe(201);

    const lead = await leadOfWhatsapp("11987654321");
    expect(lead?.source).toBe("landing");
  });

  it("422 — rejects a WhatsApp with 9 or 12 digits", async () => {
    const tooShort = await joinWaitlist({
      ...validBody,
      whatsapp: "119876543",
    });
    const tooLong = await joinWaitlist({
      ...validBody,
      whatsapp: "119876543210",
    });

    expect(tooShort.status).toBe(422);
    expect(tooLong.status).toBe(422);
    expect(typeof ((await tooShort.json()) as ErrorBody).message).toBe(
      "string"
    );
    expect(typeof ((await tooLong.json()) as ErrorBody).message).toBe("string");
  });

  it("422 — rejects a property_count outside the enum", async () => {
    const response = await joinWaitlist({ ...validBody, property_count: "5" });

    expect(response.status).toBe(422);
    expect(typeof ((await response.json()) as ErrorBody).message).toBe(
      "string"
    );
  });

  it("422 — rejects an empty body", async () => {
    const response = await joinWaitlist({});

    expect(response.status).toBe(422);
    expect(typeof ((await response.json()) as ErrorBody).message).toBe(
      "string"
    );
  });

  it("never answers 401 or 403, whatever the input", async () => {
    const responses = await Promise.all([
      joinWaitlist({}),
      joinWaitlist({ ...validBody, whatsapp: "abc" }),
      joinWaitlist(validBody, { Authorization: "Bearer garbage" }),
    ]);

    for (const response of responses) {
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }
  });

  it("answers the preflight for the landing origin with a public CORS header", async () => {
    const response = await api("/waitlist", {
      method: "OPTIONS",
      headers: { Origin: LANDING_ORIGIN },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("sends the public CORS header on the success response too", async () => {
    const response = await joinWaitlist(validBody, { Origin: LANDING_ORIGIN });

    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("429 — rate limits the sixth request from the same IP", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const allowed = await joinWaitlist({
        ...validBody,
        whatsapp: `1198765432${attempt}`,
      });
      expect(allowed.status).toBe(201);
    }

    const blocked = await joinWaitlist({
      ...validBody,
      whatsapp: "11987654399",
    });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
  });
});
