/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as bashCommands from "../bashCommands.js";
import type * as crons from "../crons.js";
import type * as deployKeys from "../deployKeys.js";
import type * as dockerContainers from "../dockerContainers.js";
import type * as dockerFiles from "../dockerFiles.js";
import type * as dockerPool from "../dockerPool.js";
import type * as dockerScheduler from "../dockerScheduler.js";
import type * as dropletFiles from "../dropletFiles.js";
import type * as dropletScheduler from "../dropletScheduler.js";
import type * as droplets from "../droplets.js";
import type * as fileChanges from "../fileChanges.js";
import type * as firecrackerFiles from "../firecrackerFiles.js";
import type * as firecrackerPool from "../firecrackerPool.js";
import type * as firecrackerScheduler from "../firecrackerScheduler.js";
import type * as firecrackerVms from "../firecrackerVms.js";
import type * as flyioSprites from "../flyioSprites.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as messages from "../messages.js";
import type * as projects from "../projects.js";
import type * as sessions from "../sessions.js";
import type * as spriteFiles from "../spriteFiles.js";
import type * as teams from "../teams.js";
import type * as templateActions from "../templateActions.js";
import type * as templates from "../templates.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  auth: typeof auth;
  bashCommands: typeof bashCommands;
  crons: typeof crons;
  deployKeys: typeof deployKeys;
  dockerContainers: typeof dockerContainers;
  dockerFiles: typeof dockerFiles;
  dockerPool: typeof dockerPool;
  dockerScheduler: typeof dockerScheduler;
  dropletFiles: typeof dropletFiles;
  dropletScheduler: typeof dropletScheduler;
  droplets: typeof droplets;
  fileChanges: typeof fileChanges;
  firecrackerFiles: typeof firecrackerFiles;
  firecrackerPool: typeof firecrackerPool;
  firecrackerScheduler: typeof firecrackerScheduler;
  firecrackerVms: typeof firecrackerVms;
  flyioSprites: typeof flyioSprites;
  github: typeof github;
  http: typeof http;
  messages: typeof messages;
  projects: typeof projects;
  sessions: typeof sessions;
  spriteFiles: typeof spriteFiles;
  teams: typeof teams;
  templateActions: typeof templateActions;
  templates: typeof templates;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
