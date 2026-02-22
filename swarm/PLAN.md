# Artie - AI-Powered Code Preview & Editor

## Overview

Artie is a web application that allows non-technical users to preview and modify web applications using natural language. Users connect their GitHub repositories, see live previews powered by Docker containers, and make changes by chatting with an AI assistant.

## User Model

### Roles

- **Owner**: Creates an account, connects GitHub repos, invites team members, configures settings
- **Member**: Invited by owner, can use the AI chat to preview and modify connected repos

### Permissions Flow

1. Owner signs up with username/password
2. Owner connects their GitHub account (OAuth) to enable repo access
3. Owner selects which repos to connect to Artie
4. Owner invites members via invite link
5. Owner configures per-repo settings:
   - **Push to main**: Changes commit directly to the default branch
   - **Create PR**: Changes go to a new branch with a pull request
   - **Runtime**: Docker containers (server)
6. Owner can review open PRs within Artie:
   - View PRs in live preview mode
   - Review changes with diff + preview side-by-side
   - Approve and merge PRs directly from the app

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router) |
| Styling | Tailwind CSS |
| Database & Backend | Convex |
| Authentication | Convex Auth (username/password) |
| GitHub Integration | Octokit (via Convex actions) |
| LLM | Vercel AI SDK + Anthropic Claude |
| Runtime (per-project) | Docker containers |
| Hosting | Vercel (frontend) + Convex (backend) |

---

## Core Features

### 1. Authentication & Onboarding

- Username/password signup and login via Convex Auth
- Owner onboarding flow:
  1. Create account
  2. Connect GitHub (OAuth to get access token)
  3. Select repositories to enable
  4. Configure push strategy per repo

### 2. Team Management

- Owner generates invite links to share with potential members
- Members use the invite link to create an account and join the team
- Owner can remove members
- Owner can transfer ownership (stretch goal)

### 3. Repository Connection

- OAuth flow to connect owner's GitHub account
- List available repositories
- Owner selects which repos to connect
- Store repo metadata and access tokens securely
- Per-repo configuration:
  - Push strategy (direct to main vs PR)
  - Runtime environment (Docker containers)
  - Default branch override (optional)

### 4. Live Preview (Docker Containers)

- Clone repository into Docker container
- Detect project type and run appropriate dev server:
  - `npm install` + `npm run dev` for Node.js projects
  - Support for Vite, Next.js, Create React App, etc.
- Display preview in iframe
- Auto-refresh on file changes
- Show build/runtime errors in a friendly way

### 5. AI Chat Interface

- Chat panel on left side of screen
- User describes changes in natural language
- AI analyzes current code and generates modifications
- Changes are applied to the container for instant preview
- User can approve or reject changes
- Approved changes are committed to GitHub

#### Conversation Management

Conversations are tied to features/branches to enable iterative development:

- **Feature-based conversations**: Each conversation is associated with a specific feature branch
- **Start new conversation**: Users can start a new conversation for a new feature, which creates a new branch
- **Resume work**: When starting a new conversation on an existing feature/branch, work continues where it left off
- **Branch context**: The conversation history and file state persist with the branch
- **Multiple conversations per feature**: Users can have multiple chat sessions for the same feature branch, maintaining context across sessions

### 6. GitHub Sync

- Pull latest code from GitHub on session start
- On approved changes:
  - **Direct mode**: Commit to default branch
  - **PR mode**: Create branch, commit, open PR with AI-generated description
- Handle merge conflicts gracefully (notify user, offer to pull latest)

### 7. PR Review & Approval (Owner)

- Owner can view all open PRs for connected repos within Artie
- PRs are loaded in preview mode so owners can see the changes live
- Owner can review the PR diff alongside the live preview
- Owner can approve and merge PRs directly from within the application
- Supports merge, squash merge, and rebase merge strategies
- After merge, option to delete the source branch

### 8. Custom LLM Provider

Owners can configure their own LLM API keys instead of using the platform's default:

- **Supported Providers**:
  - **OpenAI** (ChatGPT / GPT-4)
  - **Anthropic** (Claude)
  - **Google** (Gemini)
- Owner enters API key in team settings
- Keys are encrypted and stored securely (never exposed to frontend)
- Per-team configuration allows different teams to use different providers
- Fallback to platform default if no custom key configured
- Usage tracking per team for billing/monitoring purposes

