import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();
const MAILTM = "https://api.mail.tm";

// POST /api/tempmail/generate
// Server-side account creation avoids browser CORS rate-limits.
// Returns { email, token } to the frontend, which then polls mail.tm directly.
router.post("/tempmail/generate", async (req, res) => {
  try {
    // 1. Get available domains
    const domainsRes = await fetch(`${MAILTM}/domains`);
    if (!domainsRes.ok) throw new Error(`domains → ${domainsRes.status}`);
    const domainsData = await domainsRes.json() as { "hydra:member": { domain: string }[] };
    const domains = domainsData["hydra:member"];
    if (!domains || domains.length === 0) throw new Error("No domains available");
    const domain = domains[Math.floor(Math.random() * domains.length)].domain;

    // 2. Create a random account
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const rand = (n: number) =>
      Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const login    = rand(10);
    const password = rand(16);
    const address  = `${login}@${domain}`;

    const acctRes = await fetch(`${MAILTM}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    });
    if (!acctRes.ok) {
      const body = await acctRes.text().catch(() => "");
      logger.warn({ status: acctRes.status, body }, "mail.tm account creation failed");
      throw new Error(`Account create → ${acctRes.status}`);
    }

    // 3. Authenticate
    const tokenRes = await fetch(`${MAILTM}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    });
    if (!tokenRes.ok) throw new Error(`Token → ${tokenRes.status}`);
    const { token } = await tokenRes.json() as { token: string };

    res.json({ email: address, token });
  } catch (err) {
    logger.error({ err }, "Failed to generate temp mailbox");
    res.status(502).json({ error: String((err as Error).message) });
  }
});

export default router;
