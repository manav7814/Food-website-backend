process.env.JWT_SECRET = "test_secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");

describe("API validation", () => {
  const adminToken = jwt.sign({ id: "507f1f77bcf86cd799439011", role: "admin" }, process.env.JWT_SECRET);

  test("auth register rejects bad payload", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "a",
      email: "not-an-email",
      password: "123"
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Validation failed");
  });

  test("menu route validates invalid restaurant query", async () => {
    const response = await request(app).get("/api/menu?restaurantId=bad-id");
    expect(response.status).toBe(400);
  });

  test("orders status route validates order id and status", async () => {
    const response = await request(app)
      .patch("/api/orders/bad-id/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "unknown" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Validation failed");
  });
});
