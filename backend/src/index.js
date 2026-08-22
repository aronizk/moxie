require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const pool = require('./db');
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const orderRoutes = require('./routes/orders');
const conversationRoutes = require('./routes/conversations');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for simplicity; tighten if you add a CDN/script sources
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api', orderRoutes);          // /api/tickets/:ticketId/orders, /api/orders/:orderId/*
app.use('/api', conversationRoutes);   // /api/tickets/:ticketId/conversation
app.use('/api', reportRoutes);         // /api/tickets/:id/report
app.use('/api/admin', adminRoutes);

// Any unmatched /api/* path is a real 404, not a frontend route.
app.use('/api', notFound);

// Serve the real frontend (backend/src -> backend -> project root -> frontend)
const frontendDir = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ticketin listening on port ${PORT} (API + frontend)`);
});
