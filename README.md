# Codebase Chat — VS Code Extension

> **Chat with your codebase.** Ask questions in plain English, get grounded answers from your actual source files — no hallucinations, no tab-switching.

---

## What it does & the problem it solves

Honestly, this project came from two things happening at the same time.

First, I was learning RAG — how you chunk documents, embed them into a vector store, and retrieve the relevant bits to ground an LLM's answer. I understood the concept, but I wanted to actually build something with it, not just run a tutorial notebook.

Second, I kept hitting a frustration at work: whenever I landed on an unfamiliar file or wanted to understand how something in the codebase connected to something else, my reflex was to *copy the code and paste it into ChatGPT*. Which works — until the file is too long, or the answer depends on three other files you forgot to include, or the LLM just confidently makes something up because it has no idea what your actual code does.

That's when it clicked. RAG is literally designed for this. You chunk your documents, embed them, and retrieve what's relevant. Your codebase *is* a collection of documents. So — why not do the same thing with source files and build it straight into the editor?

That's **Codebase Chat**. Index your project once, then ask questions in a sidebar panel. The extension finds the most relevant chunks across your actual files and sends them to the LLM as context — so the answer is grounded in *your* code, not a hallucination. It also tells you which files it pulled from.

Here's how it works end-to-end:

```
Your project files
       │
       ▼
  [ Indexer ]  — walks files, chunks them, embeds with OpenAI → saves HNSWLib vector store to disk
       │
       ▼
  [ Retriever ] — embeds your question, runs similarity search, pulls top-5 relevant chunks
       │
       ▼
  [ Groq LLM ] — receives question + retrieved code context → returns a grounded answer
       │
       ▼
  Sidebar panel in VS Code — with source file citations
```

**Why RAG instead of just dumping all the code into the LLM?**  
Real projects are too large for any context window and spread across dozens of files. RAG retrieves *only the relevant* chunks for each question — so answers are accurate, fast, and always cite which file they came from.

---

## How to install and run from source

### Prerequisites

- Node.js ≥ 18
- VS Code ≥ 1.70
- An OpenAI API key (for embeddings)
- A Groq API key (for LLM responses — [get one free at console.groq.com](https://console.groq.com))

### 1. Clone the repo

```bash
git clone https://github.com/<your-username>/context-code-explainer.git
cd context-code-explainer
```

### 2. Install dependencies

```bash
npm install
```

### 3. Add your API keys

Create a `.env` file in the project root:

```env
OPEN_AI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

> **Note:** `.env` is in `.gitignore` — your keys are never committed.

### 4. Compile

```bash
npm run compile
```

### 5. Launch the extension

Press **F5** in VS Code. A new Extension Development Host window opens.

### 6. Use it

1. Open any project folder in the Extension Development Host window
2. Click the **Codebase Chat** icon in the Activity Bar (left sidebar)
3. Click **⚡ Index Codebase** — this walks your files, chunks them, and builds the vector store (takes ~30s for a medium project)
4. Type any question and hit **Ask** (or `Ctrl+Enter`)

---

## Architecture & folder structure

```
src/
├── extension.ts   — activation entry point, sidebar webview registration, loads .env
├── indexer.ts     — file walker, text splitter, OpenAI embeddings, HNSWLib vector store save
├── retriever.ts   — similarity search, Groq LLM call, returns answer + source citations
└── chatPanel.ts   — (reserved for future standalone panel)

media/
└── icon.svg       — activity bar icon
```

**Key tech choices:**

| Concern | Choice | Reason |
|---|---|---|
| Embeddings | `@langchain/openai` | Best quality, standard |
| Vector store | `HNSWLib` (via `@langchain/community`) | Runs fully in-process, no Docker/server needed |
| LLM | Groq (`llama3-70b-8192`) | Free tier, extremely fast inference |
| Chunking | `RecursiveCharacterTextSplitter` (500 tokens, 50 overlap) | Respects code structure |

---

## The hardest problems I ran into — and how I solved them

### Problem 1: Initializing a VS Code extension is not obvious

Before any of the RAG logic, I just needed the extension to *load*. Turns out the VS Code extension manifest (`package.json`) is very particular, and I managed to break it in a way that took me a while to understand.

I wanted to load API keys from a `.env` file, and my first instinct was to reference them directly in `package.json` as configuration defaults:

```json
"default": `${process.env.OPEN_AI_API_KEY}`
```

This is completely invalid — `package.json` is **static JSON**, not JavaScript. Template literals don't exist in JSON. VS Code couldn't parse the manifest at all, so the extension silently failed to activate with no useful error message. I spent a good chunk of time confused about why nothing was loading before I realized the manifest itself was broken.

Once I understood that `package.json` in a VS Code extension is a declarative config file (not a Node.js module), things started making more sense. The fix was to set `"default": ""` and handle key loading entirely in TypeScript at runtime.

### Problem 2: API keys from `.env` weren't reaching the indexer at runtime

After fixing the manifest, I had a subtler bug: the keys from `.env` still weren't being picked up when the user clicked "Index Codebase".

I tried writing them into VS Code settings via `config.update()` inside `activate()`. That also failed silently: `config.update()` is **async** and returns a Promise I wasn't awaiting. By the time the user clicked the button, the write hadn't finished and `config.get()` still returned `""`.

**How I solved it:**

1. Used `dotenv.config({ path: envPath })` — which is **synchronous** — at the very start of `activate()`, before registering anything. This immediately populates `process.env`.
2. In `indexer.ts` and `retriever.ts`, added a fallback:
   ```typescript
   const apiKey = config.get<string>('openaiApiKey') || process.env.OPEN_AI_API_KEY;
   ```
   If a user has manually set the key in VS Code settings, that wins. Otherwise, `process.env` (loaded by dotenv) is used. No async writes, no race conditions.

The core lesson: **don't mix async config writes with synchronous reads in the activation flow** — if you need something available immediately, `process.env` is your friend.

---


## What I'd do next with more time

1. **Incremental re-indexing** — currently the whole project re-indexes on every click. A file-watcher + hash-based dirty tracking would only re-embed changed files.

2. **Streaming responses** — Groq supports streaming; piping chunks back to the webview via `postMessage` would make it feel much more responsive.

3. **Smarter chunking** — parse TypeScript/Python ASTs and chunk by function/class boundary rather than raw character count. This would dramatically improve retrieval precision.

4. **`.vscodeignore`-aware file walking** — currently I maintain a manual `EXCLUDE_DIRS` list. It should respect `.gitignore` and `.vscodeignore` automatically.

5. **Conversation history** — right now every question is independent. Passing the last N turns as context to the LLM would enable follow-up questions like "what about the error handling in that function?".

6. **Publish to VS Code marketplace** — package as `.vsix` and submit. Would need to handle API key setup UX more gracefully (prompt on first use instead of relying on `.env`).

---

## Tech stack

- **Language:** TypeScript
- **VS Code API:** Webview panels, commands, workspace configuration
- **LangChain.js:** `@langchain/openai`, `@langchain/community`, `@langchain/textsplitters`
- **Vector store:** HNSWLib (in-process, no server)
- **LLM:** Groq (`llama3-70b-8192`)
- **Embeddings:** OpenAI (`text-embedding-ada-002`)
