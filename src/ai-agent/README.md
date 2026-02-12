# AI Agent

AI-powered workspace assistant that can search, read, edit files, and execute build commands.

## Configuration

The AI agent requires a configuration file `ai-config.json` in the extension root directory. Copy `ai-config.sample.json` and configure your preferred AI provider.

### Anthropic Claude (Default)

```json
{
  "apiUrl": "https://api.anthropic.com/v1/messages",
  "apiKey": "sk-ant-api03-...",
  "model": "claude-sonnet-4-5-20250929",
  "authType": "anthropic"
}
```

### OpenAI

```json
{
  "apiUrl": "https://api.openai.com/v1/chat/completions",
  "apiKey": "sk-...",
  "model": "gpt-4",
  "authType": "bearer"
}
```

### OpenAI-Compatible APIs

Any OpenAI-compatible API endpoint works with `authType: "bearer"`:

**OpenRouter:**
```json
{
  "apiUrl": "https://openrouter.ai/api/v1/chat/completions",
  "apiKey": "sk-or-...",
  "model": "anthropic/claude-3.5-sonnet",
  "authType": "bearer"
}
```

**Local LLMs (Ollama, LM Studio, etc.):**
```json
{
  "apiUrl": "http://localhost:11434/v1/chat/completions",
  "apiKey": "not-needed",
  "model": "qwen2.5-coder:32b",
  "authType": "bearer"
}
```

### Configuration Fields

- **`apiUrl`**: API endpoint URL
- **`apiKey`**: Your API key (use any string for local models that don't require auth)
- **`model`**: Model identifier
- **`authType`**: 
  - `"anthropic"` - Uses `x-api-key` header (Anthropic Claude)
  - `"bearer"` - Uses `Authorization: Bearer` header (OpenAI, OpenRouter, local LLMs)

## Features

### File Operations
- **Search Files**: Find files using glob patterns (e.g., `**/*.ts`, `src/**`)
- **Read Files**: View file contents
- **Write Files**: Create or update files
- **List Directories**: Browse directory contents

### Command Execution
Execute build and development commands:
- `cargo run`, `cargo build` (Rust projects)
- `make`, `cmake` (C/C++ projects)
- `npm run build`, `npm test` (Node.js projects)
- Any shell command in workspace context

## Usage

### Opening the AI Agent
1. Click **🤖 AI Agent** in the dashboard sidebar
2. Or use command palette: `FIDE: Open AI Agent`

### Example Interactions

**Search for TypeScript files:**
```
Show me all TypeScript files in the src directory
```

**Read a file:**
```
What's in the extension.ts file?
```

**Edit code:**
```
Add error handling to the fetchBoards function in dashboardViewProvider.ts
```

**Run builds:**
```
Build the Rust backend with cargo
```

```
Compile the TypeScript extension
```

## Configuration

API settings are currently hardcoded in [aiAgentProvider.ts](aiAgentProvider.ts):

```typescript
private readonly AI_URL = "https://api.anthropic.com/v1/messages";
private readonly AI_TOKEN = "sk-ant-api03-...";
private readonly MODEL = "claude-3-5-sonnet-20241022";
```

**TODO**: Make these configurable via VS Code settings:
- `fide.aiAgent.apiUrl`
- `fide.aiAgent.apiToken`
- `fide.aiAgent.model`

## Architecture

### Tool Integration
The AI agent uses Claude's tool calling feature with 5 tools:

1. **search_files**: Glob pattern file search via `vscode.workspace.findFiles()`
2. **read_file**: Read file contents with `fs.promises.readFile()`
3. **write_file**: Write/update files with `fs.promises.writeFile()`
4. **execute_command**: Run shell commands in VS Code terminal
5. **list_directory**: List directory contents with `fs.promises.readdir()`

### Conversation Flow
1. User sends message → Added to conversation history
2. Extension calls Claude API with tools available
3. Claude responds with text or tool use requests
4. Extension executes tools and returns results
5. Loop continues until Claude provides final answer
6. Display response to user

### Message Protocol
```typescript
// User → Extension
{ command: 'sendMessage', text: string }

// Extension → Webview
{ command: 'addMessage', role: 'user' | 'assistant', content: string }
{ command: 'setThinking', thinking: boolean }
```

## Limitations

### Command Execution
- Commands run in VS Code terminal (visible to user)
- **Cannot capture terminal output** - user must check terminal manually
- Returns confirmation message, not actual output

### Security
- AI has **full workspace access** (read/write all files)
- Can execute **any shell command**
- API token stored in code (not encrypted)

**⚠️ Security Recommendations:**
1. Move API token to VS Code settings
2. Add file operation confirmations for destructive changes
3. Restrict command execution to allowed list
4. Add workspace permission checks

## Development

### Testing Locally
1. Set your Anthropic API key in `aiAgentProvider.ts`
2. Press F5 to launch Extension Development Host
3. Open dashboard → Click AI Agent
4. Try: "List all files in the src directory"

### Adding New Tools
Add to `tools` array in `callAI()` method:
```typescript
{
    name: "new_tool",
    description: "What it does",
    input_schema: {
        type: "object",
        properties: { /* parameters */ },
        required: [ /* required params */ ]
    }
}
```

Implement handler in `executeTool()`:
```typescript
case 'new_tool':
    return await this.newToolHandler(input.param);
```

## API Reference

### Anthropic API
- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Model**: `claude-3-5-sonnet-20241022`
- **Max Tokens**: 4096
- **API Version**: `2023-06-01`

### Tool Call Format
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 4096,
  "system": "System prompt...",
  "messages": [...],
  "tools": [...]
}
```

### Response Handling
- `stop_reason: "end_turn"` → Final text response
- `stop_reason: "tool_use"` → Execute tools, continue conversation
