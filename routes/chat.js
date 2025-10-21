const express = require('express');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');
const mongoose = require('mongoose');
const router = express.Router();

router.get('/threads', auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const messages = await Message.aggregate([
      { $match: { $or: [{ from: userId }, { to: userId }] } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { $cond: { if: { $eq: ['$from', userId] }, then: '$to', else: '$from' } },
          lastMessage: { $last: '$$ROOT' },
          unreadCount: { $sum: { $cond: [{ $and: [{ $eq: ['$to', userId] }, { $not: ['$readAt'] }] }, 1, 0] } }
        }
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          user: { _id: '$user._id', nome: '$user.nome', profilePicture: '$user.profilePicture' },
          lastMessage: '$lastMessage',
          unreadCount: '$unreadCount'
        }
      },
      { $sort: { 'lastMessage.createdAt': -1 } }
    ]);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching threads:', error);
    res.status(500).send('Server Error');
  }
});

router.get('/unread', auth, async (req, res) => {
  try {
    const count = await Message.countDocuments({ to: req.user.id, readAt: null });
    res.json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).send('Server Error');
  }
});

router.post('/:userId/read', auth, async (req, res) => {
  try {
    const myId = new mongoose.Types.ObjectId(req.user.id);
    const friendId = new mongoose.Types.ObjectId(req.params.userId);

    await Message.updateMany(
      { to: myId, from: friendId, readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.status(200).json({ msg: 'Mensagens marcadas como lidas.' });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).send('Server Error');
  }
});

router.get('/:friendId/messages', auth, async (req, res) => {
  try {
    const me = new mongoose.Types.ObjectId(req.user.id);
    const friend = new mongoose.Types.ObjectId(req.params.friendId);
    
    const list = await Message.find({
      $or: [{ from: me, to: friend }, { from: friend, to: me }]
    }).sort({ createdAt: 1 }).limit(500);

    const mapped = list.map(m => ({
      _id: m._id, text: m.text, createdAt: m.createdAt, fromMe: m.from.equals(me)
    }));

    res.json(mapped);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).send('Server Error');
  }
});

router.post('/:friendId/messages', auth, async (req, res) => {
  try {
    const me = req.user.id, friend = req.params.friendId;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ msg: 'Texto vazio' });

    const msg = await Message.create({ from: me, to: friend, text: text.trim() });

    const io = req.app.get('io');
    if (io) {
    }
    res.status(201).json({ ok: true, id: msg._id });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;