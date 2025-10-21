require('dotenv').config();

if (!process.env.MONGO_URI && process.env.MONGODB_URI) {
  process.env.MONGO_URI = process.env.MONGODB_URI;
}

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');
const connectDB = require('./db');
const roadsRouter = require('./routes/roads');
const app = express();

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
        return cb(null, true);
      }
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: process.env.JSON_LIMIT || '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/roads', require('./routes/roads'));
app.use('/api/users', require('./routes/users'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/invites', require('./routes/invites'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/garage', require('./routes/garage'));
app.use('/api/password', require('./routes/resetPassword'));
app.use('/api/groups', require('./routes/groups'));
app.get('/healthz', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});
app.use((req, res, next) => {
  res.status(404).json({ message: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(err);
  res.status(status).json({ message: err.message || 'Erro interno do servidor' });
});

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_IP = process.env.PUBLIC_IP || '192.168.1.11';

const keyPath =
  process.env.HTTPS_KEY_PATH || path.join(__dirname, 'certs', '192.168.1.11-key.pem');
const certPath =
  process.env.HTTPS_CERT_PATH || path.join(__dirname, 'certs', '192.168.1.11.pem');

let server;
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const credentials = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
  server = https.createServer(credentials, app);
  console.log('🔐 Servidor a correr em HTTPS');
} else {
  server = http.createServer(app);
  console.log('🚀 Servidor a correr em HTTP (sem certificados)');
}

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.length === 0) {
        return cb(null, true);
      }
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS (socket)'));
    },
    credentials: true,
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('🟢 Socket conectado:', socket.id);
  socket.on('disconnect', () => console.log('🔴 Socket desconectado:', socket.id));
});

(async () => {
  try {
    await connectDB();
    process.on('unhandledRejection', (r) => console.error('unhandledRejection', r));
    process.on('uncaughtException',  (e) => console.error('uncaughtException', e));
    server.listen(PORT, HOST, () => {
      const scheme = server instanceof https.Server ? 'https' : 'http';
      console.log(`🌐 Porta: ${PORT}`);
      console.log(`➡️  LAN:   ${scheme}://${PUBLIC_IP}:${PORT}`);
      console.log(`➡️  Local: ${scheme}://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('Falha a ligar à base de dados:', e);
    process.exit(1);
  }
})();
