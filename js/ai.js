/* Claude for the work log, with your own key: an Anthropic key (sk-ant-…) goes straight to Anthropic,
   an OpenRouter key (sk-or-…) goes through OpenRouter. The key stays on this computer. */
(function () {
  "use strict";
  const get = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const isOR = key => /^sk-or-/i.test(key || "");
  const DEF = { anthropic: "claude-sonnet-5-5", openrouter: "anthropic/claude-sonnet-5" };
  // a model name that suits the key: OpenRouter names have a "maker/" in front, Anthropic's don't
  function modelFor(key, m) { m = (m || "").trim(); if (isOR(key)) return m.includes("/") ? m : DEF.openrouter; return m && !m.includes("/") ? m : DEF.anthropic; }
  async function ask(prompt, max, key, model) {
    key = (key || get("lr-anthropic-key")).trim(); if (!key) throw new Error("No API key yet");
    model = modelFor(key, model || get("lr-anthropic-model"));
    if (isOR(key)) {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + key, "x-title": "The Lamp Room" },
        body: JSON.stringify({ model, max_tokens: max || 2000, messages: [{ role: "user", content: prompt }] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error((j.error && (j.error.message || j.error)) || ("HTTP " + r.status));
      const c = ((j.choices || [])[0] || {}).message || {};
      return typeof c.content === "string" ? c.content : (c.content || []).map(x => x.text || "").join("");
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model, max_tokens: max || 2000, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
    return (j.content || []).map(c => c.text || "").join("");
  }
  window.LRAI = { ask, isOR, modelFor, DEF, key: () => get("lr-anthropic-key"), model: () => get("lr-anthropic-model") };
})();
