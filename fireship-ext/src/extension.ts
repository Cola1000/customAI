import * as vscode from 'vscode';
import ollama from 'ollama';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    id?: string;
    loading?: boolean;
}

interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
}

export function activate(context: vscode.ExtensionContext) {
    let activeChatId: string | null = null;
    const chatSessions: ChatSession[] = [];

    const disposable = vscode.commands.registerCommand('fireship-ext.start', () => {
        const panel = vscode.window.createWebviewPanel(
            'chatView',
            'AI Chat',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = getWebviewContent();
        setupMessageHandlers(panel);
        createNewChat(panel);
        
        context.subscriptions.push(panel);
    });

    context.subscriptions.push(disposable);

    function setupMessageHandlers(panel: vscode.WebviewPanel) {
        panel.webview.onDidReceiveMessage(async (message: any) => {
            try {
                switch (message.command) {
                    case 'newChat':
                        createNewChat(panel);
                        break;
                    case 'chat':
                        if (!message.text?.trim()) {
                            throw new Error('Message cannot be empty');
                        }
                        await handleChatMessage(panel, message);
                        break;
                    case 'switchChat':
                        handleSwitchChat(panel, message.chatId);
                        break;
                    case 'loadChatList':
                        updateChatList(panel);
                        break;
                }
            } catch (error: any) {
                console.error('Error handling message:', error);
                sendMessageToWebview(panel, 'error', {
                    chatId: activeChatId,
                    message: `Error: ${error.message}`
                });
            }
        });
    }

    function handleSwitchChat(panel: vscode.WebviewPanel, chatId: string) {
        activeChatId = chatId;
        panel.webview.postMessage({
            command: 'loadChat',
            chatId: activeChatId,
            messages: getChatMessages(activeChatId)
        });
        updateChatList(panel);
    }

    function createNewChat(panel: vscode.WebviewPanel) {
        const newChat: ChatSession = {
            id: Date.now().toString(),
            title: `Chat ${chatSessions.length + 1}`,
            messages: []
        };
        chatSessions.push(newChat);
        activeChatId = newChat.id;
        updateChatList(panel);
    }

    function updateChatList(panel: vscode.WebviewPanel) {
        panel.webview.postMessage({
            command: 'updateChatList',
            chats: chatSessions.map(chat => ({
                id: chat.id,
                title: chat.title,
                active: chat.id === activeChatId
            }))
        });
    }

    function getChatMessages(chatId: string): ChatMessage[] {
        return chatSessions.find(chat => chat.id === chatId)?.messages || [];
    }

    async function handleChatMessage(panel: vscode.WebviewPanel, message: any) {
        if (!activeChatId) return;

        const chatSession = chatSessions.find(chat => chat.id === activeChatId);
        if (!chatSession) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content: message.text,
            id: `user-${Date.now()}`
        };
        chatSession.messages.push(userMessage);

        const botMessageId = `bot-${Date.now()}`;
        const botMessage: ChatMessage = {
            role: 'assistant',
            content: '',
            id: botMessageId,
            loading: true
        };
        chatSession.messages.push(botMessage);

        sendMessageToWebview(panel, 'newMessage', {
            chatId: activeChatId,
            message: userMessage
        });

        sendMessageToWebview(panel, 'newMessage', {
            chatId: activeChatId,
            message: botMessage
        });

        try {
            await streamResponse(panel, chatSession, botMessageId);
        } catch (err: any) {
            sendMessageToWebview(panel, 'error', {
                chatId: activeChatId,
                message: `Error: ${err.message}`
            });
        }
    }

    async function streamResponse(panel: vscode.WebviewPanel, chatSession: ChatSession, botMessageId: string) {
        try {
            const messages = chatSession.messages
                .slice(0, -1) // Exclude the current bot message
                .map(msg => ({ role: msg.role, content: msg.content }));

            const response = await ollama.chat({
                model: 'deepseek-r1:8b',
                messages,
                stream: true
            });

            let responseText = '';
            for await (const part of response) {
                if (part?.message?.content) {
                    responseText += part.message.content;
                    sendMessageToWebview(panel, 'updateMessage', {
                        chatId: activeChatId,
                        messageId: botMessageId,
                        content: formatResponseText(responseText),
                        loading: true
                    });
                }
            }

            updateBotMessage(chatSession, botMessageId, responseText, false);
            sendMessageToWebview(panel, 'updateMessage', {
                chatId: activeChatId,
                messageId: botMessageId,
                content: formatResponseText(responseText),
                loading: false
            });
        } catch (error) {
            console.error('Streaming error:', error);
            throw error;
        }
    }

    function updateBotMessage(chatSession: ChatSession, botMessageId: string, content: string, loading: boolean) {
        const botMessage = chatSession.messages.find(m => m.id === botMessageId);
        if (botMessage) {
            botMessage.content = content;
            botMessage.loading = loading;
        }
    }

    function sendMessageToWebview(panel: vscode.WebviewPanel, command: string, data: any) {
        panel.webview.postMessage({ command, ...data });
    }
}

