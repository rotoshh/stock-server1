require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// זיכרון זמני - תיקים של משתמשים
const userPortfolios = {};  // { userId: { apiKey, alpacaKeys: {key, secret}, stocks: { symbol: { stopLoss, sold } } } }
const userPrices = {};      // { userId: { symbol: { price, time } } }

// קבלת תיק מהאתר
app.post('/update-portfolio', (req, res) => {
  const { userId, apiKey, stocks, alpacaKeys } = req.body;

  if (!userId || !apiKey || !stocks || !alpacaKeys?.key || !alpacaKeys?.secret) {
    return res.status(400).json({ error: 'חסרים שדות חובה (userId, apiKey, stocks, alpacaKeys)' });
  }

  userPortfolios[userId] = { apiKey, stocks, alpacaKeys };
  console.log(`📦 תיק עודכן עבור ${userId}`);
  res.json({ message: 'התיק נשמר בהצלחה' });
});

// שליפת מחירים בזמן אמת
app.get('/prices/:userId', (req, res) => {
  const { userId } = req.params;
  const portfolio = userPortfolios[userId];
  const prices = userPrices[userId];

  if (!portfolio || !prices) {
    return res.status(404).json({ error: 'לא נמצא תיק או מחירים עבור המשתמש' });
  }

  const detailed = {};
  for (const [symbol, data] of Object.entries(portfolio.stocks)) {
    detailed[symbol] = {
      currentPrice: prices[symbol]?.price || null,
      lastUpdate: prices[symbol]?.time || null,
      stopLoss: data.stopLoss,
      sold: data.sold || false
    };
  }

  res.json({ userId, stocks: detailed });
});

// מכירה דרך Alpaca
async function sellWithAlpaca(userId, symbol, quantity, alpacaKey, alpacaSecret) {
  const orderUrl = 'https://paper-api.alpaca.markets/v2/orders';

  const order = {
    symbol,
    qty: quantity,
    side: 'sell',
    type: 'market',
    time_in_force: 'gtc'
  };

  try {
    const res = await axios.post(orderUrl, order, {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ פקודת מכירה ל-${symbol} נשלחה בהצלחה עבור ${userId}`);
  } catch (err) {
    console.error(`❌ שגיאה בשליחת מכירה ל-Alpaca עבור ${symbol}:`, err.message);
  }
}

// בדיקה וביצוע מכירות
async function checkAndUpdatePrices() {
  for (const [userId, portfolio] of Object.entries(userPortfolios)) {
    const { apiKey, stocks, alpacaKeys } = portfolio;

    if (!userPrices[userId]) userPrices[userId] = {};

    for (const [symbol, data] of Object.entries(stocks)) {
      try {
        const response = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
        const currentPrice = response.data.c;
        const timestamp = new Date();

        userPrices[userId][symbol] = { price: currentPrice, time: timestamp };
        console.log(`📈 ${userId} - ${symbol}: $${currentPrice} (סטופ: ${data.stopLoss})`);

        if (currentPrice <= data.stopLoss && !data.sold) {
          console.log(`🚨 ${symbol} הגיע לסטופ-לוס עבור ${userId} - מוכר דרך Alpaca`);
          await sellWithAlpaca(userId, symbol, data.quantity || 1, alpacaKeys.key, alpacaKeys.secret);
          data.sold = true;
        }

      } catch (err) {
        console.error(`❌ שגיאה בשליפת ${symbol} עבור ${userId}:`, err.message);
      }
    }
  }
}

setInterval(checkAndUpdatePrices, 60 * 1000);
checkAndUpdatePrices();

// בדיקת חיים
app.get('/', (req, res) => {
  res.send('✅ השרת פועל עם Alpaca!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 השרת מאזין על פורט ${PORT}`);
});
