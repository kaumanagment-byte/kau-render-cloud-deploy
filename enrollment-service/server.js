import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { enrollmentDashboard, queueStatus } from "./data.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 8080);

http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (url.pathname === "/health") return json(res, 200, { ok: true, service: "kau-enrollment-service" });
    if (url.pathname === "/api/enrollment-dashboard") return json(res, 200, await enrollmentDashboard());
    if (url.pathname === "/api/queue/status") return json(res, 200, await queueStatus());
    if (url.pathname === "/" || url.pathname === "/enrollment.html") return html(res, await readFile(resolve(root, "public/index.html")));
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
}).listen(port, () => console.log(`KAU enrollment service on ${port}`));

function json(res, status, body) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); }
function html(res, body) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(body); }
