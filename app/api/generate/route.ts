import { NextResponse } from "next/server";
import { Client } from "@gradio/client";

export const runtime = "nodejs";
export const maxDuration = 300;
type HFProvider = { id: string; name: string; spaceId: string; apiName: string; inputsJson: string; tokenEnv?: string };
function getHFProviders(): HFProvider[] {
  const raw = process.env.HF_PROVIDERS_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("HF_PROVIDERS_JSON must be a JSON array.");
    return parsed.filter((p: any) => p && p.id && p.name && p.spaceId && p.apiName).map((p: any) => ({
      id: String(p.id), name: String(p.name), spaceId: String(p.spaceId), apiName: String(p.apiName),
      inputsJson: typeof p.inputsJson === "string" ? p.inputsJson : '[ "{{prompt}}", null, null, "544x960 · 9:16 fast", 5, 42, false ]',
      tokenEnv: typeof p.tokenEnv === "string" ? p.tokenEnv : "HF_TOKEN",
    }));
  }
  if (process.env.HF_SPACE_ID && process.env.HF_API_NAME) return [{
    id: "huggingface-primary", name: "Hugging Face (primary)", spaceId: process.env.HF_SPACE_ID,
    apiName: process.env.HF_API_NAME, inputsJson: process.env.HF_INPUTS_JSON || '[ "{{prompt}}", null, null, "544x960 · 9:16 fast", 5, 42, false ]', tokenEnv: "HF_TOKEN",
  }];
  return [];
}
function findVideoUrl(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  if (Array.isArray(value)) { for (const item of value) { const found = findVideoUrl(item); if (found) return found; } }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["video_url", "video", "url", "path", "src", "output"]) { const found = findVideoUrl(obj[key]); if (found) return found; }
    for (const item of Object.values(obj)) { const found = findVideoUrl(item); if (found) return found; }
  }
  return undefined;
}
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Unknown provider error"; }
}
function friendlyError(message: string): string {
  if (/quota|zerogpu|exceeded.*free|rate.?limit|too many requests|429|402/i.test(message))
    return "This provider's free quota or token allowance is exhausted. Auto mode will try another configured free provider. No paid fallback is enabled; please wait for the daily allowance to reset.";
  return message;
}
async function generateFreeAI(prompt: string, duration: number) {
  const key = process.env.FREEAI_API_KEY?.trim();
  if (!key) throw new Error("Free.ai backup is not connected. Add FREEAI_API_KEY in Render environment variables.");
  if (duration > 6) throw new Error("Free.ai's free CogVideoX backup supports up to 6 seconds. Choose 3 or 5 seconds, or use Hugging Face for longer clips.");
  const response = await fetch("https://api.free.ai/v1/video/generate/", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "cogvideox-2b", prompt, duration, aspect_ratio: "9:16" }),
    signal: AbortSignal.timeout(60000),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || `Free.ai API returned HTTP ${response.status}. Check free token balance and API key.`);
  let videoUrl = findVideoUrl(data);
  const jobId = data.job_id || data.id || data.task_id;
  if (!videoUrl && jobId) {
    for (let attempt = 0; attempt < 45; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      const statusResponse = await fetch(`https://api.free.ai/v1/status/${encodeURIComponent(String(jobId))}/`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000),
      });
      const statusData: any = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(statusData.error?.message || statusData.message || "Free.ai job status check failed.");
      videoUrl = findVideoUrl(statusData);
      if (videoUrl) break;
      const status = String(statusData.status || statusData.state || "").toLowerCase();
      if (["failed", "error", "cancelled"].includes(status)) throw new Error(statusData.error?.message || statusData.message || "Free.ai video generation failed.");
    }
  }
  if (!videoUrl) throw new Error("Free.ai accepted the job but did not return a downloadable video URL in time.");
  return videoUrl;
}
export async function GET() {
  try {
    const providers = getHFProviders().map(({ id, name }) => ({ id, name }));
    if (process.env.FREEAI_API_KEY?.trim()) providers.push({ id: "freeai-cogvideox", name: "Free.ai CogVideoX (free daily allowance)" });
    return NextResponse.json({ providers });
  } catch { return NextResponse.json({ providers: [], error: "Provider configuration is invalid." }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const duration = Number(body.duration ?? 5);
    const selected = typeof body.provider === "string" ? body.provider : "auto";
    if (prompt.length < 5) return NextResponse.json({ error: "Please enter a more detailed prompt." }, { status: 400 });
    if (![3, 5, 10, 14].includes(duration)) return NextResponse.json({ error: "Choose 3, 5, 10, or 14 seconds." }, { status: 400 });
    const hfProviders = getHFProviders();
    const freeAIAvailable = Boolean(process.env.FREEAI_API_KEY?.trim());
    const candidates: Array<{ id: string; name: string; kind: "hf" | "freeai"; config?: HFProvider }> = [];
    if (selected === "auto" || hfProviders.some(p => p.id === selected)) {
      for (const p of hfProviders) if (selected === "auto" || selected === p.id) candidates.push({ id: p.id, name: p.name, kind: "hf", config: p });
    }
    if (freeAIAvailable && (selected === "auto" || selected === "freeai-cogvideox")) candidates.push({ id: "freeai-cogvideox", name: "Free.ai CogVideoX", kind: "freeai" });
    if (!candidates.length) return NextResponse.json({ error: selected === "freeai-cogvideox" ? "Free.ai API key is not configured. Add FREEAI_API_KEY in Render." : "No compatible provider is configured for this selection." }, { status: 503 });
    const failures: string[] = [];
    for (const provider of candidates) {
      if (provider.kind === "freeai" && duration > 6) { failures.push("Free.ai: free backup supports up to 6 seconds; choose 3 or 5 seconds."); continue; }
      try {
        let videoUrl: string;
        if (provider.kind === "freeai") videoUrl = await generateFreeAI(prompt, duration);
        else {
          const p = provider.config!;
          const token = p.tokenEnv ? process.env[p.tokenEnv]?.trim() : undefined;
          if (token && !token.startsWith("hf_")) throw new Error(`${p.tokenEnv} must be a valid Hugging Face token beginning with hf_.`);
          const inputs = JSON.parse(p.inputsJson);
          if (!Array.isArray(inputs)) throw new Error(`${p.name}: inputsJson must be a JSON array.`);
          const resolved = inputs.map((v: unknown) => v === "{{prompt}}" ? prompt : v);
          if (resolved.length < 5) throw new Error(`${p.name}: model duration input must be at index 4.`);
          resolved[4] = duration;
          const client = await Client.connect(p.spaceId, token ? { hf_token: token as `hf_${string}` } : {});
          const result = await client.predict(p.apiName, resolved);
          videoUrl = findVideoUrl(result.data) || "";
          if (!videoUrl) throw new Error("Provider responded, but no video URL was returned.");
        }
        return NextResponse.json({ videoUrl, providerId: provider.id, providerName: provider.name });
      } catch (error) {
        const message = friendlyError(errorText(error));
        console.error(`Provider ${provider.id} failed:`, message);
        failures.push(`${provider.name}: ${message}`);
        if (selected !== "auto") break;
      }
    }
    return NextResponse.json({ error: failures.length ? "All compatible free providers failed. " + failures.join(" | ") : "No free provider supports this duration. Choose 3 or 5 seconds for Free.ai, or configure another provider." }, { status: 503 });
  } catch (error) {
    console.error("Video generation request failed:", error);
    return NextResponse.json({ error: friendlyError(errorText(error)) || "Video generation failed. Please try again." }, { status: 500 });
  }
}
