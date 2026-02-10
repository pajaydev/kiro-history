# kiro-history

Browse your Kiro CLI conversations in a nice web UI.

## Installation

```bash
# Run directly with npx (no install needed)
npx kiro-history

# Or install globally
npm install -g kiro-history
kiro-history
```

## Options

```
kiro-history [path] [options]

Arguments:
  path                    Custom path to the database file (optional)

Options:
  -p, --port <number>     Port to run the server on (default: auto)
  --no-open               Do not open browser automatically
  -V, --version           Show version number
  -h, --help              Show help
```

## Examples

```bash
# Default usage - auto-detect database, open browser
npx kiro-history

# Use a specific port
npx kiro-history -p 3000

# Don't open browser automatically
npx kiro-history --no-open

# Use a custom database path
npx kiro-history ~/path/to/data.sqlite3
```

## Features

- 🔍 Search across all conversations
- 📝 Markdown rendering with syntax-highlighted code blocks
- 🔧 Collapsible tool usage details

## How it works

Kiro CLI automatically saves all conversations to a local SQLite database. This tool reads that database and displays your chat history in a clean, browsable format.

## License

MIT
