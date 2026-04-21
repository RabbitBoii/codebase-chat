import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaEmbeddings } from '@langchain/ollama';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// File extensions to index
const INCLUDE_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx',
    '.py', '.go', '.rs', '.java',
    // '.md',
    '.json', '.env.example'
];

// Folders to always skip
const EXCLUDE_DIRS = [
    'node_modules', '.git', 'out', 'dist',
    'build', '.next', '__pycache__', '.venv'
];

// The index file we persist to disk
export const INDEX_FILE = 'codebase-index.json';

export interface DocEntry {
    pageContent: string;
    metadata: { source: string };
    embedding: number[];
}

function getAllFiles(dirPath: string, files: string[] = []): string[] {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
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

    // 2. Walk files + show progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Codebase Chat: Indexing...',
        cancellable: false
    }, async (progress) => {

        progress.report({ message: 'Walking files...' });
        const files = getAllFiles(workspaceRoot);
        vscode.window.showInformationMessage(`Found ${files.length} files to index`);

        // 3. Read + chunk files
        progress.report({ message: `Chunking ${files.length} files...` });
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 500,
            chunkOverlap: 50,
        });

        const rawDocs: { pageContent: string; metadata: Record<string, unknown> }[] = [];
        for (const filePath of files) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const relativePath = path.relative(workspaceRoot, filePath);
                const chunks = await splitter.createDocuments(
                    [content],
                    [{ source: relativePath }]
                );
                rawDocs.push(...chunks);
            } catch (err) {
                console.warn(`Skipping ${filePath}:`, err);
            }
        }

        vscode.window.showInformationMessage(`Created ${rawDocs.length} chunks`);

        // 4. Embed all chunks using Ollama (local, free)
        progress.report({ message: `Embedding ${rawDocs.length} chunks via Ollama... (this may take a minute)` });

        const embedModel = new OllamaEmbeddings({
            model: 'nomic-embed-text',
            baseUrl: 'http://localhost:11434'
        });

        const entries: DocEntry[] = [];
        const BATCH = 16; // embed in small batches to avoid overwhelming Ollama
        for (let i = 0; i < rawDocs.length; i += BATCH) {
            const batch = rawDocs.slice(i, i + BATCH);
            const texts = batch.map(d => d.pageContent);
            const vectors = await embedModel.embedDocuments(texts);
            for (let j = 0; j < batch.length; j++) {
                entries.push({
                    pageContent: batch[j].pageContent,
                    metadata: { source: String(batch[j].metadata['source'] ?? '') },
                    embedding: vectors[j]
                });
            }
            progress.report({ message: `Embedding... ${Math.min(i + BATCH, rawDocs.length)}/${rawDocs.length}` });
        }

        // 5. Save index to disk as plain JSON
        const storagePath = context.globalStorageUri.fsPath;
        fs.mkdirSync(storagePath, { recursive: true });
        const indexPath = path.join(storagePath, INDEX_FILE);
        fs.writeFileSync(indexPath, JSON.stringify(entries), 'utf-8');

        vscode.window.showInformationMessage(`✅ Indexed ${entries.length} chunks → ${indexPath}`);
    });
}