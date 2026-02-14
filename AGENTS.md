
# use @/ for paths

Use @/ for long ../ style paths

# React 19

We're on React 19 which has automatic memoization for `useMemo` and `useCallback`.

# Commands

Use `npm -s convex codegen` for convex codegen.
Don't rm the \_generated directory before building.
Don't disable typecheck.

Use `npm -s tsc -p tsconfig.json --noEmit` to find frontend ts build errors.

Use `npm run dev` to run nextjs (you may need to kill it if unresponsive).

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