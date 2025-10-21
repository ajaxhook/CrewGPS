const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

const router = express.Router();

router.post('/forgot', async (req, res) => {
  const { email } = req.body;
  const u = await User.findOne({ email });
  if (!u) return res.json({ ok: true });

  const code = ('' + Math.floor(100000 + Math.random() * 900000));
  u.resetPasswordCode = code;
  u.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
  await u.save();

  try {
    await sendMail({
      to: email,
      subject: 'CrewGPS — Código de recuperação',
      html: `<p>O seu código é: <b>${code}</b></p><p>Válido por 15 minutos.</p>`
    });
  } catch {}

  res.json({ ok: true });
});


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
