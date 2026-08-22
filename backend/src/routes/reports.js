const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const reportSchema = z.object({ body: z.string().min(1).max(2000) });

// POST /api/tickets/:id/report -> any authenticated user can flag a listing for admin review
router.post('/tickets/:id/report', requireAuth, async (req, res, next) => {
  try {
    const ticketResult = await pool.query('SELECT id FROM tickets WHERE id = $1', [req.params.id]);
    if (!ticketResult.rows[0]) return res.status(404).json({ error: 'Ticket not found' });

    const { body } = reportSchema.parse(req.body);
    const result = await pool.query(
      'INSERT INTO reports (ticket_id, reported_by, body) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, body]
    );
    res.status(201).json({ report: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
