# MCP Server Installation Guide for Claude Code

This guide provides step-by-step instructions for installing and configuring Model Context Protocol (MCP) servers with Claude Code.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Commands](#installation-commands)
- [Installed MCP Servers](#installed-mcp-servers)
- [Verification](#verification)
- [Usage Tips](#usage-tips)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before installing MCP servers, ensure you have:

- **Claude Code CLI** installed (`claude --version` to verify)
- **Node.js and npm** (for npx-based servers)
- **Python and uvx** (for Serena, if using)
- **Internet connection** for downloading packages

## Installation Commands

### Basic Syntax

```bash
claude mcp add <server-name> -- <command> <args>
```

The `--` separator is required before the command and arguments.

## Installed MCP Servers

### 1. Sequential Thinking

**Purpose**: Dynamic problem-solving through structured thinking processes. Enables breaking down complex problems into manageable steps with the ability to revise and refine thoughts.

**Installation**:
```bash
claude mcp add sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking
```

**Features**:
- Break complex problems into steps
- Revise and refine thoughts dynamically
- Branch into alternative reasoning paths
- Generate and verify solution hypotheses
- Maintain context over multiple steps

**Use Cases**:
- Multi-step problem solving
- Complex algorithm design
- System architecture planning
- Debugging complex issues

**Source**: [@modelcontextprotocol/server-sequential-thinking](https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking)

---

### 2. Context7

**Purpose**: Fetches version-specific, up-to-date documentation and code examples from libraries directly into your AI context.

**Installation**:
```bash
claude mcp add context7 -- npx -y @upstash/context7-mcp
```

**Features**:
- Version-aware documentation retrieval
- Official library code examples
- Real-time documentation updates
- Prevents hallucinated or outdated info
- Universal compatibility with MCP clients

**Use Cases**:
- Learning new libraries
- Finding correct API usage
- Getting version-specific examples
- Staying current with library changes

**Source**: [@upstash/context7-mcp](https://www.npmjs.com/package/@upstash/context7-mcp)

---

### 3. Auggie MCP

**Purpose**: Augment's context engine for codebase retrieval and semantic code search.

**Installation**:
```bash
npm install -g @augmentcode/auggie
# Auggie requires authentication - configure session credentials in ~/.augment/session.json
```

**Features**:
- Semantic codebase search
- Real-time index maintenance
- Natural language queries
- Cross-language retrieval
- Highest-quality code snippet recall
- Automatically detects and indexes current project

**Use Cases**:
- Finding functions/classes by description
- Understanding codebase architecture
- Locating implementation patterns
- Code navigation and exploration

**Source**: [Augment](https://www.augmentcode.com/)

---

### 4. GitHub MCP ✓ Authenticated

**Purpose**: Interact with GitHub repositories, issues, pull requests, and workflows directly from Claude Code.

**Installation** (with authentication):
```bash
# Create a GitHub Personal Access Token first:
# 1. Go to https://github.com/settings/tokens
# 2. Generate new token (classic) with scopes: repo, read:org, workflow
# 3. Copy the token

# Install with authentication:
claude mcp add --scope user github --env GITHUB_PERSONAL_ACCESS_TOKEN=your_token_here -- npx -y @modelcontextprotocol/server-github
```

**Current Status**: ✓ Authenticated and connected to GitHub account

**Features**:
- Create and manage issues
- Create and manage pull requests
- Search repositories and code
- Manage GitHub Actions workflows
- Access repository information
- Works with any repository you have access to

**Use Cases**:
- Creating issues from code analysis
- Managing pull requests
- Searching across GitHub repositories
- Automating GitHub workflows
- Repository management and collaboration

**Authentication**:
- Configured with GitHub Personal Access Token
- Token stored securely in `/root/.claude.json` (not committed to version control)
- To update token: Remove and re-add with new token

**Source**: [@modelcontextprotocol/server-github](https://github.com/modelcontextprotocol/servers/tree/main/src/github)

---

### 5. Serena (Optional)

**Purpose**: Professional coding agent with semantic coding tools and symbol-based editing.

**Installation**:
```bash
# Install uvx first (if not installed)
pip install uv

# Add Serena (with dashboard disabled to prevent browser opening)
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project %cd% --enable-web-dashboard false
```

> **Note**: By default, Serena opens a web dashboard at `http://127.0.0.1:24288/dashboard/index.html` for logs and server status. The `--enable-web-dashboard false` flag disables this to prevent the browser from opening on every startup.

**Features**:
- Symbol-based code editing
- Semantic code understanding
- Relationship mapping between symbols
- Token-efficient code exploration
- Memory system for project context

**Use Cases**:
- Large-scale refactoring
- Symbol renaming across codebase
- Understanding code relationships
- Precise code modifications

**Source**: [Serena on GitHub](https://github.com/oraios/serena)

---

## Verification

After installing MCP servers, verify they are connected:

```bash
claude mcp list
```

Expected output:
```
Checking MCP server health...

sequential-thinking: npx -y @modelcontextprotocol/server-sequential-thinking - ✓ Connected
context7: npx -y @upstash/context7-mcp - ✓ Connected
auggie: auggie --mcp - ✓ Connected
github: npx -y @modelcontextprotocol/server-github - ✓ Connected
```

All servers should show **✓ Connected**.

**Note**: Serena is installed per-project, not globally, so it won't appear in the global list.

## Usage Tips

### 1. Sequential Thinking

Use for complex, multi-step problems:

```
User: "Help me design a scalable authentication system"
Claude will use sequential-thinking to break down the problem step by step
```

### 2. Context7

Reference it when asking about libraries:

```
User: "Show me how to use React hooks with Context7 documentation"
Claude will fetch up-to-date React documentation
```

### 3. Auggie MCP

Best for semantic codebase searches:

```
User: "Where is the authentication logic?"
Claude will use auggie to search semantically across your codebase
```

### 4. GitHub MCP

Interact with GitHub directly:

```
User: "Create an issue for the bug we just found"
Claude will use GitHub MCP to create an issue in your repository
```

### 5. Serena

Use for precise symbol-level operations:

```
User: "Rename the class UserManager to AccountManager across the project"
Claude will use serena's symbolic tools for precise refactoring
```

## Troubleshooting

### Serena Opens Browser on Startup

**Problem**: Serena opens `http://127.0.0.1:24288/dashboard/index.html` in your browser every time Claude Code starts.

**Solution**: Add the `--enable-web-dashboard false` flag to disable the dashboard:
```bash
claude mcp remove serena
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project %cd% --enable-web-dashboard false
```

### Connection Issues

If a server shows as not connected:

1. **Check prerequisites** are installed (Node.js, npm, Python)
2. **Restart Claude Code** or your IDE
3. **Reinstall the server**:
   ```bash
   claude mcp remove <server-name>
   claude mcp add <server-name> -- <command>
   ```

### NPX Package Not Found

If npx can't find a package:

```bash
# Clear npm cache
npm cache clean --force

# Try installing globally first
npm install -g @modelcontextprotocol/server-sequential-thinking
npm install -g @upstash/context7-mcp
```

### Windows Path Issues

If using Windows, ensure paths in your config use proper format:

- Use forward slashes `/` or escaped backslashes `\\`
- Environment variables like `%cd%` may need adjustment

### Configuration File Location

MCP servers are configured in:

- **Local**: `~/.claude.json` or `C:\Users\<username>\.claude.json`
- **Project**: `.claude/config.json` (if using project scope)

You can manually edit these files if needed.

## Managing MCP Servers

### List all servers
```bash
claude mcp list
```

### Remove a server
```bash
claude mcp remove <server-name>
```

### Update a server
```bash
claude mcp remove <server-name>
claude mcp add <server-name> -- <new-command>
```

## Additional Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [Claude Code MCP Guide](https://code.claude.com/docs/mcp)
- [Awesome MCP Servers](https://mcpservers.org/)
- [MCP GitHub Repository](https://github.com/modelcontextprotocol)

## Environment-Specific Notes

### Setting Environment Variables

Some MCP servers require API keys or environment variables:

```bash
claude mcp add <server-name> --env API_KEY=your_key_here -- <command>
```

### Using HTTP/SSE Transport

For remote MCP servers:

```bash
# HTTP transport
claude mcp add --transport http <server-name> <url>

# SSE transport
claude mcp add --transport sse <server-name> <url>
```

### Scopes

Control where the server is available:

```bash
# Local scope (default) - current project
claude mcp add <server-name> -- <command>

# User scope - all your projects
claude mcp add --scope user <server-name> -- <command>

# Project scope - committed to version control
claude mcp add --scope project <server-name> -- <command>
```

---

## Quick Reference Card

| Server | Command | Primary Use | Scope |
|--------|---------|-------------|-------|
| sequential-thinking | `npx -y @modelcontextprotocol/server-sequential-thinking` | Complex problem-solving | Global |
| context7 | `npx -y @upstash/context7-mcp` | Library documentation | Global |
| auggie | `auggie --mcp` (requires `npm i -g @augmentcode/auggie`) | Codebase search | Global |
| github | `npx -y @modelcontextprotocol/server-github` | GitHub integration | Global |
| serena | `uvx --from git+... --enable-web-dashboard false` | Symbol-level editing | Per-project |

---

**Last Updated**: December 2025

**Note**: This guide is based on the installation at `d:\AI\AI_GIRL\NODEJS`. Adjust paths and commands as needed for your environment.
