# Contributing to RelaxCode

Thanks for helping improve RelaxCode. Small, focused pull requests are the easiest to review.

## Before you start

- Search existing issues and discussions first.
- Use a discussion for an early idea and an issue for a reproducible bug or agreed task.
- Never include API keys, chat logs, private project files or generated files from `dist/` and `out/`.

## Local setup

RelaxCode currently targets Windows. Install Node.js 24 and npm, then run:

```powershell
git clone https://github.com/mikkya2123-ship-it/RelaxCode.git
cd RelaxCode
npm ci
npm run dev
```

Before opening a pull request:

```powershell
npm run typecheck
npm test
npm run build
```

## Pull requests

1. Create a branch with a clear name, such as `fix/terminal-encoding` or `feat/provider-filter`.
2. Keep the change scoped to one problem.
3. Add or update a self-contained test when behavior changes.
4. Update English and Russian UI strings together when touching localized text.
5. Explain the user-visible result, verification steps and any screenshots in the pull request.

Commit messages should be short and action-oriented. The repository commonly uses prefixes such as `feat:`, `fix:`, `docs:`, `test:` and `chore:`.

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE) and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
