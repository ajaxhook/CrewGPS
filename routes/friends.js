const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');

const router = express.Router();

router.post('/requests', auth, async (req, res) => {
  const toUserId = req.body.toUserId || req.body.to;
  if (!toUserId) return res.status(400).json({ msg: 'toUserId obrigatório' });
  if (toUserId === req.user.id) return res.status(400).json({ msg: 'Não pode adicionar-se' });

  const me = await User.findById(req.user.id).select('friends');
  if (me?.friends?.some(id => String(id) === String(toUserId))) {
    return res.status(400).json({ msg: 'Já são amigos' });
  }

  try {
    const fr = await FriendRequest.findOneAndUpdate(
      { from: req.user.id, to: toUserId },
      { $setOnInsert: { from: req.user.id, to: toUserId, status: 'pending' } },
      { upsert: true, new: true }
    );
    res.json(fr);
  } catch {
    res.status(400).json({ msg: 'Já existe um pedido pendente' });
  }
});

router.get('/requests/incoming', auth, async (req, res) => {
  const list = await FriendRequest.find({ to: req.user.id, status: 'pending' })
    .populate('from', '_id nome profilePicture')
    .sort({ createdAt: -1 });
  res.json(list);
});

router.get('/requests/outgoing', auth, async (req, res) => {
  const list = await FriendRequest.find({ from: req.user.id, status: 'pending' })
    .populate('to', '_id nome profilePicture')
    .sort({ createdAt: -1 });
  res.json(list);
});

router.post('/requests/:id/accept', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const fr = await FriendRequest.findOne({ _id: req.params.id, to: req.user.id, status: 'pending' }).session(session);
    if (!fr) {
      await session.abortTransaction();
      return res.status(404).json({ msg: 'Pedido não encontrado' });
    }

    await User.updateOne({ _id: fr.from }, { $addToSet: { friends: fr.to } }).session(session);
    await User.updateOne({ _id: fr.to },   { $addToSet: { friends: fr.from } }).session(session);
    await FriendRequest.deleteOne({ _id: fr._id }).session(session);

    await session.commitTransaction();

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${fr.from}`).emit('friends:update', { type: 'accepted', userId: String(fr.to) });
      io.to(`user:${fr.to}`).emit('friends:update',   { type: 'accepted', userId: String(fr.from) });
    }

    res.json({ ok: true, friendId: fr.from });
  } catch (e) {
    await session.abortTransaction();
    res.status(500).json({ msg: 'Erro ao aceitar' });
  } finally {
    session.endSession();
  }
});

router.post('/requests/:id/reject', auth, async (req, res) => {
  await FriendRequest.deleteOne({ _id: req.params.id, to: req.user.id });
  res.json({ ok: true });
});

router.delete('/requests/:id', auth, async (req, res) => {
  const fr = await FriendRequest.findOne({ _id: req.params.id, from: req.user.id, status: 'pending' });
  if (!fr) return res.status(404).json({ msg: 'Pedido não encontrado' });
  await FriendRequest.deleteOne({ _id: fr._id });
  res.json({ ok: true });
});

router.delete('/:friendId', auth, async (req, res) => {
  const a = req.user.id, b = req.params.friendId;
  await Promise.all([
    User.updateOne({ _id: a }, { $pull: { friends: b } }),
    User.updateOne({ _id: b }, { $pull: { friends: a } })
  ]);
  res.json({ ok: true });
});

router.get('/list', auth, async (req, res) => {
  const me = await User.findById(req.user.id).populate('friends', '_id nome profilePicture');
  res.json(me?.friends || []);
});

module.exports = router;
