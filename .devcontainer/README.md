# Working in GitHub Codespaces

A Codespace is a Linux machine in GitHub's cloud, opened in your browser, with
Node 24 and Docker already set up by `devcontainer.json`. Nothing is installed
on your own PC, and no admin rights are needed. Personal GitHub accounts get a
free number of hours each month; stop the Codespace when you're done so it
doesn't use them up.

## Open it

1. On the repo page on GitHub, click **Code → Codespaces → Create codespace on master**
   (or on your branch).
2. Wait for the first build (a few minutes). It runs `npm ci` for you.
3. A VS Code editor opens in the browser, with a terminal at the bottom.

## Run the database tests

```bash
npm run db:start   # starts a local Supabase in Docker and applies supabase/migrations
npm run test:db    # pgTAP: row-level security, signed-out access, widget functions
npm run db:stop    # when you're done
```

The first `db:start` downloads the Supabase images and takes a few minutes.

## Look around with Docker

```bash
docker ps                      # the containers Supabase started
docker logs <container name>   # what one of them printed
docker images                  # the images that were downloaded
docker volume ls               # where the database keeps its data
```

To browse the local database in Supabase Studio, start it with every service
(`npx supabase start`, without the `-x` list in `db:start`), then open the
**Ports** tab and click the globe next to **Local Supabase Studio** (54323).

## Run the app

`npm test` and `npm run qa` work as they are. To run the app with
`npm run dev`, add your Supabase keys as Codespaces secrets first (GitHub →
Settings → Codespaces → Secrets, for this repository):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Then open port 3000 from the **Ports** tab. To sign in there, add the
Codespace's address plus `/auth/callback` to **Redirect URLs** in Supabase
(Authentication → URL Configuration).