### 9. Convex Backend Support

When a connected repository uses Convex, Artie runs a local Convex instance inside the Docker container:

- **Auto-detection**: Check for `convex/` directory or `convex.json` in repo
- **Local Dev Instance**: Spin up `npx convex dev` within the container
- **Full-stack Preview**: Frontend connects to local Convex backend
- **Schema & Functions**: AI can modify Convex schema, queries, mutations, and actions
- **Data Seeding**: Option to seed test data for previews
- Enables non-technical users to build and modify full-stack applications

### 10. External Convex Application Connection

Users can connect an existing Convex application to their project.

- **Connection Flow**:
  1. User selects "Connect Convex Application" for their project
  2. User provides their Convex project URL or deployment name
  3. Artie configures the Docker container with the Convex backend connection

### 11. Create Application from Template

Users can create a new application directly within Artie from pre-built templates, without needing to connect external repositories.

#### Available Templates

| Template | Description | Runtime |
|----------|-------------|---------|
| **Next.js + Convex** | Full-stack web app with Convex backend | Docker |

*More templates may be added in the future.*

#### Template Creation Flow

1. **User initiates template creation**:
   - User clicks "Create from Template" in the dashboard
   - Selects "Next.js + Convex" template
   - Enters a project name (used as Convex slug and project identifier)

2. **Convex project provisioning** (using `CONVEX_ACCESS_TOKEN`):
   - Artie checks if the slug is available via Convex API
   - If available, creates a new Convex project with that slug
   - Generates a Convex deploy key for the new project

3. **Docker container setup**:
   - A Docker container is provisioned for the new project
   - Convex deploy key is injected as an environment variable

4. **Project initialization**:
   - Template files are loaded into the Docker container
   - `npm install` runs to install dependencies
   - Convex schema and functions are deployed to the new Convex project
   - Project is ready for AI-assisted development

#### Environment Variables

The template system uses `CONVEX_ACCESS_TOKEN` (platform-level) to:
- Query Convex API to check slug availability
- Create new Convex projects programmatically
- Generate deploy keys for created projects

---

## Data Model (Convex Schema)

```typescript
// users - managed by Convex Auth
// Additional user profile data:
userProfiles: {
  userId: Id<"users">,
  displayName: string,
  githubAccessToken?: string,  // encrypted
  githubUsername?: string,
  createdAt: number,
}

// teams (workspaces)
teams: {
  name: string,
  ownerId: Id<"users">,
  createdAt: number,
  // Custom LLM configuration (optional)
  llmProvider?: "openai" | "anthropic" | "google",
  llmApiKey?: string,  // encrypted
  llmModel?: string,   // e.g., "gpt-4", "claude-3-opus", "gemini-pro"
}

// team memberships
teamMembers: {
  teamId: Id<"teams">,
  userId: Id<"users">,
  role: "owner" | "member",
  invitedAt: number,
  joinedAt?: number,
}

// invite links
inviteLinks: {
  teamId: Id<"teams">,
  code: string,           // unique invite code for URL
  createdBy: Id<"users">,
  createdAt: number,
  expiresAt?: number,     // optional expiration
  maxUses?: number,       // optional usage limit
  useCount: number,       // how many times used
}

// connected repositories
repos: {
  teamId: Id<"teams">,
  githubOwner: string,
  githubRepo: string,
  githubUrl: string,
  defaultBranch: string,
  pushStrategy: "direct" | "pr",
  // Runtime
  runtime: "docker",
  connectedBy: Id<"users">,
  connectedAt: number,
  // Auto-detected features
  hasConvex?: boolean,      // true if convex/ directory detected
  projectType?: string,     // "next", "vite", "cra", etc.
  // External Convex connection
  externalConvexUrl?: string,     // Connected Convex deployment URL
  externalConvexDeployment?: string, // Convex deployment name
}

// template-created projects (not connected to GitHub)
templateProjects: {
  teamId: Id<"teams">,
  name: string,                     // Project display name
  slug: string,                     // Convex project slug
  template: "nextjs-convex",        // Template used
  createdBy: Id<"users">,
  createdAt: number,
  // Convex project details
  convexProjectId: string,          // Convex project identifier
  convexDeploymentUrl: string,      // Convex deployment URL
  convexDeployKey: string,          // Encrypted deploy key for Convex
  // Status
  status: "provisioning" | "active" | "error",
  errorMessage?: string,
}

// chat sessions (for history/context)
// Sessions are tied to feature branches for iterative development
sessions: {
  repoId: Id<"repos">,
  userId: Id<"users">,
  // Feature/branch association
  featureName: string,            // Human-readable feature name
  branchName: string,             // Git branch name (e.g., "feature/update-hero")
  branchCreatedBySession: boolean, // Whether this session created the branch
  // Timestamps
  createdAt: number,
  lastActiveAt: number,
}

// chat messages
messages: {
  sessionId: Id<"sessions">,
  role: "user" | "assistant",
  content: string,
  timestamp: number,
  // For assistant messages that made changes:
  changes?: {
    files: string[],
    committed: boolean,
    commitSha?: string,
    prUrl?: string,
  },
}
```

