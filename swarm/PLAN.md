# Artie - AI-Powered Code Preview & Editor

## Overview

Artie is a web application that allows non-technical users to preview and modify web applications using natural language. Users connect their GitHub repositories, see live previews powered by WebContainers, and make changes by chatting with an AI assistant.

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
| Browser Runtime | WebContainers API |
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

- Owner can invite members by email
- Members receive invite, create account, join team
- Owner can remove members
- Owner can transfer ownership (stretch goal)

### 3. Repository Connection

- OAuth flow to connect owner's GitHub account
- List available repositories
- Owner selects which repos to connect
- Store repo metadata and access tokens securely
- Per-repo configuration:
  - Push strategy (direct to main vs PR)
  - Default branch override (optional)

### 4. Live Preview (WebContainers)

- Load repository files into WebContainer filesystem
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
- Changes are applied to WebContainer for instant preview
- User can approve or reject changes
- Approved changes are committed to GitHub

### 6. GitHub Sync

- Pull latest code from GitHub on session start
- On approved changes:
  - **Direct mode**: Commit to default branch
  - **PR mode**: Create branch, commit, open PR with AI-generated description
- Handle merge conflicts gracefully (notify user, offer to pull latest)

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
}

// team memberships
teamMembers: {
  teamId: Id<"teams">,
  userId: Id<"users">,
  role: "owner" | "member",
  invitedAt: number,
  joinedAt?: number,
}

// pending invites
invites: {
  teamId: Id<"teams">,
  email: string,
  invitedBy: Id<"users">,
  createdAt: number,
  expiresAt: number,
}

// connected repositories
repos: {
  teamId: Id<"teams">,
  githubOwner: string,
  githubRepo: string,
  githubUrl: string,
  defaultBranch: string,
  pushStrategy: "direct" | "pr",
  connectedBy: Id<"users">,
  connectedAt: number,
}

// chat sessions (for history/context)
sessions: {
  repoId: Id<"repos">,
  userId: Id<"users">,
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
│   │   └── settings/
│   │       └── page.tsx      # Account settings
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
│   │   ├── PreviewPanel.tsx  # WebContainer preview
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
│       └── llm.ts            # LLM API actions
├── lib/
│   ├── webcontainer.ts       # WebContainer utilities
│   ├── github.ts             # GitHub helpers
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
│    (resizable)     │          (WebContainer)                │
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
3. **Team Page**: Member list, invite form, pending invites
4. **Repo Settings**: Push strategy, disconnect repo
5. **Workspace**: Main chat + preview interface

### Design Principles

- Clean, minimal interface suitable for non-technical users
- Clear status indicators (loading, building, error states)
- Friendly error messages (no stack traces shown to users)
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
- [ ] Team creation and member invites
- [ ] Repo settings (push strategy)
- [ ] Dashboard with connected repos

### Phase 3: WebContainers Integration

- [ ] WebContainer initialization
- [ ] File system loading from GitHub
- [ ] Dev server detection and startup
- [ ] Preview iframe with proper headers
- [ ] Build status and error display

### Phase 4: AI Chat Interface

- [ ] Chat UI components
- [ ] Vercel AI SDK integration
- [ ] LLM context preparation (file tree, relevant code)
- [ ] Streaming responses
- [ ] Change detection and preview

### Phase 5: GitHub Sync

- [ ] Apply changes to WebContainer filesystem
- [ ] Commit changes to GitHub (direct mode)
- [ ] Branch creation and PR flow
- [ ] Change approval workflow
- [ ] Conflict detection

### Phase 6: Polish & Launch

- [ ] Error handling and edge cases
- [ ] Loading states and animations
- [ ] User feedback and notifications
- [ ] Performance optimization
- [ ] Documentation

---

## Technical Considerations

### WebContainers Requirements

WebContainers requires specific HTTP headers for SharedArrayBuffer:

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
```

### GitHub Token Security

- Store GitHub access tokens encrypted in Convex
- Tokens should only be accessible via server-side actions
- Consider using GitHub Apps for better rate limits (future enhancement)

### LLM Context Management

- Don't send entire codebase to LLM
- Send file tree + currently relevant files
- Track which files the AI has "seen" in the session
- Summarize large files or use chunking strategies

### Rate Limiting

- Implement rate limiting on LLM calls per user
- Cache GitHub API responses where appropriate
- Consider WebContainer reuse across sessions

---

## Environment Variables

```bash
# Convex
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=

# GitHub OAuth (for owner repo connection)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# LLM
ANTHROPIC_API_KEY=

# Optional
NEXT_PUBLIC_APP_URL=
```

---

## Success Metrics

- User can sign up and connect a GitHub repo in under 2 minutes
- Preview loads within 30 seconds for typical projects
- AI can successfully make simple changes (text, styling) 90%+ of the time
- Non-technical users can use the interface without documentation

---

## Future Enhancements

- Multiple LLM provider support (OpenAI, Google, etc.)
- Project templates for quick starts
- Version history / rollback
- Collaborative editing (multiple users same session)
- Custom domain previews
- Deployment integration (Vercel, Netlify)
