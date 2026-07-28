#!/usr/bin/env node
// Serves the portfolio dashboard and persists it to portfolio.json.
// A server (rather than opening the file directly) is what lets the page
// read and write a real file — file:// pages cannot.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const DATA = new URL("portfolio.json", ROOT);
const PAGE = new URL("dashboard.html", ROOT);
const REPORTS_PAGE = new URL("reports/index.html", ROOT);
const PORT = Number(process.env.PORT ?? 4321);
// `holdings` are individual buy lots; `prices` is the current price per ticker.
const EMPTY = { holdings: [], snapshots: [], prices: {} };

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/dashboard.html")) {
      return send(res, 200, await readFile(PAGE), "text/html; charset=utf-8");
    }

    // Serving the reports page here is what lets the two pages link to each
    // other; over file:// they can't, since they live in different directories.
    if (req.method === "GET" && (req.url === "/reports" || req.url === "/reports/")) {
      const page = await readFile(REPORTS_PAGE).catch(() => null);
      return page
        ? send(res, 200, page, "text/html; charset=utf-8")
        : send(
            res,
            404,
            `<!doctype html><meta charset="utf-8"><title>No reports yet</title>
             <body style="font:16px/1.6 ui-sans-serif,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem">
             <h1 style="font-size:1.1rem">No reports page yet</h1>
             <p>Build one with <code>npm run pick -- --save</code> then <code>npm run dashboard</code>,
             or just run <code>npm start</code>.</p>
             <p><a href="/">← Portfolio</a></p>`,
            "text/html; charset=utf-8",
          );
    }

    if (req.url === "/api/portfolio") {
      if (req.method === "GET") {
        const json = await readFile(DATA, "utf8").catch(() => JSON.stringify(EMPTY));
        return send(res, 200, json);
      }
      if (req.method === "PUT") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const parsed = JSON.parse(Buffer.concat(chunks).toString());
        if (!Array.isArray(parsed.holdings) || !Array.isArray(parsed.snapshots)) {
          return send(res, 400, JSON.stringify({ error: "expected { holdings: [], snapshots: [] }" }));
        }
        parsed.prices ??= {};
        await writeFile(DATA, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        return send(res, 200, JSON.stringify({ ok: true }));
      }
    }

    send(res, 404, JSON.stringify({ error: "not found" }));
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }));
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    process.stderr.write(
      `\n  Port ${PORT} is already in use — the dashboard is probably already running.\n` +
        `    Open it:          http://localhost:${PORT}\n` +
        `    Or use another:   PORT=${PORT + 1} npm run portfolio\n` +
        `    Or stop the old:  pkill -f bin/portfolio.js\n\n`,
    );
    process.exit(1);
  }
  throw error;
});

// Loopback only — this is personal financial data, not something to expose.
server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(
    `\n  portfolio dashboard → http://localhost:${PORT}\n  data file: portfolio.json  (ctrl-c to stop)\n\n`,
  );
});
