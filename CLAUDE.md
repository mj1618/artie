
# local dev user

Use this to sign in as an owner with some projects setup for testing:

user: matthew.stephen.james@gmail.com
pass: xt4yArXEXhDjng8R9T7QTpjL8j&@



# use @/ for paths

Use @/ for long ../ style paths

# React 19

We're on React 19 which has automatic memoization for `useMemo` and `useCallback`.

# Commands

Use `npx convex dev --once` for convex codegen.
Don't rm the \_generated directory before building.
Don't disable typecheck.

Use `npx tsc --noEmit` to run a typecheck of the Next.js app.
Fix any typescript errors including ones that weren't yours.

Use `npm run dev` - which will build properly for production and start a `node server.js` process. Note this does NOT watch files, you'll need to kill and restart in order to see any changes.

# Types

Use "any" sparingly.
Definitely don't use "any" to call convex backend functions.

# Convex db.get, db.patch, and db.delete

These methods now take two arguments: the table name and the document ID.

```typescript
// Get a document
const venue = await ctx.db.get("venues", venueId);

// Patch a document
await ctx.db.patch("customers", customerId, { archived: true });

// Delete a document
await ctx.db.delete("venueUsers", venueUserId);
```

# Convex Indexes and \_creationTime

All Convex indexes implicitly include `_creationTime` at the end. This means after using equality conditions (`.eq()`) on all the explicit index fields, you can use range queries (`.gte()`, `.lte()`, `.gt()`, `.lt()`) on `_creationTime`.

Example with an index defined as `["supplierId", "orderStatus"]`:

```typescript
// This is VALID - _creationTime range after all eq() conditions
ctx.db
  .query("orders")
  .withIndex("supplierIdAndOrderStatus", (q) =>
    q
      .eq("supplierId", args.supplierId)
      .eq("orderStatus", "active")
      .gte("_creationTime", dayStart)
      .lte("_creationTime", dayEnd),
  );
```

# Server rendered component with convex

Here's how you do server rendered component with convex:

```
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { revalidatePath } from "next/cache";

export default async function PureServerPage() {
  const tasks = await fetchQuery(api.tasks.list, { list: "default" });
  async function createTask(formData: FormData) {
    "use server";

    await fetchMutation(
      api.tasks.create,
      {
        text: formData.get("text") as string,
      },
      { token: await convexAuthNextjsToken() },
    );
    revalidatePath("/example");
  }
  // render tasks and task creation form
  return <form action={createTask}>...</form>;
}
```

# Convex performance

When doing a number of "awaits" - prefer using Promise.all rather than a for loop so that things run in parallel.

# Browser Testing

Use the `playwright-cli --help` to see how to use playwright-cli to do manual-click browser testing.
