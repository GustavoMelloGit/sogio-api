import { describe, expect, it, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { api } from "../helpers/server";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["properties", "addresses", "users"];

type PropertyBody = {
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zip_code: string;
    country: string;
    complement: string;
  };
};

async function patchProperty(
  token: string,
  propertyId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return api(`/property/${propertyId}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
}

describe("PATCH /property/:property_id with a partial address", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("changes only the address fields that were sent", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-http.partial-address@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await patchProperty(token, property.id, {
      address: { city: "Vitória", state: "ES" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PropertyBody;
    expect(body.address).toEqual({
      street: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Vitória",
      state: "ES",
      zip_code: "01310-100",
      country: "Brasil",
      complement: "",
    });
  });

  it("keeps the current complement when the address patch omits it", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-http.complement@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const withComplement = await patchProperty(token, property.id, {
      address: { complement: "Apto 302" },
    });
    expect(withComplement.status).toBe(200);

    const res = await patchProperty(token, property.id, {
      address: { city: "Vitória" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PropertyBody;
    expect(body.address.complement).toBe("Apto 302");
    expect(body.address.city).toBe("Vitória");
  });

  it("still accepts a full address replacement", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-http.full-address@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const address = {
      street: "Avenida Beira Mar",
      number: "1200",
      neighborhood: "Praia do Canto",
      city: "Vitória",
      state: "ES",
      zip_code: "29055-000",
      country: "Brasil",
      complement: "Apto 302",
    };

    const res = await patchProperty(token, property.id, { address });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PropertyBody;
    expect(body.address).toEqual(address);
  });

  it("rejects an invalid value inside an otherwise partial address", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-http.invalid-address@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await patchProperty(token, property.id, {
      address: { city: "" },
    });

    expect(res.status).toBe(422);
  });
});
