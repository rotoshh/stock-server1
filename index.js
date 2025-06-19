require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const userPortfolios = {}; // שמירת תיקים לפי userId

// נקודת קבלה לתיק מהאתר
app.post('/update-portfolio', (req, res) => {
  const { userId, apiKey, stocks, sellApiUrl } = req.body;

  if (!userId || !apiKey || !stocks || !sellApiUrl) {
    return res.status(400).json({ error: 'Missing userId, apiKey, stocks or sellApiUrl' });
  }

  userPortfolios[userId] = { apiKey, stocks, sellApiUrl };
  console.log(`📦 עודכן תיק עבור ${userId}`);
  res.json({ message: 'Portfolio updated' });
});

// פונקציית בדיקה ומכירה אוטומטית
async function checkStopLosses() {
  for (const [userId, portfolio] of Object.entries(userPortfolios)) {
    const { apiKey, stocks, sellApiUrl } = portfolio;

    for (const [symbol, data] of Object.entries(stocks)) {
      try {
        const res = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
        const currentPrice = res.data.c;

        console.log(`🔍 ${userId} - ${symbol}: $${currentPrice} | Stop: ${data.stopLoss}`);

        if (currentPrice <= data.stopLoss && !data.sold) {
          console.log(`🚨 מכירה אוטומטית ${symbol} למשתמש ${userId} במחיר ${currentPrice}`);

          // שליחת מכירה ל-API של האתר שלך
          try {
            await axios.post(sellApiUrl, {
              userId,
              symbol,
              price: currentPrice,
              time: new Date()
            });
            data.sold = true; // סימון כמכורה
            console.log(`✅ נשלחה בקשת מכירה ל-API עבור ${symbol}`);
          } catch (err) {
            console.error(`❌ שגיאה בשליחת בקשת מכירה ל-API:`, err.message);
          }
        }
      } catch (err) {
        console.error(`❌ שגיאה בקבלת מחיר ${symbol} עבור ${userId}:`, err.message);
      }
    }
  }
}

// בדיקה כל 60 שניות
setInterval(checkStopLosses, 60 * 1000);

// דף ראשי
app.get('/', (req, res) => {
  res.send('✅ השרת פועל. שלח תיק לכתובת /update-portfolio');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 השרת פועל על פורט ${PORT}`);
});
