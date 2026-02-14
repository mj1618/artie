import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Example table - you can modify or remove this
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
  }),
});
