# Task: Add Inline Form Validation to Signup Page

## Context

Phase 7 (Polish & Launch) includes "User feedback and notifications." The signup page (`src/app/(auth)/signup/page.tsx`) only validates on submit — password length and password mismatch errors appear as a single red text line after the user clicks "Sign up." Non-technical users (Artie's target audience) expect real-time feedback as they type. This is a core onboarding UX improvement.

### What exists now:
- `src/app/(auth)/signup/page.tsx` — Four fields: display name, email, password, confirm password
- Validation only fires on submit (lines 34-42): checks `password.length < 8` and `password !== confirmPassword`
- A single `{error}` paragraph shows below all fields (line 106)
- No per-field error states, no visual border changes, no real-time hints
- Login page is simpler (email + password) and doesn't need inline validation — errors there are server-side

### What's missing:
- No inline hint below the password field showing "at least 8 characters" with a check/cross icon
- No inline error below the confirm password field showing "Passwords do not match" as the user types
- No red border on invalid fields to visually indicate the error location
- The submit-level error still works for server-side errors, but client-side validation should show inline

## Requirements

### 1. Add `touched` tracking for password fields

Track which fields the user has interacted with (blurred), so validation messages only appear after the user has started filling in that field — not immediately on page load.

```tsx
const [touched, setTouched] = useState<Record<string, boolean>>({});
```

Add `onBlur={() => setTouched(t => ({ ...t, password: true }))}` to the password input, and similarly for confirmPassword.

### 2. Add inline validation messages below password fields

**Password field** — show hint below the input:
- When `touched.password` is true and `password.length > 0 && password.length < 8`:
  - Red text: "Password must be at least 8 characters"
  - Red border on the input (`border-red-500` instead of `border-zinc-700`)
- When `touched.password` is true and `password.length >= 8`:
  - Green text: "Password looks good" (optional, adds polish)
  - Green border (`border-green-600`)

```tsx
{touched.password && password.length > 0 && password.length < 8 && (
  <span className="text-xs text-red-400">Password must be at least 8 characters</span>
)}
```

**Confirm password field** — show hint below the input:
- When `touched.confirmPassword` is true and `confirmPassword.length > 0 && password !== confirmPassword`:
  - Red text: "Passwords do not match"
  - Red border on the input
- When `touched.confirmPassword` is true and `confirmPassword.length > 0 && password === confirmPassword`:
  - Green text: "Passwords match"
  - Green border

```tsx
{touched.confirmPassword && confirmPassword.length > 0 && password !== confirmPassword && (
  <span className="text-xs text-red-400">Passwords do not match</span>
)}
```

### 3. Add dynamic border colors to inputs

Create a helper function to compute the border class based on validation state:

```tsx
function getInputBorderClass(fieldName: string): string {
  if (!touched[fieldName]) return "border-zinc-700 focus:border-zinc-500";

  if (fieldName === "password") {
    if (password.length === 0) return "border-zinc-700 focus:border-zinc-500";
    return password.length >= 8
      ? "border-green-600 focus:border-green-500"
      : "border-red-500 focus:border-red-400";
  }

  if (fieldName === "confirmPassword") {
    if (confirmPassword.length === 0) return "border-zinc-700 focus:border-zinc-500";
    return password === confirmPassword
      ? "border-green-600 focus:border-green-500"
      : "border-red-500 focus:border-red-400";
  }

  return "border-zinc-700 focus:border-zinc-500";
}
```

Apply this to each password input:
```tsx
className={`rounded border ${getInputBorderClass("password")} bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 outline-none`}
```

### 4. Disable submit when client-side validation fails

Disable the submit button when there are known client-side errors:

```tsx
const isValid = name.trim().length > 0 && email.trim().length > 0 && password.length >= 8 && password === confirmPassword;
```

```tsx
<button
  type="submit"
  disabled={submitting || !isValid}
  className="..."
>
```

### 5. Keep submit-level error for server-side errors

The existing `{error}` display (line 106) should remain for server-side errors like "Could not create account" or duplicate email. Don't remove it — the inline validation only handles client-side checks.

### 6. Verify

- Run `npm -s tsc -p tsconfig.json --noEmit` to verify no TypeScript errors
- Open the signup page:
  - Type a short password (< 8 chars) and tab away → red border + "at least 8 characters" hint appears
  - Type a valid password (>= 8 chars) → green border + "Password looks good"
  - Type a different confirm password and tab away → red border + "Passwords do not match"
  - Type matching confirm password → green border + "Passwords match"
  - Submit button is disabled when validation fails
  - Server-side errors (e.g., duplicate email) still show in the general error area

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/(auth)/signup/page.tsx` | **Modify** | Add `touched` state, inline validation messages, dynamic border colors, submit disable logic |

## Acceptance Criteria

1. Password field shows inline "at least 8 characters" error after user touches and types < 8 chars
2. Confirm password field shows inline "Passwords do not match" after user touches and values differ
3. Both fields show green border when validation passes (after being touched)
4. Invalid fields show red border
5. Untouched fields show default border (no validation noise on page load)
6. Submit button is disabled when client-side validation fails
7. Server-side errors still display in the general error area
8. `npm -s tsc -p tsconfig.json --noEmit` passes with no errors

## Tech Notes

- This is a single-file change in `signup/page.tsx`. ~30 lines of additions.
- Use `onBlur` for touched tracking, not `onChange`. Users shouldn't see errors mid-keystroke before they've finished typing in a field.
- The `getInputBorderClass` helper keeps the JSX clean — it returns the full border class string based on field state.
- Don't add validation to the login page — login errors are inherently server-side ("invalid credentials"). Adding client-side validation there would only add noise.
- The green "looks good" / "match" messages are optional but recommended — positive feedback reinforces that the user is on the right track, which is especially valuable for non-technical users.

## Completion Summary

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `src/app/(auth)/signup/page.tsx` | **Modified** | Added inline validation with touched tracking, dynamic border colors, validation messages, and submit disable logic |

### What Was Built
- Added `touched` state tracking via `onBlur` handlers on password and confirm password fields
- Added `getInputBorderClass()` helper that returns dynamic border classes (red for invalid, green for valid, default for untouched)
- Added inline validation messages below password field: red "Password must be at least 8 characters" (< 8 chars) and green "Password looks good" (>= 8 chars)
- Added inline validation messages below confirm password field: red "Passwords do not match" (mismatch) and green "Passwords match" (match)
- Added `isValid` computed boolean to disable submit button when client-side validation fails
- Preserved existing server-side error display for "Could not create account" errors

### Verification
- TypeScript compilation passes (`npx tsc -p tsconfig.json --noEmit` — zero errors)
- Browser tested: short password shows red inline error, valid password shows green message, mismatched confirm shows red error, submit button disabled when validation fails, no validation noise on page load

## Review (ff977355)

Reviewed `src/app/(auth)/signup/page.tsx`. No issues found:
- `"use client"` directive present
- All imports correct and used
- TypeScript compiles clean (zero errors)
- `touched` state properly typed, `onBlur` handlers correct
- `getInputBorderClass` helper logic is correct for all branches
- Inline validation conditional rendering is correct (touched + non-empty + validation check)
- `isValid` disables submit correctly
- Server-side error display preserved
- No fixes needed
