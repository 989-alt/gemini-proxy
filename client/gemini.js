// gemini.js — shared client helper for 989-alt 1-day-1-vibecoding
//
// All projects in this routine call Gemini through the shared proxy.
// The API key lives on Cloudflare Workers and never reaches the browser.
//
// Usage:
//   import { gemini, GeminiError } from "./gemini.js";
//   const text = await gemini("초3 받아쓰기 단어 10개 JSON", { json: true });
//
// For single-HTML topics, inline this code in a <script type="module">.

const GEMINI_PROXY = "https://gemini-proxy.1d1v.workers.dev";
const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Call Gemini via the shared proxy.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {"gemini-2.5-flash"|"gemini-2.5-flash-lite"|"gemini-2.5-pro"} [opts.model]
 * @param {boolean} [opts.json]                  Parse response as JSON.
 * @param {string}  [opts.systemInstruction]
 * @param {number}  [opts.thinkingBudget]        0 = no thinking (cheaper/faster).
 *                                               Defaults to 0. Use 1024+ for math/reasoning.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string|object>}
 */
export async function gemini(prompt, opts = {}) {
  const {
    model = DEFAULT_MODEL,
    json = false,
    signal,
    systemInstruction,
    thinkingBudget = 0,
  } = opts;

  const body = {
    contents: [{ role: "user", parts: [{ text: String(prompt) }] }],
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    generationConfig: {
      ...(json ? { responseMimeType: "application/json" } : {}),
      thinkingConfig: { thinkingBudget },
    },
  };

  let res;
  try {
    res = await fetch(`${GEMINI_PROXY}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new GeminiError("network", "네트워크 오류 — 인터넷 연결을 확인해 주세요.", e);
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }

  if (!res.ok) {
    if (res.status === 429) {
      const msg = data?.error === "daily_cap_reached"
        ? "오늘 분량을 모두 사용했어요. 내일 다시 시도해 주세요."
        : "잠깐 너무 빨라요. 30초 뒤 다시 시도해 주세요.";
      throw new GeminiError("rate_limited", msg, data);
    }
    if (res.status === 403) throw new GeminiError("forbidden", "이 도메인에서는 사용할 수 없어요.", data);
    if (res.status === 400) throw new GeminiError("bad_request", data?.error?.message || "요청이 올바르지 않아요.", data);
    if (res.status === 404) throw new GeminiError("model_unavailable", "모델이 사용 불가 상태예요. 잠시 후 다시 시도해 주세요.", data);
    throw new GeminiError("upstream", `Gemini 오류 (${res.status})`, data);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(p => p.text).filter(Boolean).join("") ?? "";
  if (!text) throw new GeminiError("empty", "Gemini가 빈 응답을 보냈어요. 다시 시도해 주세요.", data);

  if (json) {
    try { return JSON.parse(text); }
    catch (e) { throw new GeminiError("bad_json", "응답을 JSON으로 해석하지 못했어요.", { text, e }); }
  }
  return text;
}

export class GeminiError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.detail = detail;
  }
}
