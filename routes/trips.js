const express = require('express');
const auth = require('../middleware/auth');
const Trip = require('../models/Trip');

const router = express.Router();

// POST /api/trips
router.post('/', auth, async (req, res) => {
  const { routeName, description, startLocation, endLocation, stops, date, durationText, distanceText, isPublic } = req.body;
  if (!routeName || !startLocation?.description || !endLocation?.description || !date) {
    return res.status(400).json({ msg: 'Dados do evento incompletos' });
  }
  const t = await Trip.create({
    user: req.user.id,
    routeName,
    description: description || '',
    startLocation,
    endLocation,
    stops: Array.isArray(stops) ? stops : [],
    date,
    durationText,
    distanceText,
    isPublic: !!isPublic
  });
  res.json(t);
});

// GET /api/trips (meus)
router.get('/', auth, async (req, res) => {
  const list = await Trip.find({ user: req.user.id }).sort({ date: -1 });
  res.json(list);
});

// GET /api/trips/public
router.get('/public', async (req, res) => {
  const list = await Trip.find({ isPublic: true })
    .populate('user', 'nome profilePicture')
    .sort({ date: -1 });
  res.json(list);
});

// GET /api/trips/:id (do dono)
router.get('/:id', auth, async (req, res) => {
  const t = await Trip.findOne({ _id: req.params.id, user: req.user.id });
  if (!t) return res.status(404).json({ msg: 'Não encontrado' });
  res.json(t);
});

// PUT /api/trips/:id
router.put('/:id', auth, async (req, res) => {
  const t = await Trip.findOne({ _id: req.params.id, user: req.user.id });
  if (!t) return res.status(404).json({ msg: 'Não encontrado' });
  Object.assign(t, req.body);
  await t.save();
  res.json(t);
});

// DELETE /api/trips/:id
router.delete('/:id', auth, async (req, res) => {
  await Trip.deleteOne({ _id: req.params.id, user: req.user.id });
  res.json({ ok: true });
});

// POST /api/trips/:id/invite { inviteeIds: [] }
router.post('/:id/invite', auth, async (req, res) => {
  const t = await Trip.findOne({ _id: req.params.id, user: req.user.id });
  if (!t) return res.status(404).json({ msg: 'Não encontrado' });
  const ids = Array.isArray(req.body.inviteeIds) ? req.body.inviteeIds : [];
  t.invitedUsers = Array.from(new Set([...(t.invitedUsers || []), ...ids]));
  await t.save();
  res.json({ ok: true, invitedUsers: t.invitedUsers });
});

module.exports = router;
