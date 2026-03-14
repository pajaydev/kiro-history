# kiro-history

[![npm version](https://img.shields.io/npm/v/kiro-history.svg)](https://www.npmjs.com/package/kiro-history)
[![npm downloads](https://img.shields.io/npm/dm/kiro-history.svg)](https://www.npmjs.com/package/kiro-history)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Browse your Kiro conversations in a beautiful web UI. Supports both Kiro CLI and Kiro IDE.

## ✨ Features

- 🔍 **Search** - Find conversations instantly across all your history
- 📝 **Markdown Support** - Properly rendered markdown with syntax-highlighted code blocks and tables
- 🔧 **Tool Details** - Collapsible tool usage information for each assistant response
- 🔄 **Live Updates** - Automatically refreshes when new conversations are added
- 🎨 **Clean UI** - Modern, responsive interface with dark theme
- 🚀 **Source Switching** - Toggle between CLI and IDE conversations when both are available

## 🚀 Quick Start

```bash
# Run directly with npx (no install needed)
npx kiro-history
```

That's it! The tool will auto-detect your Kiro data and open a browser window.

## 📦 Installation

```bash
# Install globally for repeated use
npm install -g kiro-history

# Then run anytime
kiro-history
```

## 🎯 Usage

### Basic Usage

```bash
# Auto-detect and open browser
kiro-history

# Use a specific port
kiro-history -p 3000

# Don't open browser automatically
kiro-history --no-open
```

### Source Selection

```bash
# Explicitly use Kiro IDE conversations
kiro-history --source ide

# Explicitly use Kiro CLI conversations
kiro-history --source cli

# Auto-detect (default - prefers CLI if both exist)
kiro-history --source auto
```

### Custom Paths

```bash
# Use a custom database path (CLI mode)
kiro-history ~/path/to/data.sqlite3

# Use a custom sessions directory (IDE mode)
kiro-history --source ide ~/path/to/kiro.kiroagent
```

## 📋 Options

| Option | Description | Default |
|--------|-------------|---------|
| `path` | Custom path to database file (CLI) or sessions directory (IDE) | Auto-detected |
| `-s, --source <type>` | Source type: `cli`, `ide`, or `auto` | `auto` |
| `-p, --port <number>` | Port to run the server on | Random available port |
| `--no-open` | Don't open browser automatically | Opens browser |
| `-V, --version` | Show version number | - |
| `-h, --help` | Show help | - |

## 🔧 How It Works

**Kiro CLI** saves conversations to a local SQLite database, while **Kiro IDE** stores them as JSON files in its global storage directory. This tool reads from either source and displays your chat history in a clean, browsable format.

### Default Paths

**macOS:**
- CLI: `~/Library/Application Support/kiro-cli/data.sqlite3`
- IDE: `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent`

**Linux:**
- CLI: `~/.local/share/kiro-cli/data.sqlite3`
- IDE: `~/.config/Kiro/User/globalStorage/kiro.kiroagent`

**Windows:**
- CLI: `%USERPROFILE%\.local\share\kiro-cli\data.sqlite3`
- IDE: `%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent`

### Source Detection

When using `--source auto` (the default):
1. Checks for both CLI and IDE data sources
2. If both exist, defaults to **CLI**
3. If only one exists, uses that source
4. Shows a switch button in the UI when both sources are available

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT © [Ajaykumar Prathap](https://github.com/pajaydev)

## 🔗 Links

- [GitHub Repository](https://github.com/pajaydev/kiro-history)
- [npm Package](https://www.npmjs.com/package/kiro-history)
- [Report Issues](https://github.com/pajaydev/kiro-history/issues)
