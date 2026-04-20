import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { OllamaEmbeddings } from "@langchain/ollama";
import Groq from "groq-sdk";
import { DocEntry, INDEX_FILE } from "./indexer";

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

// Load the saved JSON index from disk
function loadIndex(storagePath: string): DocEntry[] {
    const indexPath = path.join(storagePath, INDEX_FILE);
    const raw = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(raw) as DocEntry[];
}

// Find the k most similar chunks to a query embedding
function topK(index: DocEntry[], queryEmbedding: number[], k: number): DocEntry[] {
    return index
        .map(entry => ({ entry, score: cosineSimilarity(queryEmbedding, entry.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(r => r.entry);
}

export async function queryCodeBase(
    question: string,
    context: vscode.ExtensionContext
): Promise<{ answer: string; sources: string[] }> {

    // Only Groq key is needed — Ollama handles embeddings locally for free
    const config = vscode.workspace.getConfiguration('codebaseChat');
    const groqKey = config.get<string>('groqApiKey');

    if (!groqKey) {
        return {
            answer: "Missing Groq API key. Set it in Settings → codebaseChat.groqApiKey",
            sources: []
        };
    }

    // Check if index file exists
    const storagePath = context.globalStorageUri.fsPath;
    const indexPath = path.join(storagePath, INDEX_FILE);
    if (!fs.existsSync(indexPath)) {
        return {
            answer: 'Codebase not indexed yet. Click "⚡ Index Codebase" first.',
            sources: []
        };
    }

    // Load index + embed the query with Ollama
    const index = loadIndex(storagePath);
    const embedModel = new OllamaEmbeddings({
        model: 'nomic-embed-text',
        baseUrl: 'http://localhost:11434'
    });

    const queryEmbedding = await embedModel.embedQuery(question);

    // Find the 5 most relevant chunks via cosine similarity
    const relevantDocs = topK(index, queryEmbedding, 5);

    // Unique source files for citation
    const sources: string[] = [...new Set(relevantDocs.map(d => d.metadata.source))];

    const context_str = relevantDocs
        .map(d => `// File: ${d.metadata.source}\n${d.pageContent}`)
        .join('\n\n---\n\n');

    const prompt = `You are an expert code assistant helping a developer understand their codebase.

Use ONLY the code snippets below to answer the question. If the answer isn't in the snippets, say so honestly.
Always mention which file(s) the relevant code is in.

CODE CONTEXT:
${context_str}

QUESTION: ${question}

ANSWER:`;

    const groq = new Groq({ apiKey: groqKey });
    const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1024,
    });

    const answer = completion.choices[0]?.message?.content ?? 'No response from LLM';

    return { answer, sources };
}
