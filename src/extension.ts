import * as vscode from 'vscode';
import { indexWorkspace } from './indexer';
import { queryCodeBase } from './retriever';

class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codebaseChatView';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) { }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtml();

    // Listen for messages from the UI
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'query') {
        webviewView.webview.postMessage({ type: 'loading' });
        const { answer, sources } = await queryCodeBase(msg.text, this._context);
        webviewView.webview.postMessage({ type: 'answer', text: answer, sources });
      }
      if (msg.type === 'index') {
        await indexWorkspace(this._context);
      }
    });
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      padding: 8px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
    }
    #toolbar {
      margin-bottom: 8px;
    }
    #index-btn {
      width: 100%;
      padding: 6px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    #index-btn:hover { opacity: 0.9; }
    #messages {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .msg {
      padding: 8px 10px;
      border-radius: 6px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .user {
      background: var(--vscode-inputOption-activeBackground);
      align-self: flex-end;
      max-width: 85%;
    }
    .bot {
      background: var(--vscode-editor-inactiveSelectionBackground);
      align-self: flex-start;
      max-width: 95%;
    }
    .sources {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 4px;
    }
    .loading { opacity: 0.5; font-style: italic; }
    #input-row { display: flex; gap: 4px; }
    textarea {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px 8px;
      border-radius: 3px;
      resize: none;
      height: 60px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button#ask-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 3px;
      cursor: pointer;
      align-self: flex-end;
    }
    button#ask-btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="index-btn">⚡ Index Codebase</button>
  </div>
  <div id="messages"></div>
  <div id="input-row">
    <textarea id="inp" placeholder="Ask about your codebase..."></textarea>
    <button id="ask-btn">Ask</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const msgsEl = document.getElementById('messages');
    const inp = document.getElementById('inp');

    // Index button
    document.getElementById('index-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'index' });
    });

    // Ask button
    document.getElementById('ask-btn').addEventListener('click', send);

    // Ctrl+Enter to send
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) send();
    });

    function send() {
      const text = inp.value.trim();
      if (!text) return;
      addMsg(text, 'user');
      vscode.postMessage({ type: 'query', text });
      inp.value = '';
    }

    function addMsg(text, role, sources) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      if (role === 'bot' && text === 'Thinking...') {
        div.classList.add('loading');
      }
      div.textContent = text;
      if (sources && sources.length) {
        const s = document.createElement('div');
        s.className = 'sources';
        s.textContent = '📁 ' + sources.join(', ');
        div.appendChild(s);
      }
      msgsEl.appendChild(div);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return div;
    }

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'loading') {
        addMsg('Thinking...', 'bot');
      }
      if (msg.type === 'answer') {
        // remove last "Thinking..." bubble
        const last = msgsEl.lastElementChild;
        if (last?.classList.contains('loading')) last.remove();
        addMsg(msg.text, 'bot', msg.sources);
      }
    });
  </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codebaseChat.index', () => {
      indexWorkspace(context);
    })
  );
}

export function deactivate() { }