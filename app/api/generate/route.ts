import { NextResponse } from "next/server";
import { Client } from "@gradio/client";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (prompt.length < 5) {
      return NextResponse.json({ error: "Please enter a more detailed prompt." }, { status: 400 });
    }

    const spaceId = process.env.HF_SPACE_ID;
    const apiName = process.env.HF_API_NAME;
    const inputsJson = process.env.HF_INPUTS_JSON || '["{{prompt}}"]';
    const token = process.env.HF_TOKEN?.trim();

    if (token && !token.startsWith("hf_")) {
      return NextResponse.json(
        { error: "HF_TOKEN must be a valid Hugging Face token beginning with hf_." },
        { status: 500 }
      );
    }

    if (!spaceId || !apiName) {
      return NextResponse.json(
        { error: "Video API is not configured. Set HF_SPACE_ID and HF_API_NAME in Render environment variables." },
        { status: 503 }
      );
    }

    const inputs = JSON.parse(inputsJson);
    if (!Array.isArray(inputs)) {
      return NextResponse.json({ error: "HF_INPUTS_JSON must be a JSON array." }, { status: 500 });
    }
    const resolvedInputs = inputs.map((value: unknown) => value === "{{prompt}}" ? prompt : value);
    // @gradio/client types HF tokens as the template-literal type `hf_${string}`.
    const clientOptions = token ? { hf_token: token as `hf_${string}` } : {};
    const client = await Client.connect(spaceId, clientOptions);
    const result = await client.predict(apiName, resolvedInputs);

    const findVideoUrl = (value: unknown): string | undefined => {
      if (!value) return undefined;
      if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findVideoUrl(item);
          if (found) return found;
        }
      }
      if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        for (const key of ["video", "url", "path", "src"]) {
          const found = findVideoUrl(obj[key]);
          if (found) return found;
        }
        for (const item of Object.values(obj)) {
          const found = findVideoUrl(item);
          if (found) return found;
        }
      }
      return undefined;
    };

    const videoUrl = findVideoUrl(result.data);
    if (!videoUrl) {
      return NextResponse.json({ error: "The Space responded, but no video URL was found. Check its API output format." }, { status: 502 });
    }
    return NextResponse.json({ videoUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
