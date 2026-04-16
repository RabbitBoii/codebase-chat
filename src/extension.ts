import * as vscode from 'vscode';

class ChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'codebaseChatView';

	constructor(private readonly _extensionUri: vscode.Uri) { }

	resolveWebviewView(webviewView: vscode.WebviewView) {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtml();

		// Listen for messages from the UI
		webviewView.webview.onDidReceiveMessage(async (msg) => {
			if (msg.type === 'query') {
				// TODO: plug in your RAG pipeline here
				webviewView.webview.postMessage({
					type: 'answer',
					text: `You asked: "${msg.text}" (RAG not wired yet)`
				});
			}
		});
	}

	private _getHtml(): string {
		return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 8px; display: flex; flex-direction: column; height: 100vh; margin: 0; box-sizing: border-box; }
    #messages { flex: 1; overflow-y: auto; margin-bottom: 8px;}
    .msg { margin: 6px 0; padding: 6px 8px; border-radius: 4px; }
    .user { background: var(--vscode-inputOption-activeBackground); }
    .bot { background: var(--vscode-editor-inactiveSelectionBackground); }
    #input-row { display: flex; gap: 4px;  }
    input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 3px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-row">
    <input id="inp" type="text" placeholder="Ask about your codebase..." />
    <button onclick="send()">Ask</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const msgs = document.getElementById('messages');
    const inp = document.getElementById('inp');

    function send() {
      const text = inp.value.trim();
      if (!text) return;
      addMsg(text, 'user');
      vscode.postMessage({ type: 'query', text });
      inp.value = '';
    }

    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

    function addMsg(text, role) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'answer') addMsg(msg.text, 'bot');
    });
  </script>
</body>
</html>`;
	}
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new ChatViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('codebaseChat.index', () => {
			vscode.window.showInformationMessage('Indexing codebase... (TODO)');
		})
	);
}

export function deactivate() { }