// Populates the env vars `env.ts` requires before any test module imports it.
// Mongo/Redis values are placeholders — auth tests connect directly to an
// in-memory Mongo instance and never call connectMongo().
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-only-secret-not-for-production'
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test'
process.env.REDIS_URL = 'redis://127.0.0.1:6379'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
process.env.STRIPE_PRICE_ID_PRO = 'price_test_dummy'
process.env.CLIENT_URL = 'http://localhost:5173'
