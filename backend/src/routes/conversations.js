const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Only the ticket's seller, someone who has placed an order on it, or an admin may read/write.
async function authorizeTicketConversation(req, res, next) {
  try {
    const ticketResult = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.ticketId]);
    const ticket = ticketResult.rows[0];
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isSeller = ticket.seller_id === req.user.id;
    let isBuyer = false;
    if (!isSeller) {
      const orderResult = await pool.query(
        'SELECT 1 FROM orders WHERE ticket_id = $1 AND buyer_id = $2 LIMIT 1',
        [req.params.ticketId, req.user.id]
      );
      isBuyer = orderResult.rows.length > 0;
    }

    if (!isSeller && !isBuyer && !req.user.isAdmin) {
      return res.status(403).json({ error: 'You must be the seller or a buyer on this ticket to view its conversation' });
    }

    req.ticket = ticket;
    req.canWrite = isSeller || isBuyer; // admins can view but not post, mirroring the frontend
    next();
  } catch (err) {
    next(err);
  }
}

// GET /api/tickets/:ticketId/conversation
router.get('/tickets/:ticketId/conversation', requireAuth, authorizeTicketConversation, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.username AS sender_username FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.ticket_id = $1 ORDER BY m.created_at ASC`,
      [req.params.ticketId]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    next(err);
  }
});

const messageSchema = z.object({ body: z.string().min(1).max(2000) });

// POST /api/tickets/:ticketId/conversation
router.post('/tickets/:ticketId/conversation', requireAuth, authorizeTicketConversation, async (req, res, next) => {
  try {
    if (!req.canWrite) return res.status(403).json({ error: 'Admins can view but not post in conversations' });
    const { body } = messageSchema.parse(req.body);

    const result = await pool.query(
      'INSERT INTO messages (ticket_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *',
      [req.params.ticketId, req.user.id, body]
    );
    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
