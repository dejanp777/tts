# Cartesia Voice Chat

Voice-enabled chat experience where you can speak or type to an OpenRouter-powered assistant; replies are spoken using Cartesia TTS.

## Project layout

- `server/` — Express proxy that wraps Cartesia STT/TTS and OpenRouter chat APIs.
- `web/` — Vite + React front-end for speech capture, text chat, and voice playback of assistant replies.
- `docs/tasks1.md` — Initial task breakdown captured before implementation.

## Prerequisites

- Node.js 20+ (tested with the version bundled in the environment).
- Cartesia and OpenRouter API keys.
- Network access to `api.cartesia.ai` and `openrouter.ai`.

## Environment variables

Copy the samples and add the real keys:

```bash
cp server/.env.example server/.env
cp web/.env.example web/.env
```

### `server/.env`

| Variable | Description |
| --- | --- |
| `PORT` | Port for the Express server (`4000` by default). |
| `OPENROUTER_API_KEY` | OpenRouter API key (e.g. `sk-or-...`). |
| `OPENROUTER_MODEL` | LLM identifier, defaults to `deepseek/deepseek-chat-v3-0324`. |
| `OPENROUTER_SITE_URL` | Optional site URL for OpenRouter rankings. |
| `OPENROUTER_SITE_NAME` | Optional site title for OpenRouter rankings. |
| `CARTESIA_API_KEY` | Cartesia API key (e.g. `sk_car_...`). |
| `CARTESIA_TTS_MODEL` | Cartesia TTS model (`sonic-3` by default). |
| `CARTESIA_VOICE_ID` | Voice ID to use for synthesis. |
| `CARTESIA_VERSION` | API version header (`2024-06-10`). |
| `CARTESIA_STT_MODEL` | Cartesia STT model (`glossa-1` default). |

### `web/.env`

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | Base URL for the backend (`http://localhost:4000` for local dev). |

## Install dependencies

```bash
cd server && npm install
cd ../web && npm install
```

## Run in development

Start the backend (port 4000 by default):

```bash
cd server
npm run dev
```

Start the React dev server (port 5174 by default):

```bash
cd web
npm run dev
```

Then open <http://localhost:5174>.

## Backend endpoints

- `POST /api/stt` — Accepts `multipart/form-data` (`audio` field) and proxies to Cartesia STT. Returns `{ transcript, raw }`.
- `POST /api/chat` — Accepts OpenAI-style `messages` array, forwards to OpenRouter, and returns `{ message, raw }`.
- `POST /api/tts` — Accepts `{ text, voiceId?, speed? }`, proxies to Cartesia TTS, and returns `{ audio, format }` where `audio` is a base64 data URL.
- `GET /health` — Simple health check.

## Manual test flow

1. Verify both backend and frontend servers are running.
2. Load <http://localhost:5174>.
3. Record a short message with **Record Message**, then press **Stop Recording**.
4. Confirm:
   - Your transcript appears in the chat feed.
   - Assistant reply text is added after a short delay.
   - Audio controls appear and auto-play the synthesized reply.
5. Send a typed message via **Send** to confirm text input still works.
6. Use the **Clear** button to reset the conversation.

## Production build

```bash
cd web
npm run build
```

The compiled front-end assets live in `web/dist/`. Serve them from your platform of choice or adjust the Express server to host the static output.

## Additional notes

- Ports 4000 (backend) and 5174 (frontend) were selected to avoid common defaults. Adjust in `.env` files if they collide with other services.
- API responses are logged when errors occur to aid debugging. Remove or adjust logging before deploying to production.
- Browsers may block autoplayed audio if there has been no user interaction. The UI falls back to manual playback when that happens.
- Keep API keys outside of version control and prefer environment variable injection in production.
