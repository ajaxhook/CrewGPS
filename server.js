// server.js
require('dotenv').config();

// --- Compat: aceitar MONGODB_URI no .env ---
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

// só agora, depois do compat MONGO_URI
const connectDB = require('./db');

const app = express();

/* ===================== Segurança e parsing ===================== */
/* ===================== Segurança e parsing ===================== */
app.use(
  helmet({
    // Google Maps e afins não jogam bem com COEP/COOP por defeito
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],

        // precisas de inline + CDNs usados
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.tailwindcss.com",
          "https://maps.googleapis.com",
          "https://maps.gstatic.com"
        ],

        // tens <style> inline e Google Fonts
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],

        // avatares em data:, blobs de canvas, placehold.co e assets do Maps
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://placehold.co",
          "https://maps.gstatic.com",
          "https://maps.googleapis.com"
        ],

        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],

        // fetch a APIs + Maps
        connectSrc: ["'self'", "https://maps.googleapis.com", "https://maps.gstatic.com"],

        manifestSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    }
  })
);


const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ===================== Static ===================== */
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

/* ===================== Rotas da API ===================== */
app.use('/api/users', require('./routes/users'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/invites', require('./routes/invites'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/garage', require('./routes/garage'));
app.use('/api/reset-password', require('./routes/resetPassword'));

/* ===================== Healthcheck ===================== */
app.get('/healthz', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

/* ===================== 404 ===================== */
app.use((req, res, next) => {
  res.status(404).json({ message: 'Rota não encontrada' });
});

/* ===================== Handler de erro ===================== */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = res.statusCode >= 400 ? res.statusCode : 500;
  console.error(err);
  res.status(status).json({ message: err.message || 'Erro interno do servidor' });
});

/* ===================== DB & Servidor ===================== */
connectDB();

const HOST = process.env.HOST || '0.0.0.0';            // ouvir em todas as interfaces
const PORT = Number(process.env.PORT) || 3000;         // porta 3000
const PUBLIC_IP = process.env.PUBLIC_IP || '192.168.1.11'; // IP da tua LAN p/ logs

// paths para certs (env ou defaults em ./certs)
const keyPath =
  process.env.HTTPS_KEY_PATH || path.join(__dirname, 'certs', 'server.key');
const certPath =
  process.env.HTTPS_CERT_PATH || path.join(__dirname, 'certs', 'server.crt');

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
  console.log(
    'ℹ️ Para HTTPS, coloca os ficheiros:',
    `\n   ${keyPath}\n   ${certPath}`,
    '\n   ou define HTTPS_KEY_PATH / HTTPS_CERT_PATH no .env'
  );
}

/* ===================== Socket.io ===================== */
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
});

// tornar io acessível nas rotas se necessário
app.set('io', io);

io.on('connection', (socket) => {
  console.log('🟢 Socket conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('🔴 Socket desconectado:', socket.id);
  });
});

server.listen(PORT, HOST, () => {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  console.log(`🌐 Porta: ${PORT}`);
  console.log(`➡️  LAN:   ${scheme}://${PUBLIC_IP}:${PORT}`);
  console.log(`➡️  Local: ${scheme}://localhost:${PORT}`);
});
