# ticketin — full stack

This zip contains the complete, real (non-simulated) application:

```
ticketin-fullstack/
├── backend/     Express + PostgreSQL API (JWT auth, S3 uploads, ownership checks)
│   └── README.md    <- full setup, migration, and deploy instructions are here
└── frontend/
    └── index.html   the real UI, calling the backend API directly
```

## Quick start

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, S3_* credentials
npm install
npm run migrate
npm run seed:admin        # creates your admin user from ADMIN_USERNAME / ADMIN_PASSWORD in .env
npm run dev
```

Then open **http://localhost:4000/** — the backend serves the real frontend directly,
already wired to the real API. No mock data, no client-only storage: tickets, orders,
messages, and complaints all live in your Postgres database, and payment-proof uploads
go to your S3-compatible bucket.

Full details (getting a free Postgres database, getting S3-compatible storage, the API
route table, the authorization model, and deployment to Railway/Render/Fly) are in
`backend/README.md`.

## What was verified before this was packaged

This was actually run end-to-end against a real local Postgres instance before
delivery — not just written and assumed to work:
- Migrations ran and created all tables
- Registration, login (including an email-style admin username), and JWT issuance
- Ticket creation with the full field set
- **Server-side ownership enforcement**: a second user's edit/delete attempts on someone
  else's ticket were confirmed to return `403`, not just hidden in the UI
- Order creation with the 10% platform fee computed correctly (verified: ¥16,000 → ¥1,600
  fee → ¥17,600 total)
- Escrow confirm-receipt restricted to the buyer only (seller attempt confirmed `403`)
- Complaint filing and the resulting `disputed` status
- Conversation access restricted to the ticket's seller/buyer/admin (an unrelated user's
  read attempt confirmed `403`)
- Admin login and the admin API returning all tickets, orders, and complaint counts,
  with non-admins confirmed blocked (`403`)

One real bug was caught and fixed during this test pass: the order-detail routes
(`confirm-receipt`, `complaint`, `payment-proof`, etc.) were missing a path segment and
would have 404'd. It's fixed in the code you're getting.

The payment-proof **upload** step itself was exercised against the endpoint logic (file
received, validated, handed to the S3 client) but the final upload to S3 wasn't confirmed
against a real bucket, since that requires your actual S3-compatible credentials, which
only you can provide.
