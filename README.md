# Farmhouse AI Video Generator

A deployable Next.js frontend + server API route. The browser sends the prompt to `/api/generate`; the server calls a public Hugging Face Gradio Space using `@gradio/client`. The Hugging Face token stays in server environment variables.

## Important: choose/configure a compatible free Space

This project is a working web-app scaffold, but public Hugging Face Spaces do not share one universal API schema. Before deployment, choose a public Gradio Space that actually exposes a text-to-video endpoint, then open its **View API** page and copy:
- Space ID (`owner/space-name`)
- API endpoint name (for example `/text_to_video`; use the exact endpoint shown)
- Input argument shape and order

Set `HF_SPACE_ID`, `HF_API_NAME`, and `HF_INPUTS_JSON` to match that Space. The default input JSON assumes a single text prompt: `["{{prompt}}"]`. If the Space takes more inputs, provide them in order, e.g. `["{{prompt}}", 24, "9:16"]`. Only include values the Space actually expects.

Hugging Face offers public Spaces, but shared ZeroGPU resources can queue, pause, rate-limit, or change. Free usage is not guaranteed, and a free Space may not support 9:16 or 30-second output. The UI sends these as requested settings, but this generic connector cannot force a model to honor them unless its API supports those parameters. Hugging Face Inference Providers are a separate metered API; free accounts currently receive only a small monthly allowance (check current pricing).

## Run locally

1. Install Node.js 20+.
2. Extract this project.
3. Copy `.env.example` to `.env.local`.
4. Fill in the three Space settings. `HF_TOKEN` is optional for public Spaces; use a read token for higher anonymous limits if supported.
5. Run:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy online (Render recommended for long requests)

A free shared video Space may take several minutes. Avoid short-timeout serverless deployments for this workload. Render Node web service is a more suitable starting point.

1. Push this folder to a GitHub repository.
2. In Render, create **New → Web Service** and connect the repository.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Choose a Node runtime and a plan whose request timeout supports your provider's generation time.
6. Add environment variables in Render dashboard:
   - `HF_SPACE_ID`
   - `HF_API_NAME`
   - `HF_INPUTS_JSON`
   - `HF_TOKEN` (optional)
7. Deploy. Do not commit `.env.local` or paste API tokens into frontend code.

## Notes

- This app does not create a guaranteed 30-second clip by stitching multiple generations. It asks for the selected target length in the UI only. The actual model's capabilities determine output duration.
- The returned preview/download URL is provided by the Space and may expire. For durable storage, add private object storage (e.g. S3/R2) and copy the generated file server-side.
- Add authentication, per-user rate limits, and abuse protection before making the site public.
- For public-facing use, review the selected Space's license, terms, and output rights.
