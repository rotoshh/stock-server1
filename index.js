require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// זיכרון זמני - תיקים של משתמשים
const userPortfolios = {};  // { userId: { apiKey, sellApiUrl, stocks: { symbol: { stopLoss, sold } } } }
const userPrices = {};      // { userId: { symbol: { price, time } } }

// קבלת תיק מהאתר (עדכון או יצירת חדש)
app.post('/update-portfolio', (req, res) => {
  const { userId, apiKey, stocks, sellApiUrl } = req.body;

  if (!userId || !apiKey || !stocks || !sellApiUrl) {
    return res.status(400).json({ error: 'חסרים userId, apiKey, stocks או sellApiUrl' });
  }

  userPortfolios[userId] = { apiKey, stocks, sellApiUrl };
  console.log(`📦 התקבל תיק חדש או עודכן עבור ${userId}`);

  res.json({ message: 'התיק נשמר בהצלחה' });
});

// שליפת מחירים בזמן אמת לפי משתמש
app.get('/prices/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userPrices[userId]) {
    return res.status(404).json({ error: 'לא נמצאו מחירים עבור המשתמש' });
  }
  res.json(userPrices[userId]);
});

// בדיקת מחירים וביצוע מכירה במידת הצורך
async function checkAndUpdatePrices() {
  for (const [userId, portfolio] of Object.entries(userPortfolios)) {
    const { apiKey, stocks, sellApiUrl } = portfolio;

    if (!userPrices[userId]) userPrices[userId] = {};

    for (const [symbol, data] of Object.entries(stocks)) {
      try {
        const response = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
        const currentPrice = response.data.c;
        const timestamp = new Date();

        // שמירת מחיר עדכני לזיכרון
        userPrices[userId][symbol] = { price: currentPrice, time: timestamp };

        console.log(`📈 ${userId} - ${symbol}: $${currentPrice} (סטופ: ${data.stopLoss})`);

        // בדיקה האם המחיר ירד מתחת לסטופ לוס
        if (currentPrice <= data.stopLoss && !data.sold) {
          console.log(`🚨 ${symbol} ירד לסטופ-לוס עבור ${userId} - שולח פקודת מכירה`);

          try {
            await axios.post(sellApiUrl, {
              userId,
              symbol,
              price: currentPrice,
              time: timestamp
            });

            data.sold = true;
            console.log(`✅ נשלחה פקודת מכירה ל-${sellApiUrl} עבור ${symbol}`);
          } catch (err) {
            console.error(`❌ שגיאה בשליחת מכירה ל-${sellApiUrl}:`, err.message);
          }
        }

      } catch (err) {
        console.error(`❌ שגיאה בשליפת ${symbol} עבור ${userId}:`, err.message);
      }
    }
  }
}

// הפעלת בדיקה כל דקה
setInterval(checkAndUpdatePrices, 60 * 1000);
checkAndUpdatePrices();

// שורש פשוט לבדיקת חיים
app.get('/', (req, res) => {
  res.send('✅ השרת פועל! שלח תיקים לכתובת /update-portfolio');
});

// הרצת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 השרת מאזין על פורט ${PORT}`);
});
