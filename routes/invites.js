const express = require('express');
const auth = require('../middleware/auth');
const Invite = require('../models/Invite');
const Trip = require('../models/Trip');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
  } catch (err) {
    res.status(500).json({ msg: 'Erro no servidor' });
  }
});

module.exports = router;