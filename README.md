# Doors22 Backend - AI Automation Engine

**Version:** 1.0.0
**Developer:** Cyberix Digital
**Client:** Doors22

---

## 📖 Overview

Backend automation engine that powers the Doors22 AI social media system. Handles content generation, trend analysis, posting automation, and interaction management.

---

## 🚀 Features

- **Daily Trend Analysis** - AI-powered market research
- **Content Generation** - Midjourney image creation
- **Caption Generator** - GPT-4 powered captions & hashtags
- **Automated Posting** - Instagram & Facebook scheduling
- **Smart Interactions** - AI responses to comments & DMs
- **Analytics** - Performance tracking and optimization

---

## 📁 Project Structure

```
doors22-backend/
├── src/
│   ├── config/           # Configuration files
│   │   ├── firebase.js
│   │   ├── cloudinary.js
│   │   ├── openai.js
│   │   └── discord.js
│   ├── services/         # Business logic services
│   │   ├── aiEngine.js
│   │   ├── cloudinary.service.js
│   │   ├── midjourney.service.js
│   │   ├── meta.service.js
│   │   └── analytics.service.js
│   ├── controllers/      # Route controllers
│   │   ├── trendController.js
│   │   ├── contentController.js
│   │   ├── postController.js
│   │   └── interactionController.js
│   ├── cron/             # Scheduled jobs
│   │   ├── dailyTrends.js
│   │   ├── contentGeneration.js
│   │   ├── posting.js
│   │   └── analytics.js
│   ├── routes/           # API routes
│   │   └── index.js
│   ├── middleware/       # Express middleware
│   │   ├── auth.js
│   │   ├── errorHandler.js
│   │   └── rateLimiter.js
│   ├── utils/            # Utility functions
│   │   ├── logger.js
│   │   └── helpers.js
│   └── server.js         # Main entry point
├── .env.example          # Environment template
├── .gitignore
├── package.json
└── README.md
```

---

## ⚙️ Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required credentials:
- Firebase Admin SDK
- Cloudinary API
- OpenAI API Key
- Discord Bot Token
- Meta (Facebook/Instagram) API

### 3. Add Firebase Service Account

Download your Firebase service account JSON and save as:
```
firebase-service-account.json
```

---

## 🏃 Running the Server

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

---

## 📅 Cron Jobs

Automated tasks run on schedule:

- **3:00 AM UTC** - Daily trend analysis
- **3:15 AM UTC** - Content generation (Midjourney)
- **5:00 PM UTC** - Auto-posting to Instagram/Facebook
- **Sunday 12 AM** - Weekly analytics report

---

## 🔌 API Endpoints

### Health Check
```
GET /api/health
```

### Posts
```
GET    /api/posts           # Get all posts
GET    /api/posts/:id       # Get single post
POST   /api/posts           # Create post (manual)
DELETE /api/posts/:id       # Delete post
```

### Trends
```
GET    /api/trends          # Get trend analysis
POST   /api/trends/analyze  # Trigger manual analysis
```

### Analytics
```
GET    /api/analytics       # Get weekly analytics
GET    /api/analytics/:id   # Get specific week
```

---

## 🧪 Testing

```bash
npm test
```

---

## 📦 Deployment

### Vercel

```bash
vercel --prod
```

Environment variables must be configured in Vercel dashboard.

---

## 🔒 Security

- All credentials in environment variables
- Rate limiting on all endpoints
- Firebase Admin SDK (server-side only)
- Webhook signature verification
- CORS configured

---

## 📝 Environment Variables

See `.env.example` for complete list of required variables.

---

## 🐛 Troubleshooting

**Firebase connection failed:**
- Verify `firebase-service-account.json` exists
- Check `FIREBASE_PROJECT_ID` matches your project

**Cloudinary upload failed:**
- Verify API credentials
- Check image file format (JPG, PNG supported)

**OpenAI API error:**
- Verify API key is valid
- Check billing/quota limits

---

## 📞 Support

**Developer:** Cyberix Digital
**Client:** Doors22
**Documentation:** See `/info` folder in root project

---

## 📄 License

MIT License - Proprietary to Doors22
