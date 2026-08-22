import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["properties", "addresses", "users"];

function bodyWithoutImages(name: string) {
  return {
    name,
    address: {
      street: "Rua X",
      number: "1",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zip_code: "01310-100",
      country: "Brasil",
      complement: "",
    },
    images: [],
    capacity: 2,
  };
}

describe("property creation without images (§4.1)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("accepts an empty images array", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "no-images@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(bodyWithoutImages("Casa Sem Fotos")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { images: string[] };
    expect(body.images).toEqual([]);
  });
});
