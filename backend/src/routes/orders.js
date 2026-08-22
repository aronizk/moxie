const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { z } = require('zod');
const pool = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { computeOrderTotals } = require('../utils/fees');
const { uploadBuffer, getSignedDownloadUrl } = require('../utils/storage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

// Only included in the response right when an order is first created (or claimed), never on
// later reads — it's the guest's one credential for proving ownership of an account-less order.
function toCamelOrder(row, { includeGuestToken = false } = {}) {
  const out = {
    id: row.id,
    ticketId: row.ticket_id,
    buyerId: row.buyer_id,
    quantity: row.quantity,
    subtotal: Number(row.subtotal),
    platformFee: Number(row.platform_fee),
    total: Number(row.total),
    status: row.status,
    paymentProofUrl: row.payment_proof_url,
    isGuestOrder: row.buyer_id === null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeGuestToken) out.guestToken = row.guest_token;
  return out;
}

function getGuestToken(req) {
  const header = req.headers['x-guest-token'];
  return typeof header === 'string' && header.length ? header : null;
}

// Loads an order and confirms the requester is the buyer (via account or guest token),
// the ticket's seller, or an admin.
async function loadAuthorizedOrder(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT o.*, t.seller_id FROM orders o
       JOIN tickets t ON t.id = o.ticket_id
       WHERE o.id = $1`,
      [req.params.orderId]
    );
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const guestToken = getGuestToken(req);
    const isGuestBuyer = order.buyer_id === null && guestToken && order.guest_token === guestToken;
    const isAccountBuyer = req.user && order.buyer_id === req.user.id;
    const isBuyer = isGuestBuyer || isAccountBuyer;
    const isSeller = req.user && order.seller_id === req.user.id;
    const isAdmin = req.user && req.user.isAdmin;

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to view this order' });
    }
    req.order = order;
    req.isBuyer = isBuyer;
    req.isSeller = isSeller;
    next();
  } catch (err) {
    next(err);
  }
}

const createOrderSchema = z.object({
  quantity: z.number().int().min(1),
});

// POST /api/tickets/:ticketId/orders -> place an order, with or without an account.
// Logged in: order is tied to the account. Not logged in: order gets a private guest_token
// that the browser must present on every later request for this order.
router.post('/tickets/:ticketId/orders', optionalAuth, async (req, res, next) => {
  try {
    const { quantity } = createOrderSchema.parse(req.body);

    const ticketResult = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.ticketId]);
    const ticket = ticketResult.rows[0];
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.status !== '販売中') return res.status(409).json({ error: 'This ticket is not currently available' });
    if (quantity > ticket.quantity) return res.status(400).json({ error: 'Requested quantity exceeds availability' });
    if (req.user && ticket.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot order your own listing' });

    const { subtotal, platformFee, total } = computeOrderTotals(ticket.price_per_sheet, quantity);
    const buyerId = req.user ? req.user.id : null;
    const guestToken = req.user ? null : crypto.randomUUID();

    const result = await pool.query(
      `INSERT INTO orders (ticket_id, buyer_id, guest_token, quantity, subtotal, platform_fee, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [ticket.id, buyerId, guestToken, quantity, subtotal, platformFee, total]
    );

    res.status(201).json({ order: toCamelOrder(result.rows[0], { includeGuestToken: true }) });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:orderId -> buyer (account or guest token), seller, or admin
router.get('/orders/:orderId', optionalAuth, loadAuthorizedOrder, async (req, res) => {
  res.json({ order: toCamelOrder(req.order) });
});

// POST /api/orders/:orderId/claim -> a logged-in user permanently attaches a guest order
// (one they hold the guest_token for) to their account, so they can track it from "My Tickets"
// without relying on the browser keeping that token around.
router.post('/orders/:orderId/claim', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.orderId]);
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== null) {
      return res.status(409).json({ error: 'This order already belongs to an account' });
    }
    const guestToken = getGuestToken(req);
    if (!guestToken || order.guest_token !== guestToken) {
      return res.status(403).json({ error: 'Invalid or missing guest token for this order' });
    }
    const updated = await pool.query(
      `UPDATE orders SET buyer_id = $1, guest_token = NULL, updated_at = now() WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.orderId]
    );
    res.json({ order: toCamelOrder(updated.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:orderId/confirm-receipt -> buyer only; ends escrow hold
router.post('/orders/:orderId/confirm-receipt', optionalAuth, loadAuthorizedOrder, async (req, res, next) => {
  try {
    if (!req.isBuyer) return res.status(403).json({ error: 'Only the buyer can confirm receipt' });
    if (req.order.status === 'completed') return res.json({ order: toCamelOrder(req.order) });

    const result = await pool.query(
      `UPDATE orders SET status = 'completed', updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.orderId]
    );
    res.json({ order: toCamelOrder(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

const complaintSchema = z.object({ body: z.string().min(1).max(3000) });

// POST /api/orders/:orderId/complaint -> buyer or seller can flag a dispute
router.post('/orders/:orderId/complaint', optionalAuth, loadAuthorizedOrder, async (req, res, next) => {
  try {
    if (!req.isBuyer && !req.isSeller) {
      return res.status(403).json({ error: 'Only the buyer or seller can file a complaint on this order' });
    }
    const { body } = complaintSchema.parse(req.body);

    // Guests (no account) filing a complaint are still recorded under an admin-visible
    // "submitted_by" — since that column requires a real user, attribute it to the seller's
    // record contextually isn't right either, so we require login only for this specific
    // action, which is reasonable: filing a formal dispute is exactly the moment identity
    // starts to matter.
    if (!req.user) {
      return res.status(401).json({ error: 'Please log in to file a complaint, so an admin can follow up with you.' });
    }

    await pool.query(
      'INSERT INTO complaints (order_id, submitted_by, body) VALUES ($1,$2,$3)',
      [req.params.orderId, req.user.id, body]
    );
    const result = await pool.query(
      `UPDATE orders SET status = 'disputed', updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.orderId]
    );
    res.status(201).json({ order: toCamelOrder(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:orderId/complaints -> buyer, seller, or admin
router.get('/orders/:orderId/complaints', optionalAuth, loadAuthorizedOrder, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM complaints WHERE order_id = $1 ORDER BY created_at ASC',
      [req.params.orderId]
    );
    res.json({ complaints: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:orderId/payment-proof -> buyer uploads a screenshot; goes to S3-compatible storage
router.post(
  '/orders/:orderId/payment-proof',
  optionalAuth,
  loadAuthorizedOrder,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.isBuyer) return res.status(403).json({ error: 'Only the buyer can upload payment proof' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

      const { key, url } = await uploadBuffer({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        keyPrefix: `payment-proofs/${req.params.orderId}`,
      });

      const newStatus = req.order.status === 'pending' ? 'awaiting_confirmation' : req.order.status;
      const result = await pool.query(
        `UPDATE orders SET payment_proof_key = $1, payment_proof_url = $2, status = $3, updated_at = now()
         WHERE id = $4 RETURNING *`,
        [key, url, newStatus, req.params.orderId]
      );

      res.status(201).json({ order: toCamelOrder(result.rows[0]) });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/orders/:orderId/payment-proof -> buyer, seller, or admin can fetch a fresh download link
router.get('/orders/:orderId/payment-proof', optionalAuth, loadAuthorizedOrder, async (req, res, next) => {
  try {
    if (!req.order.payment_proof_key && !req.order.payment_proof_url) {
      return res.status(404).json({ error: 'No payment proof uploaded yet' });
    }
    const url = req.order.payment_proof_key
      ? await getSignedDownloadUrl(req.order.payment_proof_key)
      : req.order.payment_proof_url;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
