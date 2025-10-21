const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  try {
    const header = req.headers.authorization || req.headers['x-auth-token'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;

    if (!token) {
      return res.status(401).json({ message: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.user?.id || decoded.id || decoded._id || decoded.sub;

    if (!userId) {
      return res.status(401).json({ message: 'Token malformado: ID do utilizador não encontrado' });
    }

    req.user = { id: userId, ...decoded.user }; 

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido ou expirado' });
  }
};