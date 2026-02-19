# Composure

A Next.js application with Tailwind CSS and Convex backend.

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS 4** - Utility-first CSS
- **Convex** - Real-time backend

## Getting Started

### 1. Set up Convex

First, you need to set up your Convex project:

```bash
npx convex dev
```

This will:
- Prompt you to log in to Convex (create an account if needed)
- Create a new Convex project
- Generate the `convex/_generated` folder with type definitions
- Add your deployment URL to `.env.local`

### 2. Run the development server

Once Convex is configured, you can run both Next.js and Convex together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:next    # Next.js only
npm run dev:convex  # Convex only
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Project Structure

```
├── convex/               # Convex backend
│   ├── _generated/       # Auto-generated types (after running convex dev)
│   ├── schema.ts         # Database schema
│   └── tasks.ts          # Example queries and mutations
├── src/
│   ├── app/              # Next.js App Router pages
│   └── components/       # React components
│       └── ConvexClientProvider.tsx
└── .env.local            # Environment variables (Convex URL)
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Convex Documentation](https://docs.convex.dev)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
