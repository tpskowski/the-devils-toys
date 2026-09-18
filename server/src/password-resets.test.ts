import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { db, one } from "./db.js";
import { authMiddleware } from "./auth.js";
import { sessionRouter } from "./session-routes.js";
import { managementRouter } from "./management.js";
import { createPasswordReset, passwordResetRouter } from "./password-resets.js";
import { disconnectAccount } from "./realtime.js";

vi.mock("./realtime.js", () => ({ disconnectAccount: vi.fn(), broadcastRoom: vi.fn(), refreshRoomAccess: vi.fn() }));
let server: Server;
let base: string;
let originalHash: string;
beforeAll(async () => {
  originalHash = await bcrypt.hash("old-password", 4);
  const app = express();
  app.use(express.json(), cookieParser(), authMiddleware);
  app.use("/api", managementRouter, passwordResetRouter, sessionRouter);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});
beforeEach(() => {
  db.exec("DELETE FROM accounts");
  const insert = db.prepare(
    "INSERT INTO accounts (id, username, password_hash, account_role, is_admin, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insert.run(1, "Admin", originalHash, "admin", 1, null);
  insert.run(2, "GM", originalHash, "gm", 0, 1);
  insert.run(3, "Player", originalHash, "player", 0, 2);
  insert.run(4, "Stranger", originalHash, "player", 0, 1);
  for (const id of [1, 2, 3, 4])
    db.prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)").run(
      `session-${id}`,
      id,
      "2999-01-01T00:00:00Z"
    );
  vi.clearAllMocks();
});
function post(path: string, body: unknown = {}, account?: number) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(account ? { Cookie: `devils_session=session-${account}` } : {})
    },
    body: JSON.stringify(body)
  });
}
const open = (token: string, account?: number) => post("/password-reset/open", { token }, account);
const redeem = (token: string, password = "new-test-password") => post("/password-reset", { token, password });

describe("password reset links", () => {
  it("still allows existing passwords shorter than 14 characters to sign in", async () => {
    expect((await post("/login", { username: "Player", password: "old-password" })).status).toBe(200);
  });
  it("uses the existing manager permissions", async () => {
    expect((await post("/management/players/3/password-reset")).status).toBe(401);
    expect((await post("/management/players/4/password-reset", {}, 3)).status).toBe(403);
    expect((await post("/management/players/4/password-reset", {}, 2)).status).toBe(404);
    expect((await post("/management/players/1/password-reset", {}, 2)).status).toBe(404);
    expect((await post("/management/players/3/password-reset", {}, 2)).status).toBe(200);
    expect((await post("/management/players/2/password-reset", {}, 1)).status).toBe(200);
  });
  it("stores only a token digest, expires in 24 hours, and replaces earlier links", async () => {
    const before = Date.now();
    const first = createPasswordReset(3);
    expect(Date.parse(first.expiresAt) - before).toBeGreaterThanOrEqual(86_400_000);
    expect(Date.parse(first.expiresAt) - before).toBeLessThan(86_401_000);
    const row = one<{ token_hash: string }>("SELECT token_hash FROM password_resets WHERE account_id = 3")!;
    expect(row.token_hash).not.toBe(first.token);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    const second = createPasswordReset(3);
    expect((await open(first.token)).status).toBe(400);
    expect((await open(second.token)).status).toBe(200);
    expect(one("SELECT id FROM sessions WHERE account_id = 3")).toBeDefined();
  });
  it("signs out the visiting account without consuming the link or changing the target", async () => {
    const { token } = createPasswordReset(3);
    const response = await open(token, 1);
    expect(await response.json()).toEqual({ username: "Player" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("devils_session=;");
    expect(one("SELECT id FROM sessions WHERE account_id = 1")).toBeUndefined();
    expect(one("SELECT id FROM sessions WHERE account_id = 3")).toBeDefined();
    expect((await open(token)).status).toBe(200);
  });
  it("rejects expired and malformed links while still signing the browser out", async () => {
    const { token } = createPasswordReset(3);
    db.prepare("UPDATE password_resets SET expires_at = ?").run("2000-01-01T00:00:00Z");
    expect((await open(token, 1)).status).toBe(400);
    expect(one("SELECT id FROM sessions WHERE account_id = 1")).toBeUndefined();
    expect((await redeem(token)).status).toBe(400);
    expect((await open("bad", 2)).status).toBe(400);
    expect(one("SELECT id FROM sessions WHERE account_id = 2")).toBeUndefined();
  });
  it("enforces password length and leaves the link usable after a rejected password", async () => {
    const { token } = createPasswordReset(3);
    expect((await redeem(token, "x".repeat(13))).status).toBe(400);
    expect((await redeem(token, "x".repeat(129))).status).toBe(400);
    expect((await redeem(token, "alllowercaseok")).status).toBe(204);
  });
  it("redeems once, revokes target sessions, and requires a normal login with the new password", async () => {
    const { token } = createPasswordReset(3);
    const response = await redeem(token);
    expect(response.status).toBe(204);
    expect(one("SELECT id FROM sessions WHERE account_id = 3")).toBeUndefined();
    expect(disconnectAccount).toHaveBeenCalledWith(3);
    expect((await redeem(token)).status).toBe(400);
    expect((await post("/login", { username: "Player", password: "old-password" })).status).toBe(401);
    expect((await post("/login", { username: "Player", password: "new-test-password" })).status).toBe(200);
  });
  it("invalidates a link after a password change through another route", async () => {
    const { token } = createPasswordReset(3);
    db.prepare("UPDATE accounts SET password_hash = ? WHERE id = 3").run(await bcrypt.hash("changed-password", 4));
    expect((await redeem(token)).status).toBe(400);
  });
  it("allows only one winner when two redemptions overlap", async () => {
    const { token } = createPasswordReset(3);
    const responses = await Promise.all([redeem(token, "test-password-one"), redeem(token, "test-password-two")]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 400]);
  });
});
