import * as vscode from "vscode";
import * as fs from "fs";
import { OpenAIEmbeddings } from "@langchain/openai";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import Groq from "groq-sdk";


async function loadVectorStore(storagePath: string, apiKey: string): Promise<HNSWLib> {

    const embeddings = new OpenAIEmbeddings({ openAIApiKey: apiKey });
    return await HNSWLib.load(storagePath, embeddings);

}

export async function queryCodeBase(question: string, context: vscode.ExtensionContext): Promise<{ answer: string; sources: string[] }> {



    // Get API keys from VS Code from settings
    const config = vscode.workspace.getConfiguration('codebaseChat');
    const openaiKey = config.get<string>('openaiApiKey');
    const groqKey = config.get<string>('groqApiKey');

    if (!openaiKey || !groqKey) {
        return {
            answer: "Missing API keys, please set codebaseChat.openaiApiKey and codebaseChat.groqApiKey in settings.",
            sources: []
        };
    }

    // Check if index exists
    const storagePath = context.globalStorageUri.fsPath;
    const indexExists = fs.existsSync(`${storagePath}/hnswlib.index`);
    if (!indexExists) {
        return {
            answer: 'Codebase not indexed yet. Run "Codebase Chat: Index Project" first.',
            sources: []
        };
    }

    // Loading the vector store
    const vectorStore = await loadVectorStore(storagePath, openaiKey);


    // Embed the query + similarity search with k = 5 for the 5 relevant chunks
    const relevantDocs = await vectorStore.similaritySearch(question, 5);

    // Extracting sources for citation 
    const sources = [...new Set(relevantDocs.map(doc => doc.metadata.source as string))];

    const context_str = relevantDocs.map(
        doc => `// File: ${doc.metadata.source}\n${doc.pageContent}`
    ).join(`\n\n---\n\n`);


    const prompt = `You are an expert code assistant. You are helping a developer understand their codebase.

Use ONLY the code snippets below to answer the question. If the answer isn't in the snippets, say so honestly.
Always mention which file(s) the relevant code is in.

CODE CONTEXT:
${context_str}

QUESTION: ${question}

ANSWER:`;


    const groq = new Groq({ apiKey: groqKey });
    const completion = await groq.chat.completions.create({
        model: 'llama3-70b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1024,
    });

    const answer = completion.choices[0]?.message?.content ?? 'No response from LLM';

    return { answer, sources };


}





