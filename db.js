const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

function connectDB() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI não definida no .env');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);

  mongoose
    .connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    })
    .then(() => console.log('✅ MongoDB conectado'))
    .catch((err) => {
      console.error('❌ Erro ao conectar no MongoDB:', err.message);
      process.exit(1);
    });

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB desconectado');
  });
}

module.exports = connectDB;
