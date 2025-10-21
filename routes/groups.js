const express = require('express');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const User = require('../models/User');

const router = express.Router();

router.post('/', auth, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ msg: 'O nome do grupo é obrigatório.' });
    }

    const newGroup = await Group.create({
      name: name.trim(),
      description: description || '',
      admin: req.user.id,
      members: [req.user.id],
    });
    res.status(201).json(newGroup);
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ msg: 'Erro no servidor ao criar grupo.' });
  }
});


router.get('/', auth, async (req, res) => {
  try {
    const myGroups = await Group.find({ members: req.user.id }).populate('admin', 'nome').lean();
    const groupsWithCount = myGroups.map(g => ({ ...g, membersCount: g.members.length }));
    res.json(groupsWithCount);
  } catch (error) {
    console.error('Error fetching my groups:', error);
    res.status(500).json({ msg: 'Erro no servidor ao obter grupos.' });
  }
});

router.get('/search', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const groups = await Group.find({
      name: { $regex: q, $options: 'i' },
    }).limit(10).lean();
    res.json(groups);
  } catch (error) {
    console.error('Error searching groups:', error);
    res.status(500).json({ msg: 'Erro no servidor ao pesquisar grupos.' });
  }
});

router.post('/:id/join', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ msg: 'Grupo não encontrado.' });
    }
    await Group.findByIdAndUpdate(req.params.id, { $addToSet: { members: req.user.id } });
    res.json({ msg: 'Aderiu ao grupo com sucesso.' });
  } catch (error) {
    console.error('Error joining group:', error);
    res.status(500).json({ msg: 'Erro no servidor ao juntar-se ao grupo.' });
  }
});

module.exports = router;