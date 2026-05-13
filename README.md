# gemini-proxy

Cloudflare Workers proxy that lets the **1-day-1-vibecoding** 100-project series share a single Gemini API key without leaking it to the browser.

- **Live URL**: `https://gemini-proxy.1d1v.workers.dev`
- **Key location**: CF Workers Secret `GEMINI_KEY` only — never in code, never in client bundles, never in git.

## Architecture

```
[학생 브라우저] ──POST──▶ [CF Worker] ──Authorization──▶ [Gemini API]
                            ① Origin allowlist
                            ② Model allowlist
                            ③ Per-IP rate limit (KV)
                            ④ Daily global cap (KV)
                            ⑤ Payload size cap
```

Failure modes are bounded by:
- Worker origin allowlist (403 for unknown sites)
- Worker rate limits (429 before key sees abuse)
- Google Cloud monthly budget cap with auto-disable

## For app developers — use the shared client

Copy `client/gemini.js` into your project (or `<script type="module">` inline for single-HTML topics):

```js
import { gemini, GeminiError } from "./gemini.js";

// simple completion
const answer = await gemini("받아쓰기 단어 5개 줘");

// structured output
const list = await gemini(
  `초3 받아쓰기 단어 10개를 JSON 배열로: ["...", ...]`,
  { json: true }
);

// math word problem — needs reasoning
const solution = await gemini(prompt, {
  model: "gemini-2.5-pro",
  thinkingBudget: 1024,
});

// error handling
try {
  await gemini(prompt);
} catch (e) {
  if (e instanceof GeminiError) showToast(e.message);
  else throw e;
}
```

**Defaults:** model `gemini-2.5-flash`, `thinkingBudget: 0` (no thinking — cheaper/faster). Override only when the task genuinely needs reasoning (math, multi-step science).

## Allowed models

| Model | Price (1M tokens, in/out) | Use |
|---|---|---|
| `gemini-2.5-flash` (default) | $0.30 / $2.50 | Most topics — quizzes, words, messages |
| `gemini-2.5-flash-lite` | $0.10 / $0.40 | Short classifications, simple lists |
| `gemini-2.5-pro` | $1.25 / $10.00 | Math word problems, RAG, long worksheets |

## Allowed origins

- `https://989-alt.github.io`
- `http://localhost:5173`
- `http://localhost:5180`
- `http://127.0.0.1:5180`

Adding more requires editing `src/worker.js` and redeploying.

## Operator — fresh deployment

```bash
# one-time
npm install -g wrangler@latest
wrangler login

# inside this repo
wrangler kv namespace create RATE
# copy the id into wrangler.toml under [[kv_namespaces]]

wrangler secret put GEMINI_KEY
# paste the Gemini API key when prompted

wrangler deploy
```

The Gemini key must belong to a GCP project where:
1. **Billing is enabled** (paid tier — free tier limit on most regions is 0 as of late 2025).
2. **Monthly budget cap is set** to $5 with auto-disable at 100%.

## Verify

```bash
# 200 with Gemini JSON
curl -i -X POST \
  -H "Origin: https://989-alt.github.io" -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"하늘은 무슨 색?"}]}]}' \
  https://gemini-proxy.1d1v.workers.dev/v1beta/models/gemini-2.5-flash:generateContent

# 403 forbidden_origin
curl -i -X POST -H "Origin: https://evil.example" \
  https://gemini-proxy.1d1v.workers.dev/v1beta/models/gemini-2.5-flash:generateContent

# 400 model_not_allowed
curl -i -X POST \
  -H "Origin: https://989-alt.github.io" -H "Content-Type: application/json" \
  -d '{}' \
  https://gemini-proxy.1d1v.workers.dev/v1beta/models/gemini-pro:generateContent
```

## Rotate the key

```bash
wrangler secret put GEMINI_KEY
# paste new key; takes effect immediately, no redeploy needed
```

Then delete the old key in AI Studio so leakage cannot be abused.

## License

MIT.
