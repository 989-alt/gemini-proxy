// CF Worker: Gemini API proxy for 989-alt 1-day-1-vibecoding
// Deployed at https://gemini-proxy.1d1v.workers.dev
//
// Hides the Gemini API key (stored as `GEMINI_KEY` Workers Secret).
// Enforces: origin allowlist, model allowlist, per-IP/global rate limits,
// payload size cap.

const ALLOWED_ORIGINS = new Set([
  "https://989-alt.github.io",
  "http://localhost:5173",
  "http://localhost:5180",
  "http://127.0.0.1:5180",
]);

const DAILY_GLOBAL_CAP = 3000;   // total calls per day across all users
const PER_IP_PER_MIN   = 12;     // per-IP per-minute cap
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",       // default — fast + cheap, good Korean
  "gemini-2.5-flash-lite",  // cheaper/faster for simple classification
  "gemini-2.5-pro",         // high quality for math word problems / RAG
]);
const ALLOWED_VERBS = new Set([
  "generateContent",
  "streamGenerateContent",
  "countTokens",
]);

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";

    if (req.method === "OPTIONS") return cors(origin);

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "forbidden_origin" }, 403, origin);
    }

    const url = new URL(req.url);
    const m = url.pathname.match(/^\/v1beta\/models\/([\w.-]+):(\w+)$/);
    if (!m) return json({ error: "bad_path" }, 400, origin);
    const [, model, verb] = m;
    if (!ALLOWED_MODELS.has(model)) return json({ error: "model_not_allowed" }, 400, origin);
    if (!ALLOWED_VERBS.has(verb)) return json({ error: "verb_not_allowed" }, 400, origin);

    if (env.RATE) {
      const ip = req.headers.get("CF-Connecting-IP") || "anon";
      const now = new Date();
      const minKey = `m:${ip}:${now.toISOString().slice(0, 16)}`;
      const dayKey = `d:${now.toISOString().slice(0, 10)}`;

      const [minRaw, dayRaw] = await Promise.all([
        env.RATE.get(minKey),
        env.RATE.get(dayKey),
      ]);
      const minCount = parseInt(minRaw || "0", 10);
      const dayCount = parseInt(dayRaw || "0", 10);

      if (minCount >= PER_IP_PER_MIN) return json({ error: "rate_limited_minute" }, 429, origin);
      if (dayCount >= DAILY_GLOBAL_CAP) return json({ error: "daily_cap_reached" }, 429, origin);

      ctx.waitUntil(Promise.all([
        env.RATE.put(minKey, String(minCount + 1), { expirationTtl: 120 }),
        env.RATE.put(dayKey, String(dayCount + 1), { expirationTtl: 60 * 60 * 36 }),
      ]));
    }

    const bodyText = req.method === "GET" ? "" : await req.text();
    if (bodyText.length > 32 * 1024) return json({ error: "payload_too_large" }, 413, origin);

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:${verb}?key=${env.GEMINI_KEY}`,
      {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: bodyText || undefined,
      }
    );

    const out = new Response(upstream.body, { status: upstream.status });
    out.headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    out.headers.set("Access-Control-Allow-Origin", origin);
    out.headers.set("Vary", "Origin");
    return out;
  },
};

function cors(origin) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
    },
  });
}