---

## Application Structure

```
artie/
├── app/                      # Next.js 15 App Router
│   ├── layout.tsx            # Root layout with providers
│   ├── page.tsx              # Landing/marketing page
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx        # Dashboard layout with sidebar
│   │   ├── page.tsx          # Dashboard home (list repos)
│   │   ├── team/
│   │   │   └── page.tsx      # Team management
│   │   ├── repos/
│   │   │   └── page.tsx      # Connect/manage repos
│   │   ├── settings/
│   │   │   └── page.tsx      # Account settings
│   │   ├── llm-settings/
│   │   │   └── page.tsx      # Custom LLM provider config (owner only)
│   │   └── pull-requests/
│   │       ├── page.tsx      # List open PRs for all connected repos
│   │       └── [prId]/
│   │           └── page.tsx  # PR review with preview + diff (owner)
│   └── (workspace)/
│       └── [repoId]/
│           └── page.tsx      # Main workspace (chat + preview)
├── components/
│   ├── chat/
│   │   ├── ChatPanel.tsx     # Main chat container
│   │   ├── MessageList.tsx   # Chat message display
│   │   ├── MessageInput.tsx  # User input field
│   │   └── ChangePreview.tsx # Show pending changes
│   ├── preview/
│   │   ├── PreviewPanel.tsx  # Docker container preview
│   │   ├── PreviewFrame.tsx  # Iframe wrapper
│   │   └── StatusBar.tsx     # Build status, errors
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── SplitPane.tsx     # Resizable panels
│   └── ui/
│       ├── Button.tsx
│       ├── Input.tsx
│       ├── Card.tsx
│       └── ...               # Basic UI components
├── convex/
│   ├── schema.ts             # Database schema
│   ├── auth.ts               # Auth configuration
│   ├── users.ts              # User queries/mutations
│   ├── teams.ts              # Team management
│   ├── repos.ts              # Repository management
│   ├── sessions.ts           # Chat sessions
│   ├── messages.ts           # Chat messages
│   └── actions/
│       ├── github.ts         # GitHub API actions
│       └── llm/
│           ├── index.ts      # LLM router (selects provider)
│           ├── openai.ts     # OpenAI/ChatGPT integration
│           ├── anthropic.ts  # Anthropic/Claude integration
│           └── google.ts     # Google/Gemini integration
├── lib/
│   ├── github.ts             # GitHub helpers
│   ├── llm-providers.ts      # LLM provider abstractions
│   └── utils.ts              # General utilities
├── public/
├── tailwind.config.ts
├── next.config.ts
├── convex.json
└── package.json
```

---

