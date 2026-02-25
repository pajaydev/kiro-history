# kiro-history

Browse your Kiro conversations in a nice web UI. Supports both Kiro CLI and Kiro IDE.

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
  path                    Custom path to the database file (CLI) or sessions directory (IDE)

Options:
  -s, --source <type>     Source type: cli, ide, or auto (default: auto)
  -p, --port <number>     Port to run the server on (default: auto)
  --no-open               Do not open browser automatically
  -V, --version           Show version number
  -h, --help              Show help
```

## Examples

```bash
# Default usage - auto-detects CLI or IDE, opens browser
npx kiro-history

# Explicitly use Kiro IDE conversations
npx kiro-history --source ide

# Explicitly use Kiro CLI conversations
npx kiro-history --source cli

# Use a specific port
npx kiro-history -p 3000

# Don't open browser automatically
npx kiro-history --no-open

# Use a custom database path (CLI mode)
npx kiro-history ~/path/to/data.sqlite3

# Use a custom sessions directory (IDE mode)
npx kiro-history --source ide ~/path/to/kiro.kiroagent
```

## Features

- 🔍 Search across all conversations
- 📝 Markdown rendering with syntax-highlighted code blocks
- 🔧 Collapsible tool usage details

## How it works

Kiro CLI saves conversations to a local SQLite database, while Kiro IDE stores them as JSON files in its global storage directory. This tool reads from either source and displays your chat history in a clean, browsable format.

When using `--source auto` (the default), the tool checks for both data sources and picks whichever is available. If both exist, it prefers the IDE.

## License

MIT
