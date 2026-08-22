const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { computeOrderTotals } = require('../utils/fees');
const { uploadBuffer, getSignedDownloadUrl } = require('../utils/s3');

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

function toCamelOrder(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    buyerId: row.buyer_id,
    quantity: row.quantity,
    subtotal: Number(row.subtotal),
    platformFee: Number(row.platform_fee),
    total: Number(row.total),
    status: row.status,
    paymentProofUrl: row.payment_proof_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Loads an order and confirms the requester is the buyer, the ticket's seller, or an admin.
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
    const isBuyer = order.buyer_id === req.user.id;
    const isSeller = order.seller_id === req.user.id;
    if (!isBuyer && !isSeller && !req.user.isAdmin) {
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

// POST /api/tickets/:ticketId/orders -> buyer places an order on a listing
router.post('/tickets/:ticketId/orders', requireAuth, async (req, res, next) => {
  try {
    const { quantity } = createOrderSchema.parse(req.body);

    const ticketResult = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.ticketId]);
    const ticket = ticketResult.rows[0];
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.status !== '販売中') return res.status(409).json({ error: 'This ticket is not currently available' });
    if (quantity > ticket.quantity) return res.status(400).json({ error: 'Requested quantity exceeds availability' });
    if (ticket.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot order your own listing' });

    const { subtotal, platformFee, total } = computeOrderTotals(ticket.price_per_sheet, quantity);

    const result = await pool.query(
      `INSERT INTO orders (ticket_id, buyer_id, quantity, subtotal, platform_fee, total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ticket.id, req.user.id, quantity, subtotal, platformFee, total]
    );

    res.status(201).json({ order: toCamelOrder(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:orderId -> buyer, seller, or admin
router.get('/orders/:orderId', requireAuth, loadAuthorizedOrder, async (req, res) => {
  res.json({ order: toCamelOrder(req.order) });
});

// POST /api/orders/:orderId/confirm-receipt -> buyer only; ends escrow hold
router.post('/orders/:orderId/confirm-receipt', requireAuth, loadAuthorizedOrder, async (req, res, next) => {
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
router.post('/orders/:orderId/complaint', requireAuth, loadAuthorizedOrder, async (req, res, next) => {
  try {
    if (!req.isBuyer && !req.isSeller) {
      return res.status(403).json({ error: 'Only the buyer or seller can file a complaint on this order' });
    }
    const { body } = complaintSchema.parse(req.body);

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
router.get('/orders/:orderId/complaints', requireAuth, loadAuthorizedOrder, async (req, res, next) => {
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
  requireAuth,
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
router.get('/orders/:orderId/payment-proof', requireAuth, loadAuthorizedOrder, async (req, res, next) => {
  try {
    if (!req.order.payment_proof_key && !req.order.payment_proof_url) {
      return res.status(404).json({ error: 'No payment proof uploaded yet' });
    }
    // If a public URL base is configured, payment_proof_url already works directly.
    // Otherwise, re-sign a fresh temporary URL from the stored key.
    const url = req.order.payment_proof_key
      ? await getSignedDownloadUrl(req.order.payment_proof_key)
      : req.order.payment_proof_url;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
