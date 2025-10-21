const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const User = require('../models/User');
const ciEq = (value) => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

function signToken(user) {
  return jwt.sign(
    { user: { id: user.id } },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

router.post(
  '/register',
  [
    check('nome', 'Nome é obrigatório.').trim().notEmpty(),
    check('email', 'Email inválido.').isEmail(),
    check('password', 'Password com pelo menos 6 caracteres.').isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { nome, email, password } = req.body;

    try {
      const existingByEmail = await User.findOne({ email: ciEq(email) });
      if (existingByEmail) {
        return res.status(400).json({ msg: 'Email já está em uso.' });
      }
      const existingByName = await User.findOne({ nome: ciEq(nome) });
      if (existingByName) {
        return res.status(400).json({ msg: 'Nome de utilizador já está em uso.' });
      }

      const user = new User({
        nome,
        email,
        password: await bcrypt.hash(password, 10),
      });

      await user.save();

      const token = signToken(user);
      res.json({ token });
    } catch (err) {
      console.error('register error:', err);
      res.status(500).json({ msg: 'Erro no servidor.' });
    }
  }
);

router.post(
  '/login',
  [check('email', 'Email inválido.').isEmail(), check('password', 'Password é obrigatória.').exists()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email: ciEq(email) });
      if (!user) {
        return res.status(400).json({ msg: 'Utilizador não encontrado.' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(400).json({ msg: 'Credenciais inválidas.' });
      }

      const token = signToken(user);
      res.json({ token });
    } catch (err) {
      console.error('login error:', err);
      res.status(500).json({ msg: 'Erro no servidor.' });
    }
  }
);

router.get('/me', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id)
      .select('-password')
      .lean();

    if (!me) return res.status(404).json({ msg: 'Utilizador não encontrado.' });
    
    me.garage = me.garage || [];
    me.friends = me.friends || [];
    res.json(me);
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.put('/profile', auth, async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body.nome === 'string' && req.body.nome.trim()) {
      const exists = await User.findOne({
        _id: { $ne: req.user.id },
        nome: ciEq(req.body.nome),
      }).lean();
      if (exists) return res.status(400).json({ msg: 'Esse nome já está em uso.' });
      updates.nome = req.body.nome.trim();
    }

    if (typeof req.body.profilePicture === 'string' && req.body.profilePicture.startsWith('data:image')) {
      updates.profilePicture = req.body.profilePicture;
    }

    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true }).select('-password');
    res.json(user);
  } catch (err) {
    console.error('profile update error:', err);
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.put(
  '/password',
  auth,
  [
    check('currentPassword', 'Password atual é obrigatória.').exists(),
    check('newPassword', 'Nova password com pelo menos 6 caracteres.').isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ msg: 'Utilizador não encontrado.' });

      const ok = await bcrypt.compare(req.body.currentPassword, user.password);
      if (!ok) return res.status(400).json({ msg: 'Password atual incorreta.' });

      user.password = await bcrypt.hash(req.body.newPassword, 10);
      await user.save();

      res.json({ msg: 'Password atualizada.' });
    } catch (err) {
      console.error('change password error:', err);
      res.status(500).json({ msg: 'Erro no servidor.' });
    }
  }
);

router.delete('/me', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    await User.updateMany({ friends: userId }, { $pull: { friends: userId } });
    
    try {
      const FriendRequest = require('../models/FriendRequest');
      await FriendRequest.deleteMany({ $or: [{ from: userId }, { to: userId }] });
    } catch (_) {}

    await User.findByIdAndDelete(userId);

    res.json({ msg: 'Conta removida.' });
  } catch (err) {
    console.error('delete me error:', err);
    res.status(500).json({ msg: 'Erro no servidor.' });
  }
});

router.get('/search', auth, async (req, res) => {
  const q = (req.query.query || req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    const users = await User.find({
      _id: { $ne: req.user.id },
      nome: { $regex: safe, $options: 'i' },
    })
      .select('_id nome profilePicture')
      .limit(20)
      .lean();

    res.json(users);
  } catch (err) {
    console.error('users/search error:', err);
    res.status(500).json({ msg: 'Erro a pesquisar utilizadores.' });
  }
});

router.get('/all', auth, async (req, res) => {
  try {
      const users = await User.find({ _id: { $ne: req.user.id } })
          .select('_id nome profilePicture')
          .lean();
      res.json(users);
  } catch (err) {
      res.status(500).json({ msg: 'Erro a obter utilizadores.' });
  }
});

module.exports = router;