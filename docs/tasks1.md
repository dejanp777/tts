# Voice Chat Bot Task List

1. Review the repository to confirm it is empty, restate requirements, and choose the tech stack (frontend, backend, build tooling).
2. Identify all external services (OpenRouter LLM, Cartesia TTS, Cartesia STT), document required REST endpoints, payload formats, and environment variables.
3. Set up project structure (frontend app + backend service), initialize package management, and add foundational configuration (TypeScript, ESLint/Prettier if needed).
4. Implement backend proxy/service layer:
   - a. Securely load API keys from environment/config.
   - b. Create endpoint to accept recorded audio, forward to Cartesia STT, and return transcript.
   - c. Create endpoint that sends user transcript/history to OpenRouter LLM and returns assistant text.
   - d. Create endpoint that converts assistant text to audio via Cartesia TTS and streams/returns playable audio.
5. Implement frontend UI:
   - a. Build chat interface (history display, user input status, playback controls).
   - b. Implement microphone capture, chunking/upload to backend STT endpoint, and handle transcript display.
   - c. Integrate with chat endpoint to retrieve assistant replies and subsequent TTS audio for playback.
   - d. Manage loading/error states, permissions prompts, and UX polish.
6. Wire the full voice-chat loop (record → STT → LLM → TTS), ensure state consistency, and handle retries/errors gracefully.
7. Add configuration for local development (e.g., `.env.example`, readme instructions) including port selection to avoid conflicts.
8. Test end-to-end locally, document manual test steps, and note any limitations or next steps.
