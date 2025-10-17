const express = require('express');
const auth = require('../middleware/auth');
const Message = require('../models/Message');

const router = express.Router();

// GET /api/chat(s)/:friendId/messages
router.get('/:friendId/messages', auth, async (req, res) => {
  const me = req.user.id, friend = req.params.friendId;
  const list = await Message.find({
    $or: [{ from: me, to: friend }, { from: friend, to: me }]
  }).sort({ createdAt: 1 }).limit(500);

  const mapped = list.map(m => ({
    _id: m._id, text: m.text, createdAt: m.createdAt, fromMe: String(m.from) === String(me)
  }));
  res.json(mapped);
});

// POST /api/chat(s)/:friendId/messages
router.post('/:friendId/messages', auth, async (req, res) => {
  const me = req.user.id, friend = req.params.friendId;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ msg: 'Texto vazio' });

  const msg = await Message.create({ from: me, to: friend, text: text.trim() });

  // socket realtime
  const io = req.app.get('io');
  if (io) {
    const payload = { _id: msg._id, text: msg.text, from: String(me), to: String(friend), createdAt: msg.createdAt };
    io.to(`user:${friend}`).emit('chat:new', payload);
    io.to(`user:${me}`).emit('chat:sent', payload);
  }

  res.json({ ok: true, id: msg._id });
});

module.exports = router;
