const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

router.post('/', auth, async (req, res) => {
  const { make, model, plate, color, matricula, cor } = req.body;
  const v = {
    make: make || '',
    model: model || '',
    plate: plate || matricula || '',
    color: color || cor || '#1C1B22'
  };
  if (!v.make || !v.model || !v.plate || !v.color) {
    return res.status(400).json({ msg: 'Campos obrigatórios: make, model, plate/matricula, color/cor' });
  }
  await User.updateOne({ _id: req.user.id }, { $push: { garage: v } });
  res.json({ ok: true });
});

router.get('/', auth, async (req, res) => {
  const u = await User.findById(req.user.id).select('garage');
  res.json(u.garage || []);
});

module.exports = router;
