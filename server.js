require('dotenv').config();

const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log('');
    console.log('🎭 ═══════════════════════════════════════════');
    console.log('   Poetry Platform API — Server Started');
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log('🎭 ═══════════════════════════════════════════');
    console.log('');
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