## UI/UX Design

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Header: Logo | Repo Name | Settings | User Menu            │
├────────────────────┬────────────────────────────────────────┤
│                    │                                        │
│    Chat Panel      │          Preview Panel                 │
│    (resizable)     │          (Docker)                      │
│                    │                                        │
│  ┌──────────────┐  │    ┌────────────────────────────┐     │
│  │ Message List │  │    │                            │     │
│  │              │  │    │      Live Preview          │     │
│  │              │  │    │        (iframe)            │     │
│  │              │  │    │                            │     │
│  └──────────────┘  │    └────────────────────────────┘     │
│                    │                                        │
│  ┌──────────────┐  │    ┌────────────────────────────┐     │
│  │ Input Field  │  │    │ Status: Running on :3000   │     │
│  └──────────────┘  │    └────────────────────────────┘     │
│                    │                                        │
└────────────────────┴────────────────────────────────────────┘
```

### Key Screens

1. **Landing Page**: Hero, features, CTA to sign up
2. **Dashboard**: List of connected repos, quick actions
3. **Team Page**: Member list, generate/manage invite links
4. **Repo Settings**: Push strategy, runtime selection, disconnect repo
5. **Workspace**: Main chat + preview interface
6. **PR List**: Open PRs across all connected repos (owner)
7. **PR Review**: Live preview + diff viewer + approve/merge controls (owner)

### Design Principles

**UX is a major selling point of the platform.** Good user experience is critical to Artie's success and differentiation.

- Clean, minimal interface suitable for non-technical users
- **Team member experience must be extremely non-tech friendly** - members should never feel overwhelmed by technical concepts
- Clear status indicators (loading, building, error states)
- Friendly error messages (no stack traces shown to users)
- Intuitive workflows that guide users naturally
- Minimize cognitive load - hide complexity, surface only what's needed
- Mobile-responsive (though primary use is desktop)

---

## Implementation Phases

### Phase 1: Foundation

- [ ] Initialize Next.js 15 project with Tailwind
- [ ] Set up Convex with schema
- [ ] Implement Convex Auth (username/password)
- [ ] Create basic UI components
- [ ] Build auth pages (login, signup)
- [ ] Create dashboard layout

### Phase 2: Team & Repo Management

- [ ] GitHub OAuth flow for owners
- [ ] Repository listing and selection
- [ ] Team creation and invite link generation
- [ ] Repo settings (push strategy)
- [ ] Dashboard with connected repos

### Phase 3: Docker Runtime Integration

- [ ] Docker container provisioning
- [ ] Repository cloning from GitHub
- [ ] Project type detection (Next.js, Vite, CRA, etc.)
- [ ] Dev server detection and startup
- [ ] Preview via container port forwarding
- [ ] Build status and error display

### Phase 4: AI Chat Interface

- [ ] Chat UI components
- [ ] Vercel AI SDK integration
- [ ] Multi-provider support (OpenAI, Anthropic, Google)
- [ ] Custom API key configuration UI (owner settings)
- [ ] LLM context preparation (file tree, relevant code)
- [ ] Streaming responses
- [ ] Change detection and preview

### Phase 5: GitHub Sync & PR Review

- [ ] Apply changes to container filesystem
- [ ] Commit changes to GitHub (direct mode)
- [ ] Branch creation and PR flow
- [ ] Change approval workflow
- [ ] Conflict detection
- [ ] PR list view for owners (open PRs for connected repos)
- [ ] PR preview (load PR branch for live preview)
- [ ] PR diff viewer alongside live preview
- [ ] PR approval and merge from within app (merge/squash/rebase)
- [ ] Post-merge branch cleanup option

### Phase 6: External Convex & Templates

- [ ] External Convex connection UI
- [ ] Convex API integration for slug availability check
- [ ] Convex project creation via API (using CONVEX_ACCESS_TOKEN)
- [ ] Template selection UI in dashboard
- [ ] Next.js + Convex template implementation
- [ ] Convex deploy key generation and injection into container
- [ ] Template project provisioning workflow
- [ ] Template project management (view, delete)

### Phase 7: Polish & Launch

- [ ] Error handling and edge cases
- [ ] Loading states and animations
- [ ] User feedback and notifications
- [ ] Performance optimization
- [ ] Documentation

---

## Technical Considerations

### GitHub Token Security

- Store GitHub access tokens encrypted in Convex
- Tokens should only be accessible via server-side actions
- Consider using GitHub Apps for better rate limits (future enhancement)

### LLM Context Management

- Don't send entire codebase to LLM
- Send file tree + currently relevant files
- Track which files the AI has "seen" in the session
- Summarize large files or use chunking strategies

### Custom LLM Provider Support

Multi-provider architecture using Vercel AI SDK's unified interface:

```typescript
// lib/llm-providers.ts
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

