// Vercel serverless entry point.
//
// Vercel's zero-config Node.js builder (@vercel/node) auto-detects any file
// under `api/` and deploys it as a serverless function, bundling only the
// files actually imported by it (via esbuild), not the whole workspace.
// Our Express app is directly callable as `(req, res) => void`, so we can
// export it as-is — no extra adapter needed.
import app from "../src/app";

export default app;
