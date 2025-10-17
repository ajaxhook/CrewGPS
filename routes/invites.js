const express = require('express');
const auth = require('../middleware/auth');
const Trip = require('../models/Trip');

const router = express.Router();

/**
 * Alias de convites para eventos (compatível com /api/trips/:id/invite)
 * POST /api/invites/trips/:id  { inviteeIds: [] }
 */
router.post('/trips/:id', auth, async (req, res) => {
  const t = await Trip.findOne({ _id: req.params.id, user: req.user.id });
  if (!t) return res.status(404).json({ msg: 'Não encontrado' });
  const ids = Array.isArray(req.body.inviteeIds) ? req.body.inviteeIds : [];
  t.invitedUsers = Array.from(new Set([...(t.invitedUsers || []), ...ids]));
  await t.save();
  res.json({ ok: true, invitedUsers: t.invitedUsers });
});

module.exports = router;
