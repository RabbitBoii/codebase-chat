import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// File extensions to index
const INCLUDE_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx',
    '.py', '.go', '.rs', '.java',
    '.md', '.json', '.env.example'
];

// Folders to always skip
const EXCLUDE_DIRS = [
    'node_modules', '.git', 'out', 'dist',
    'build', '.next', '__pycache__', '.venv'
];

function getAllFiles(dirPath: string, files: string[] = []): string[] {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        // Skip excluded directories
        if (entry.isDirectory()) {
            if (!EXCLUDE_DIRS.includes(entry.name)) {
                getAllFiles(path.join(dirPath, entry.name), files);
            }
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (INCLUDE_EXTENSIONS.includes(ext)) {
                files.push(path.join(dirPath, entry.name));
            }
        }
    }

    return files;
}

export async function indexWorkspace(context: vscode.ExtensionContext) {
    // 1. Get workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open!');
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // 2. Get API key from settings
    const config = vscode.workspace.getConfiguration('codebaseChat');
    const apiKey = config.get<string>('openaiApiKey');
    if (!apiKey) {
        vscode.window.showErrorMessage(
            'No OpenAI API key found. Set it in Settings → codebaseChat.openaiApiKey'
        );
        return;
    }

    // 3. Walk files + show progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Codebase Chat: Indexing...',
        cancellable: false
    }, async (progress) => {

        progress.report({ message: 'Walking files...' });
        const files = getAllFiles(workspaceRoot);
        vscode.window.showInformationMessage(`Found ${files.length} files to index`);

        // 4. Read + chunk files
        progress.report({ message: `Chunking ${files.length} files...` });
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 500,
            chunkOverlap: 50,
        });

        const docs = [];
        for (const filePath of files) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const relativePath = path.relative(workspaceRoot, filePath);
                const chunks = await splitter.createDocuments(
                    [content],
                    [{ source: relativePath }] // metadata — which file this came from
                );
                docs.push(...chunks);
            } catch (err) {
                // skip files that can't be read (binary, permission issues etc)
                console.warn(`Skipping ${filePath}:`, err);
            }
        }

        vscode.window.showInformationMessage(`Created ${docs.length} chunks`);

        // 5. Embed + store
        progress.report({ message: `Embedding ${docs.length} chunks... (this may take a minute)` });
        const embeddings = new OpenAIEmbeddings({ openAIApiKey: apiKey });
        const vectorStore = await HNSWLib.fromDocuments(docs, embeddings);

        // 6. Save to disk (persists across sessions)
        const storagePath = context.globalStorageUri.fsPath;
        fs.mkdirSync(storagePath, { recursive: true });
        await vectorStore.save(storagePath);

        vscode.window.showInformationMessage('✅ Codebase indexed successfully!');
    });
}

export async function loadVectorStore(context: vscode.ExtensionContext, apiKey: string) {
    const storagePath = context.globalStorageUri.fsPath;
    const embeddings = new OpenAIEmbeddings({ openAIApiKey: apiKey });
    return await HNSWLib.load(storagePath, embeddings);
}