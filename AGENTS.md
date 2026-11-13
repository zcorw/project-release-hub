# AGENTS.md

Read README.md and docs/project-overview.md first. This repository now contains a local single-user MVP; docs/stage-*.md record discovery decisions and docs/development-log.md records implementation verification.

Keep confirmed requirements separate from proposals, delegated implementation defaults, and implemented capabilities. Follow the staged project discovery workflow for new architectural decisions and record decisions before generating implementation files. Consult relevant local skills when available. The current stack and MCP boundary are documented. Native account/OAuth implementation and source push were later authorized; actual remote deployment/ChatGPT connection still require separate authorization. See docs/account-oauth.md.

Read docs/project-conventions.md and TODO.md before changes. Preserve shared validation. The user superseded MCP edit/delete confirmation with direct authorized writes; retain web-only confirmation for manual web proposals, reconciliation and undo. See docs/mcp-direct-writes-plan.md. Recheck tests and affected browser flows after changes.

Do not publish, deploy, create a remote repository, push changes, commit, or configure persistent external access unless the user's current request authorizes that action. Never store secrets in source or documentation.