function formatResponseText(text: string): string {
    return text
        // Handle thinking blocks
        .replace(/<think>/g, '<blockquote class="thinking">')
        .replace(/<\/think>/g, '</blockquote>')
        // Handle code blocks with language
        .replace(/```(\w+)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
        // Handle code blocks without language
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        // Handle inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Handle bold text
        .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
        // Handle italic text
        .replace(/\*([^\*]+)\*/g, '<em>$1</em>')
        // Handle links
        .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>')
        // Handle headers (h1 to h6)
        .replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>')
        .replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>')
        .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
        .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
        .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
        // Handle lists
        .replace(/^\s*[-*+]\s+(.+)$/gm, '<li>$1</li>')
        .replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')
        // Handle paragraphs and line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
}

function getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat</title>
    <style>
        body {
            display: flex;
            margin: 0;
            padding: 0;
            height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .sidebar {
            width: 200px;
            padding: 16px;
            background: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-sideBar-border);
        }
        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 16px;
        }
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 16px;
        }
        .message {
            margin: 8px 0;
            padding: 12px 16px;
            border-radius: 8px;
            max-width: 80%;
            line-height: 1.5;
            word-wrap: break-word;
        }
        .user-message {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
        }
        .bot-message {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-editor-lineHighlightBorder);
        }
        .loading::after {
            content: '...';
            animation: dots 1s steps(4, end) infinite;
        }
        @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60% { content: '...'; }
            80%, 100% { content: '....'; }
        }
        .input-container {
            padding: 8px 0;
        }
        .input-wrapper {
            display: flex;
            gap: 8px;
        }
        textarea {
            flex: 1;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            line-height: 1.5;
            resize: none;
            min-height: 40px;
            max-height: 200px;
        }
        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }
        code {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }
        .chat-item {
            padding: 8px;
            cursor: pointer;
            border-radius: 4px;
            margin-bottom: 4px;
        }

        .thinking {
            margin: 8px 0;
            padding: 8px 16px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            color: var(--vscode-textBlockQuote-foreground);
            font-style: italic;
        }

        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }

        code {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            padding: 2px 4px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 3px;
        }

        pre code {
            padding: 0;
            background: transparent;
        }

        h1, h2, h3, h4, h5, h6 {
            margin: 16px 0 8px 0;
            color: var(--vscode-editor-foreground);
        }

        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        p {
            margin: 8px 0;
        }

        li {
            margin: 4px 0;
            margin-left: 20px;
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <button id="newChatButton">+ New Chat</button>
        <div id="chatList"></div>
    </div>
    
    <div class="chat-container">
        <div class="chat-messages" id="chatMessages"></div>
        <div class="input-container">
            <div class="input-wrapper">
                <textarea id="messageInput" placeholder="Ask me anything..."></textarea>
                <button id="sendButton">Send</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let activeChatId = null;

        function initializeEventListeners() {
            document.getElementById('newChatButton').addEventListener('click', () => {
                vscode.postMessage({ command: 'newChat' });
            });

            const messageInput = document.getElementById('messageInput');
            const sendButton = document.getElementById('sendButton');

            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            messageInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
            });

            sendButton.addEventListener('click', sendMessage);

            document.getElementById('chatList').addEventListener('click', (e) => {
                const chatItem = e.target.closest('.chat-item');
                if (chatItem) {
                    vscode.postMessage({ 
                        command: 'switchChat', 
                        chatId: chatItem.dataset.chatId 
                    });
                }
            });
        }

        function sendMessage() {
            const messageInput = document.getElementById('messageInput');
            const text = messageInput.value.trim();
            
            if (!text) return;

            messageInput.value = '';
            messageInput.style.height = 'auto';
            messageInput.focus();

            vscode.postMessage({ 
                command: 'chat',
                text: text,
                chatId: activeChatId
            });
        }

        window.addEventListener('message', (event) => {
            const message = event.data;

            switch (message.command) {
                case 'updateChatList':
                    updateChatList(message.chats);
                    break;
                case 'newMessage':
                    appendMessage(message.message);
                    scrollToBottom();
                    break;
                case 'updateMessage':
                    updateMessage(message);
                    scrollToBottom();
                    break;
                case 'loadChat':
                    loadChat(message);
                    break;
                case 'error':
                    showError(message.message);
                    break;
            }
        });

        function appendMessage(message) {
            const messagesDiv = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${message.role}-message\`;
            if (message.id) {
                messageDiv.id = message.id;
            }
            if (message.loading) {
                messageDiv.classList.add('loading');
            }
            messageDiv.innerHTML = message.content;
            messagesDiv.appendChild(messageDiv);
        }

        function updateMessage({ messageId, content, loading }) {
            const messageDiv = document.getElementById(messageId);
            if (messageDiv) {
                messageDiv.innerHTML = content;
                if (loading) {
                    messageDiv.classList.add('loading');
                } else {
                    messageDiv.classList.remove('loading');
                }
            }
        }

        function updateChatList(chats) {
            const chatList = document.getElementById('chatList');
            chatList.innerHTML = chats.map(chat => 
                \`<div class="chat-item" data-chat-id="\${chat.id}" 
                    style="background: \${chat.active ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent'};
                    color: \${chat.active ? 'var(--vscode-list-activeSelectionForeground)' : 'inherit'}">
                    \${chat.title}
                </div>\`
            ).join('');
            if (chats.find(c => c.active)) {
                activeChatId = chats.find(c => c.active).id;
            }
        }

        function loadChat({ messages, chatId }) {
            activeChatId = chatId;
            const messagesDiv = document.getElementById('chatMessages');
            messagesDiv.innerHTML = '';
            messages.forEach(appendMessage);
            scrollToBottom();
        }

        function showError(message) {
            const messagesDiv = document.getElementById('chatMessages');
            const errorDiv = document.createElement('div');
            errorDiv.className = 'message bot-message error';
            errorDiv.innerHTML = message;
            messagesDiv.appendChild(errorDiv);
            scrollToBottom();
        }

        function loadChat({ messages }) {
            const messagesDiv = document.getElementById('chatMessages');
            messagesDiv.innerHTML = '';
            messages.forEach(msg => appendMessage(msg.role, msg.content));
            scrollToBottom();
        }

        initializeEventListeners();
        vscode.postMessage({ command: 'loadChatList' });
    </script>
</body>
</html>`;
}

export function deactivate() {}