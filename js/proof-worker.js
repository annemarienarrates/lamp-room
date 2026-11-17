/* The Lamp Room — proofer worker. Runs an open speech-recognition model (Whisper, through transformers.js) in Chrome,
   off the main thread so recording never stutters. Audio never leaves the computer; the model downloads once and Chrome keeps it. */
const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODELS = {
  fast: ["onnx-community/whisper-tiny.en", "Xenova/whisper-tiny.en"],
  careful: ["onnx-community/whisper-base.en", "Xenova/whisper-base.en"]
};
let T = null; const pipes = {};

async function lib() {
  if (!T) { T = await import(LIB); T.env.allowLocalModels = false; }
  return T;
}
async function getPipe(kind) {
  if (pipes[kind]) return pipes[kind];
  const t = await lib(), gpu = !!(self.navigator && navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null));
  const opts = {
    device: gpu ? "webgpu" : "wasm",
    dtype: gpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: p => { if (p && p.status === "progress" && p.total) self.postMessage({ type: "progress", kind, file: p.file, loaded: p.loaded, total: p.total }); }
  };
  let last = null;
  for (const id of MODELS[kind] || MODELS.fast) {
    try { pipes[kind] = await t.pipeline("automatic-speech-recognition", id, opts); self.postMessage({ type: "ready", kind, model: id, device: opts.device }); return pipes[kind]; }
    catch (e) { last = e; }
  }
  throw last || new Error("No model");
}

self.onmessage = async e => {
  const { id, cmd, kind, audio } = e.data || {};
  try {
    if (cmd === "load") { await getPipe(kind || "fast"); self.postMessage({ id, ok: true }); return; }
    if (cmd === "asr") {
      const p = await getPipe(kind || "fast");
      const out = await p(audio, { chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ id, ok: true, text: (out && out.text) || "" });
    }
  } catch (err) { self.postMessage({ id, ok: false, err: String((err && err.message) || err) }); }
};
