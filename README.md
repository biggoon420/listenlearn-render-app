# ListenLearn

A Render-deployable web app that asks what the user wants to learn, searches for stronger web sources, summarizes them, provides quick article links, and reads the result aloud with a natural AI voice.

## What it uses

- **Node + Express** for the Render backend
- **Brave Search API** to find current web sources
- **Readability + JSDOM** to extract article text when possible
- **OpenAI** for source-grounded summarization and text-to-speech
- **Static frontend/PWA** so it works well from iPhone Safari and can be added to the Home Screen

## Required API keys

Create a `.env` file locally, or add these as Render environment variables:

```bash
OPENAI_API_KEY=sk-your-openai-key
BRAVE_API_KEY=your-brave-search-api-key
```

Optional:

```bash
OPENAI_TEXT_MODEL=gpt-5-mini
OPENAI_TTS_MODEL=gpt-4o-mini-tts
DEFAULT_VOICE=marin
MAX_SOURCES=5
```

If your OpenAI account does not have access to the default text model, change `OPENAI_TEXT_MODEL` to a model available in your account.

## Run locally

```bash
npm install
cp .env.example .env
# edit .env and add your keys
npm run dev
```

Open:

```text
http://localhost:3000
```

## Deploy on Render

1. Make a new GitHub repo.
2. Upload/push these files.
3. In Render, create a **New Web Service** from the repo.
4. Use:
   - Build command: `npm install`
   - Start command: `npm start`
5. Add environment variables:
   - `OPENAI_API_KEY`
   - `BRAVE_API_KEY`
   - optional model/voice variables from above
6. Deploy.

The app will be available at your Render URL. On iPhone, open the URL in Safari and use **Share → Add to Home Screen**.

## How source quality works

The backend does not blindly summarize the first links. It:

1. Searches for the question plus reliability-oriented terms.
2. Penalizes social, forum, shopping, and low-quality domains.
3. Boosts `.gov`, `.edu`, academic, official, and known reputable publisher domains.
4. Avoids repeating the same root domain.
5. Extracts article text when possible, then asks the model to summarize only from the provided sources.
6. Re-attaches source URLs from the backend so the model cannot hallucinate links.

You should customize `TRUSTED_EXACT_DOMAINS` in `server.js` for your target niche. For example, if this becomes a music-learning app, add more music tech, production, and academic musicology sources.

## Important production upgrades

Before sharing widely, add:

- User accounts or a simple password gate
- Rate limiting, so one person cannot burn your API keys
- A daily spending cap
- Source category presets, such as science, history, music, coding, finance, etc.
- A cache, so repeated questions do not re-run search + summarization + TTS every time
- Moderation rules if users can ask anything

## AI voice disclosure

The frontend includes this disclosure: the spoken narration is AI-generated, not a human recording.


## Current UI behavior

This version intentionally has no depth selector and no voice selector. Research depth is always deep, the voice is always Marin, and the visible interface is kept to the question box, status, overview, audio, and source links.

If your browser still shows the old version, hard refresh once or unregister the old service worker in DevTools. The cache name was bumped in this build, so it should refresh automatically after reload.
