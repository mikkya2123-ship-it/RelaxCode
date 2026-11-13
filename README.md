<div align="center">

<img src="docs/cover.svg" alt="RelaxCode — an open-source AI IDE for Windows" width="100%" />

# RelaxCode

**An open-source Windows IDE where your AI can inspect a project, edit code, run a real terminal, search the web and use MCP apps.**

[![Latest release](https://img.shields.io/github/v/release/mikkya2123-ship-it/RelaxCode?style=flat-square&color=6ee7b7)](https://github.com/mikkya2123-ship-it/RelaxCode/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/mikkya2123-ship-it/RelaxCode/total?style=flat-square&color=60a5fa)](https://github.com/mikkya2123-ship-it/RelaxCode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-8b5cf6?style=flat-square)](LICENSE)

**[Download for Windows](https://github.com/mikkya2123-ship-it/RelaxCode/releases/latest)** · [Русский](README.ru.md) · [Feature tour](docs/FEATURES.md) · [Roadmap](ROADMAP.md)

</div>

## One workspace, not another chat tab

RelaxCode combines a Monaco editor, project explorer, terminal and an agent that can actually use them. Bring your own provider and model, keep control over risky actions, and connect creative tools through MCP.

![RelaxCode 0.3.0 home screen](screenshots/relaxcode-home-0.3.0.png)

| What makes it useful | What it means in practice |
| :--- | :--- |
| **Chat, Agent and Plan modes** | Ask a question, let the agent change the project, or review a plan before it acts. |
| **Bring your own AI** | Choose from a generated provider catalog or add any OpenAI-compatible endpoint. |
| **Real project tools** | Read and edit files, search code, run shell commands, manage dev servers and inspect Git changes. |
| **MCP app connections** | Work with Blender and supported ArtCraft apps from the same agent loop. |
| **Human-in-the-loop controls** | Approvals, pause, stop, queued instructions, risk levels and hard limits for unattended runs. |
| **Visual answers** | Render images and interactive SVG diagrams directly inside a conversation. |

## Get started

1. Download `RelaxCode-Setup-0.3.0.exe` from the [latest release](https://github.com/mikkya2123-ship-it/RelaxCode/releases/latest).
2. Install and launch RelaxCode on Windows 10 or 11 (x64).
3. Open **Settings → Connections**, choose a provider and enter your API key.
4. Open a project folder and give the agent a concrete task.

> [!NOTE]
> RelaxCode is currently unsigned, so Windows SmartScreen may show a warning. Verify that the installer comes from this repository's Releases page. API usage and pricing are determined by the provider you choose.

## Your models, your keys

- A catalog built from [models.dev](https://models.dev) covers thousands of models across more than 200 providers.
- OpenAI, Anthropic, Google, OpenRouter, DeepSeek, xAI, Groq, Mistral and custom OpenAI-compatible APIs are supported.
- API keys are encrypted locally and are not included in exported connection profiles.
- Prompts and selected project context are sent to the provider you configure. RelaxCode does not operate a proxy service.

## Built for controlled agent work

RelaxCode classifies tools by risk (`read`, `write`, `exec`, `delete`) and lets you choose between manual approval and safer automation. Destructive commands require confirmation; catastrophic operations are rejected. A detailed exchange log, project-scoped backups and MCP trust prompts make agent behavior easier to inspect.

See the [complete feature tour](docs/FEATURES.md) for editor, terminal, MCP, visuals, model reliability, updater and installer details.

## Develop locally

Requirements: Windows, Node.js 24 and npm.

```powershell
git clone https://github.com/mikkya2123-ship-it/RelaxCode.git
cd RelaxCode
npm ci
npm run dev
```

| Command | Purpose |
| :--- | :--- |
| `npm run typecheck` | Check the Electron and renderer TypeScript projects |
| `npm test` | Run the self-contained Node test suites |
| `npm run build` | Build the app into `out/` |
| `npm run dist` | Build the Windows installer into `dist/` |

```text
src/main/       Agent loop, tools, MCP, terminal, processes and storage
src/preload/    Typed bridge between Electron and the renderer
src/renderer/   React UI, Monaco editor and application state
src/shared/     Shared types, settings and the built-in skill library
scripts/        Tests, release helpers and asset generators
```

## Project and community

- Read the [roadmap](ROADMAP.md) or start a conversation in [GitHub Discussions](https://github.com/mikkya2123-ship-it/RelaxCode/discussions).
- Found a bug? Use the [bug report form](https://github.com/mikkya2123-ship-it/RelaxCode/issues/new?template=bug_report.yml).
- Want to contribute? Start with [CONTRIBUTING.md](CONTRIBUTING.md).
- For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Release history is recorded in [CHANGELOG.md](CHANGELOG.md).

RelaxCode is available under the [MIT License](LICENSE).
