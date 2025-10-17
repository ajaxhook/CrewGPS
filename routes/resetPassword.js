const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

const router = express.Router();

// POST /api/password/forgot  { email }
router.post('/forgot', async (req, res) => {
  const { email } = req.body;
  const u = await User.findOne({ email });
  // responde sempre 200 para não revelar existência
  if (!u) return res.json({ ok: true });

  const code = ('' + Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
  u.resetPasswordCode = code;
  u.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
  await u.save();

  try {
    await sendMail({
      to: email,
      subject: 'CrewGPS — Código de recuperação',
      html: `<p>O seu código é: <b>${code}</b></p><p>Válido por 15 minutos.</p>`
    });
  } catch { /* ignora erros de email */ }

  res.json({ ok: true });
});

// POST /api/password/reset  { email, code, newPassword }
router.post('/reset', async (req, res) => {
  const { email, code, newPassword } = req.body;
  const u = await User.findOne({
    email,
    resetPasswordCode: code,
    resetPasswordExpires: { $gt: new Date() }
  });
  if (!u) return res.status(400).json({ msg: 'Código inválido ou expirado' });

  u.password = await bcrypt.hash(newPassword, 10);
  u.resetPasswordCode = undefined;
  u.resetPasswordExpires = undefined;
  await u.save();
  res.json({ ok: true });
});

module.exports = router;
