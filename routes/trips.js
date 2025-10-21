const express = require('express');
const auth = require('../middleware/auth');
const Trip = require('../models/Trip');

const router = express.Router();

router.post('/', auth, async (req, res) => {
  const { routeName, description, startLocation, endLocation, stops, date, durationText, distanceText, isPublic } = req.body;
  if (!routeName || !startLocation?.description || !endLocation?.description || !date) {
    return res.status(400).json({ msg: 'Dados do evento incompletos' });
  }

  try {
    const newTrip = await Trip.create({
      user: req.user.id,
      routeName,
      description: description || '',
      startLocation,
      endLocation,
      stops: Array.isArray(stops) ? stops : [],
      date,
      durationText,
      distanceText,
      isPublic: !!isPublic,
      participants: [req.user.id]
    });
    
    await newTrip.populate('user', 'nome profilePicture');
    await newTrip.populate('participants', 'nome profilePicture');

    res.status(201).json(newTrip);
  } catch (err) {
    console.error("Erro ao criar evento:", err);
    res.status(500).json({ msg: 'Erro no servidor ao criar evento.' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const list = await Trip.find({ user: req.user.id })
      .populate('user', 'nome profilePicture')
      .populate('participants', 'nome profilePicture')
      .sort({ date: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.get('/public', auth, async (req, res) => { 
  try {
    const list = await Trip.find({
      $or: [
        { isPublic: true },
        { invitedUsers: req.user.id }
      ]
    })
      .populate('user', 'nome profilePicture')
      .populate('participants', 'nome profilePicture')
      .sort({ date: -1 })
      .lean();
      
    res.json(list);
  } catch (err) {
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const t = await Trip.findOne({ _id: req.params.id, user: req.user.id })
      .populate('user', 'nome profilePicture')
      .populate('participants', 'nome profilePicture');
      
    if (!t) return res.status(404).json({ msg: 'Evento não encontrado ou não tem permissão para editar' });
    res.json(t);
  } catch (err) {
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const t = await Trip.findOne({ _id: req.params.id, user: req.user.id });
    if (!t) return res.status(404).json({ msg: 'Evento não encontrado' });
    
    Object.assign(t, req.body);
    
    await t.save();
    
    await t.populate('user', 'nome profilePicture');
    await t.populate('participants', 'nome profilePicture');
    
    res.json(t);
  } catch (err) {
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await Trip.deleteOne({ _id: req.params.id, user: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.post('/:id/invite', auth, async (req, res) => {
  try {
    const t = await Trip.findOne({ _id: req.params.id, user: req.user.id });
    if (!t) return res.status(404).json({ msg: 'Evento não encontrado' });
    
    const ids = Array.isArray(req.body.inviteeIds) ? req.body.inviteeIds : [];
    t.invitedUsers = Array.from(new Set([...(t.invitedUsers || []).map(String), ...ids])); 
    
    await t.save();
    res.json({ ok: true, invitedUsers: t.invitedUsers });
  } catch (err) {
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.post('/:id/join', auth, async (req, res) => {
  try {
    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { participants: req.user.id } },
      { new: true }
    )
    .populate('user', 'nome profilePicture')
    .populate('participants', 'nome profilePicture'); 

    if (!trip) return res.status(404).json({ msg: 'Evento não encontrado.' });
    res.json(trip);
  } catch (err) {
    console.error("Error joining trip:", err);
    res.status(500).json({ msg: 'Erro no servidor ao juntar-se ao evento.' });
  }
});

router.post('/:id/leave', auth, async (req, res) => {
  try {
    const trip = await Trip.findByIdAndUpdate(
      req.params.id,
      { $pull: { participants: req.user.id } }, 
      { new: true }
    )
    .populate('user', 'nome profilePicture')
    .populate('participants', 'nome profilePicture');

    if (!trip) return res.status(404).json({ msg: 'Evento não encontrado.' });
    res.json(trip);
  } catch (err) {
    console.error("Error leaving trip:", err);
    res.status(500).json({ msg: 'Erro no servidor ao sair do evento.' });
  }
});

module.exports = router;