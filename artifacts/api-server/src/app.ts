import express, { type Express } from "express";
import cors from "cors";
import { createRequire } from "node:module";
import router from "./routes";
import { logger } from "./lib/logger";

// pino-http uses `export =` syntax which breaks ESM default imports when
// esModuleInterop is absent (e.g. Vercel's tsc check).  createRequire is the
// correct ESM-native way to consume a CommonJS `export =` module.
const _require = createRequire(import.meta.url);
// Cast to `any` so pino-http's `export =` type never conflicts with any tsconfig variant
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pinoHttp = _require("pino-http") as any;

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: { id: unknown; method: string; url?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: { statusCode: number }) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
