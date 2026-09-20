import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, one } from "./db.js";
import { createSession } from "./auth.js";
import { asyncRoute, parse } from "./session-routes.js";

export const setupRouter = express.Router();

setupRouter.post(
  "/setup",
  asyncRoute(async (req, res) => {
    const existing = one<{ count: number }>("SELECT COUNT(*) AS count FROM accounts")?.count ?? 0;
    if (existing) return res.status(409).json({ error: "Server setup is already complete." });
    const body = parse(
      z.object({
        username: z.string().trim().min(2).max(32),
        password: z.string().min(14, "Passwords must contain at least 14 characters.").max(128)
      }),
      req.body,
      res
    );
    if (!body) return;
    const hash = await bcrypt.hash(body.password, 12);
    let accountId: number;
    db.exec("BEGIN IMMEDIATE");
    try {
      // Hashing yields: another setup request may have completed meanwhile.
      if (one<{ count: number }>("SELECT COUNT(*) AS count FROM accounts")!.count) {
        db.exec("ROLLBACK");
        return res.status(409).json({ error: "Server setup is already complete." });
      }
      const result = db
        .prepare("INSERT INTO accounts (username, password_hash, is_admin, account_role) VALUES (?, ?, 1, 'admin')")
        .run(body.username, hash);
      accountId = Number(result.lastInsertRowid);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    createSession(res, accountId);
    res.status(201).json({ account: { id: accountId, username: body.username, isAdmin: true, role: "admin" } });
  })
);
