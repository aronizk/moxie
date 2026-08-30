const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const ticketSchema = z.object({
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional().default(''),
  status: z.enum(['販売中', '売却済', '取消']).optional().default('販売中'),
  schedule: z.string().max(100).optional().default(''),
  place: z.string().max(200).optional().default(''),
  seatPosition: z.string().max(200).optional().default(''),
  ticketType: z.string().max(100).optional().default(''),
  pricePerSheet: z.number().nonnegative(),
  quantity: z.number().int().min(1),
  paymentMethod: z.string().max(50).optional().default('マニュアル送金'),
  transferTarget: z.string().max(200).optional().default(''),
  bankName: z.string().max(100).optional().default(''),
  bankBranch: z.string().max(100).optional().default(''),
  bankType: z.string().max(50).optional().default('普通'),
  bankNumber: z.string().max(50).optional().default(''),
  bankHolder: z.string().max(100).optional().default(''),
  instructions: z.string().max(2000).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
  sellerNote: z.string().max(1000).optional().default(''),
  reviewCount: z.number().int().nonnegative().optional().default(0),
  favoriteCount: z.number().int().nonnegative().optional().default(0),
  nameType: z.string().max(100).optional().default(''),
  issueStatus: z.string().max(100).optional().default(''),
  deliveryMethod: z.string().max(100).optional().default(''),
  deliveryPeriod: z.string().max(100).optional().default(''),
});

function toCamelRow(row) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    artist: row.artist,
    status: row.status,
    schedule: row.schedule,
    place: row.place,
    seatPosition: row.seat_position,
    ticketType: row.ticket_type,
    pricePerSheet: Number(row.price_per_sheet),
    quantity: row.quantity,
    total: Number(row.price_per_sheet) * row.quantity,
    paymentMethod: row.payment_method,
    transferTarget: row.transfer_target,
    bankName: row.bank_name,
    bankBranch: row.bank_branch,
    bankType: row.bank_type,
    bankNumber: row.bank_number,
    bankHolder: row.bank_holder,
    instructions: row.instructions,
    notes: row.notes,
    sellerNote: row.seller_note,
    reviewCount: row.review_count,
    favoriteCount: row.favorite_count ?? 0,
    viewCount: row.view_count ?? 0,
    messageCount: Number(row.message_count ?? 0),
    nameType: row.name_type,
    issueStatus: row.issue_status,
    deliveryMethod: row.delivery_method,
    deliveryPeriod: row.delivery_period,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/tickets  -> public list of active listings
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, (SELECT COUNT(*)::int FROM messages m WHERE m.ticket_id = t.id) AS message_count
       FROM tickets t WHERE t.status = '販売中' ORDER BY t.created_at DESC LIMIT 200`
    );
    res.json({ tickets: result.rows.map(toCamelRow) });
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/mine -> only the logged-in seller's own tickets
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, (SELECT COUNT(*)::int FROM messages m WHERE m.ticket_id = t.id) AS message_count
       FROM tickets t WHERE t.seller_id = $1 ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json({ tickets: result.rows.map(toCamelRow) });
  } catch (err) {
    next(err);
  }
});

// GET /api/tickets/:id -> public detail (anyone with the link can view)
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `WITH updated AS (
         UPDATE tickets SET view_count = view_count + 1 WHERE id = $1 RETURNING *
       )
       SELECT updated.*, (SELECT COUNT(*)::int FROM messages m WHERE m.ticket_id = updated.id) AS message_count
       FROM updated`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ticket: toCamelRow(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/tickets -> create (any authenticated user)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      const approval = await pool.query('SELECT can_post FROM users WHERE id = $1', [req.user.id]);
      if (!approval.rows[0] || !approval.rows[0].can_post) {
        return res.status(403).json({ error: 'not_approved' });
      }
    }
    const t = ticketSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO tickets (
        seller_id, title, artist, status, schedule, place, seat_position, ticket_type,
        price_per_sheet, quantity, payment_method, transfer_target,
        bank_name, bank_branch, bank_type, bank_number, bank_holder,
        instructions, notes, seller_note, review_count, favorite_count, name_type,
        issue_status, delivery_method, delivery_period
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
      ) RETURNING *`,
      [
        req.user.id, t.title, t.artist, t.status, t.schedule, t.place, t.seatPosition, t.ticketType,
        t.pricePerSheet, t.quantity, t.paymentMethod, t.transferTarget,
        t.bankName, t.bankBranch, t.bankType, t.bankNumber, t.bankHolder,
        t.instructions, t.notes, t.sellerNote, t.reviewCount, t.favoriteCount, t.nameType,
        t.issueStatus, t.deliveryMethod, t.deliveryPeriod,
      ]
    );
    res.status(201).json({ ticket: toCamelRow(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Loads the ticket and verifies the requester owns it (or is admin) before edit/delete.
async function loadOwnedTicket(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id]);
    const ticket = result.rows[0];
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.seller_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'You can only modify your own tickets' });
    }
    req.ticket = ticket;
    next();
  } catch (err) {
    next(err);
  }
}

// PUT /api/tickets/:id -> owner or admin only
router.put('/:id', requireAuth, loadOwnedTicket, async (req, res, next) => {
  try {
    const t = ticketSchema.parse(req.body);
    const result = await pool.query(
      `UPDATE tickets SET
        title=$1, artist=$2, status=$3, schedule=$4, place=$5, seat_position=$6, ticket_type=$7,
        price_per_sheet=$8, quantity=$9, payment_method=$10, transfer_target=$11,
        bank_name=$12, bank_branch=$13, bank_type=$14, bank_number=$15, bank_holder=$16,
        instructions=$17, notes=$18, seller_note=$19, review_count=$20, favorite_count=$21, name_type=$22,
        issue_status=$23, delivery_method=$24, delivery_period=$25, updated_at=now()
      WHERE id = $26 RETURNING *`,
      [
        t.title, t.artist, t.status, t.schedule, t.place, t.seatPosition, t.ticketType,
        t.pricePerSheet, t.quantity, t.paymentMethod, t.transferTarget,
        t.bankName, t.bankBranch, t.bankType, t.bankNumber, t.bankHolder,
        t.instructions, t.notes, t.sellerNote, t.reviewCount, t.favoriteCount, t.nameType,
        t.issueStatus, t.deliveryMethod, t.deliveryPeriod, req.params.id,
      ]
    );
    res.json({ ticket: toCamelRow(result.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tickets/:id -> owner or admin only
router.delete('/:id', requireAuth, loadOwnedTicket, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