export function getProvider(team: Team) {
  if (!team.llmProvider || !team.llmApiKey) {
    // Fall back to platform default (Anthropic)
    return anthropic("claude-sonnet-4-20250514");
  }

  switch (team.llmProvider) {
    case "openai":
      return openai(team.llmModel || "gpt-4", {
        apiKey: decrypt(team.llmApiKey),
      });
    case "anthropic":
      return anthropic(team.llmModel || "claude-sonnet-4-20250514", {
        apiKey: decrypt(team.llmApiKey),
      });
    case "google":
      return google(team.llmModel || "gemini-pro", {
        apiKey: decrypt(team.llmApiKey),
      });
  }
}
```

**Security considerations**:
- API keys are encrypted at rest using AES-256
- Keys are decrypted only server-side in Convex actions
- Key validation on save (test API call to verify key works)
- Owners can rotate/delete keys at any time

### Rate Limiting

- Implement rate limiting on LLM calls per user
- Cache GitHub API responses where appropriate

### Convex Project Creation API

Using `CONVEX_ACCESS_TOKEN` to programmatically manage Convex projects:

```typescript
// lib/convex-api.ts
const CONVEX_API_BASE = "https://api.convex.dev";

export async function checkSlugAvailable(slug: string): Promise<boolean> {
  const response = await fetch(`${CONVEX_API_BASE}/projects/${slug}`, {
    headers: {
      Authorization: `Bearer ${process.env.CONVEX_ACCESS_TOKEN}`,
    },
  });
  return response.status === 404; // 404 means available
}

export async function createConvexProject(slug: string, teamId: string) {
  const response = await fetch(`${CONVEX_API_BASE}/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CONVEX_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slug, teamId }),
  });
  return response.json();
}

export async function createDeployKey(projectId: string): Promise<string> {
  const response = await fetch(
    `${CONVEX_API_BASE}/projects/${projectId}/deploy-keys`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CONVEX_ACCESS_TOKEN}`,
      },
    }
  );
  const { deployKey } = await response.json();
  return deployKey;
}
```

---

## Environment Variables

```bash
# Convex
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=

# Convex Access Token (for template project creation)
# Used to create new Convex projects and generate deploy keys
CONVEX_ACCESS_TOKEN=

# GitHub OAuth (for owner repo connection)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Default LLM (platform fallback when no custom key)
ANTHROPIC_API_KEY=

# Encryption key for storing user API keys and deploy keys
API_KEY_ENCRYPTION_SECRET=

# Optional
NEXT_PUBLIC_APP_URL=

```

Note: Individual team LLM API keys (OpenAI, Anthropic, Google) are stored encrypted in the database, not as environment variables.

---

## Runtime

All projects run on Docker containers hosted on a DigitalOcean droplet. See `swarm/DOCKER.md` for full details.

---

## Success Metrics

- User can sign up and connect a GitHub repo in under 2 minutes
- Preview loads within 30 seconds for typical projects
- AI can successfully make simple changes (text, styling) 90%+ of the time
- Non-technical users can use the interface without documentation

---

## Future Enhancements

- Additional project templates (Vite + Convex, SvelteKit + Convex, etc.)
- Version history / rollback
- Collaborative editing (multiple users same session)
- Custom domain previews
- Deployment integration (Vercel, Netlify)
- Additional LLM providers (Mistral, Cohere, local models via Ollama)
- Convex cloud deployment from preview (promote local to production)
- Usage analytics and cost tracking for custom LLM keys
- GitHub repo creation from template projects (export template project to GitHub)

---

## Example Projects

Reference repositories demonstrating supported project types:

| Project | URL | Description |
|---------|-----|-------------|
| Next.js + Convex | [github.com/get-convex/convex-nextjs-template](https://github.com/get-convex/convex-nextjs-template) | Full-stack template with authentication |
| Vite + React | [github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) | Modern React SPA |
| Next.js Basic | [github.com/vercel/next.js/tree/canary/examples/hello-world](https://github.com/vercel/next.js/tree/canary/examples/hello-world) | Minimal Next.js setup |

## Built-in Templates

Templates available for creating new projects directly within Artie:

| Template | Base | Backend | Runtime | Description |
|----------|------|---------|---------|-------------|
| **Next.js + Convex** | [convex-nextjs-template](https://github.com/get-convex/convex-nextjs-template) | Convex | Docker | Full-stack web application with Convex backend, auth, and real-time data |
