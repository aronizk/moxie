const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getSignedDownloadUrl } = require('../utils/s3');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/tickets -> every ticket with its orders, for the admin panel
router.get('/tickets', async (req, res, next) => {
  try {
    const tickets = (await pool.query('SELECT * FROM tickets ORDER BY created_at DESC')).rows;
    const orders = (await pool.query(
      `SELECT o.*, u.username AS buyer_username FROM orders o
       JOIN users u ON u.id = o.buyer_id`
    )).rows;
    const complaints = (await pool.query('SELECT * FROM complaints ORDER BY created_at DESC')).rows;

    const ordersByTicket = {};
    for (const o of orders) {
      (ordersByTicket[o.ticket_id] ||= []).push({
        id: o.id,
        buyerUsername: o.buyer_username,
        quantity: o.quantity,
        total: Number(o.total),
        status: o.status,
        hasPaymentProof: !!(o.payment_proof_key || o.payment_proof_url),
      });
    }

    res.json({
      tickets: tickets.map(t => ({
        id: t.id,
        title: t.title,
        sellerId: t.seller_id,
        status: t.status,
        pricePerSheet: Number(t.price_per_sheet),
        orders: ordersByTicket[t.id] || [],
      })),
      complaintCount: complaints.length,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/tickets/:id -> admin override delete
router.delete('/tickets/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/orders/:id/payment-proof -> admin download link
router.get('/orders/:id/payment-proof', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.payment_proof_key && !order.payment_proof_url) {
      return res.status(404).json({ error: 'No payment proof uploaded' });
    }
    const url = order.payment_proof_key
      ? await getSignedDownloadUrl(order.payment_proof_key)
      : order.payment_proof_url;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/complaints -> full complaint queue
router.get('/complaints', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.*, o.ticket_id, o.total, u.username AS submitted_by_username
       FROM complaints c
       JOIN orders o ON o.id = c.order_id
       JOIN users u ON u.id = c.submitted_by
       ORDER BY c.created_at DESC`
    );
    res.json({ complaints: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/reports -> ticket-level reports (separate from order complaints)
router.get('/reports', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, t.title AS ticket_title, u.username AS reported_by_username
       FROM reports r
       JOIN tickets t ON t.id = r.ticket_id
       JOIN users u ON u.id = r.reported_by
       ORDER BY r.created_at DESC`
    );
    res.json({ reports: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
