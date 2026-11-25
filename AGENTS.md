<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Before building a feature: show the design review first

Don't write code for a new feature, or a change to one, until the owner has seen and approved a
design review. Problems should be caught here, before building, not after deploying and testing.
Write it in plain words, with a phone mockup where the screen changes, and cover:

1. **What it's for**: the problem, and what the person will be able to do afterwards.
2. **CRUD, screen by screen**: one line each for Create, Read (view), Update (edit) and Delete:
   - where in the app you do it (the screen and the button), or **"Missing"**, with a reason if
     it's left out on purpose;
   - the server action and the table it writes (for example `saveWish` → `wishlist_items`).

   Every thing a person can add must be viewable, editable and removable, unless the review says
   why not. A missing Update or Delete has to be pointed out, never left for the owner to find.

   | Thing          | Create          | Read          | Update        | Delete          |
   | -------------- | --------------- | ------------- | ------------- | --------------- |
   | e.g. Plan      | + Add a plan    | Plan › Wishlist | Edit (ideas) | Remove        |
3. **Connections**: what links to what (`table.column → table`), what happens to the linked rows
   when one side is edited or deleted (removed with it, kept with the link cleared, or blocked),
   and where it shows up elsewhere (forecast, Scheduled, Home).
4. **Dates and amounts**: in plain words, when things start and end and how amounts are split,
   with one worked example.
5. **Database changes**: the new migration and SQL_GUIDE.md step, the row-level security, and
   what the app does until it's run.
6. **How it'll be checked**: the tests, and what to tap on the phone.

Only after the owner approves: build it, test it, then deploy.
