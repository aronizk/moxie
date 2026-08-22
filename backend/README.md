# ticketin backend

A real Express + PostgreSQL backend for the ticketin marketplace: JWT auth with hashed
passwords, ownership-checked REST API, S3-compatible file uploads for payment proof,
and an admin API. No mock data, no in-memory storage — everything lives in Postgres
and object storage that you control.

## 1. Get a Postgres database

Any of these work (all give you a `DATABASE_URL` connection string):

- **Neon** (https://neon.tech) — free tier, serverless Postgres, easiest to start with
- **Supabase** (https://supabase.com) — free tier, includes a Postgres instance
- **Railway** (https://railway.app) — one-click Postgres plugin
- **Local Postgres** — `createdb ticketin` on your own machine

Whichever you choose, copy its connection string. If it requires SSL (Neon/Supabase
usually do), set `DATABASE_SSL=true` in your `.env`.

## 2. Get S3-compatible object storage (for payment-proof uploads)

Any of these work:

- **Cloudflare R2** — generous free tier, S3-compatible (set `S3_ENDPOINT` to your R2 endpoint)
- **AWS S3** — leave `S3_ENDPOINT` blank, just set `S3_REGION` and your bucket
- **Backblaze B2**, **DigitalOcean Spaces**, or a **local MinIO** for dev — all S3-compatible

Create a bucket, get an access key + secret, and either:
- make the bucket public-read and set `S3_PUBLIC_URL_BASE` to its public URL, **or**
- leave `S3_PUBLIC_URL_BASE` blank — the server will generate time-limited signed
  URLs instead (recommended for private payment screenshots).

## 3. Configure environment

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `JWT_SECRET` (any long random string — e.g. `openssl rand -hex 32`),
and the `S3_*` values.

## 4. Install, migrate, run

```bash
npm install
npm run migrate       # creates all tables in your Postgres database
npm run seed:admin     # creates/updates the admin user from ADMIN_USERNAME/ADMIN_PASSWORD in .env
npm run dev            # starts the server on PORT (default 4000), auto-restarts on change
```

> If you already had this project running before, just run `npm run migrate` again —
> it only applies new migration files (like the view/favorite counts and reports table)
> and skips ones already applied, so it's always safe to re-run.

Check it's alive and can reach the database:

```bash
curl http://localhost:4000/health
# {"status":"ok","db":"connected"}
```

## 5. API overview

All authenticated routes expect `Authorization: Bearer <token>`.

| Method | Path                                       | Auth            | Purpose |
|--------|---------------------------------------------|-----------------|---------|
| POST   | /api/auth/register                          | —               | Create account, returns JWT |
| POST   | /api/auth/login                             | —               | Log in, returns JWT |
| GET    | /api/auth/me                                | Bearer          | Current user info |
| GET    | /api/tickets                                | —               | List active (販売中) listings |
| GET    | /api/tickets/mine                           | Bearer          | Your own listings, any status |
| GET    | /api/tickets/:id                            | optional        | Public detail (shareable link) |
| POST   | /api/tickets                                | Bearer          | Create a listing |
| PUT    | /api/tickets/:id                            | Bearer, owner   | Edit — 403 if not your own |
| DELETE | /api/tickets/:id                            | Bearer, owner   | Delete — 403 if not your own |
| POST   | /api/tickets/:ticketId/orders                | Bearer          | Place an order (10% fee auto-computed) |
| GET    | /api/orders/:orderId                        | buyer/seller/admin | Order detail |
| POST   | /api/orders/:orderId/confirm-receipt         | Bearer, buyer   | Buyer ends escrow hold |
| POST   | /api/orders/:orderId/complaint               | buyer/seller    | File a dispute |
| GET    | /api/orders/:orderId/complaints              | buyer/seller/admin | List complaints on an order |
| POST   | /api/orders/:orderId/payment-proof           | Bearer, buyer   | Upload screenshot (multipart `file` field) |
| GET    | /api/orders/:orderId/payment-proof           | buyer/seller/admin | Get a fresh download URL |
| GET    | /api/tickets/:ticketId/conversation          | seller/buyer/admin | Read messages |
| POST   | /api/tickets/:ticketId/conversation          | seller/buyer    | Send a message |
| GET    | /api/admin/tickets                          | admin           | All tickets + their orders |
| DELETE | /api/admin/tickets/:id                      | admin           | Admin override delete |
| GET    | /api/admin/orders/:id/payment-proof          | admin           | Admin download link |
| GET    | /api/admin/complaints                       | admin           | Full complaint queue |
| POST   | /api/tickets/:id/report                      | Bearer          | File a report on a listing (separate from order complaints) |
| GET    | /api/admin/reports                          | admin           | All ticket reports |

### Authorization model
- Editing/deleting a ticket requires `seller_id === req.user.id` OR `is_admin = true` — enforced server-side in `loadOwnedTicket` (src/routes/tickets.js), not just hidden in the UI.
- Orders, complaints, and payment-proof access require being the buyer, the ticket's seller, or an admin.
- Conversation access requires being the seller, having placed an order on that ticket, or being an admin (admins can read but not post, matching the original spec).
- Every write route runs through `zod` schema validation before touching the database.

## 6. Deploying

Any Node host works. Quick options:

**Railway / Render / Fly.io**
1. Push this folder to a Git repo.
2. Create a new service from the repo, set the same environment variables from `.env`.
3. Set the start command to `npm run migrate && npm start` (or run migrate once manually, then `npm start`).
4. Point `CORS_ORIGIN` at your frontend's real URL once deployed.

**Docker** (optional, if your host wants a container):
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4000
CMD ["sh", "-c", "npm run migrate && npm start"]
```

## 7. Frontend

This project now includes a real frontend at `../frontend/index.html`, wired directly
to this API (real login/register, JWT stored in the browser, ownership-checked ticket
edit/delete, real order + escrow + complaint + payment-proof flows, and an admin panel
gated on the JWT's `isAdmin` claim — not a client-side password).

The Express server serves it automatically: once you run `npm run dev` or `npm start`,
open **http://localhost:4000/** and the frontend is right there, already talking to the
API on the same origin.

If you ever want to open `frontend/index.html` directly (e.g. via a separate static
file server) while pointing at a differently-hosted API, append `?api=` to the URL:
```
http://localhost:5500/index.html?api=http://localhost:4000/api
```

