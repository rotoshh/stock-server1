require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// תיקים של משתמשים בזיכרון
const userPortfolios = {};  // { userId: { alpacaKeys: { key, secret }, stocks: { symbol: { stopLoss, quantity, sold } } } }
const userPrices = {};      // { userId: { symbol: { price, time } } }

// קבלת תיק מהאתר
app.post('/update-portfolio', (req, res) => {
  const { userId, alpacaKeys, stocks } = req.body;

  if (!userId || !alpacaKeys?.key || !alpacaKeys?.secret || !stocks) {
    return res.status(400).json({ error: 'חסרים שדות חובה: userId, alpacaKeys, stocks' });
  }

  userPortfolios[userId] = { alpacaKeys, stocks };
  console.log(📦 תיק עודכן עבור ${userId});
  res.json({ message: 'התיק נשמר בהצלחה' });
});

// שליפת מחירים לפי משתמש
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

// שליחת פקודת מכירה ל-Alpaca
async function sellWithAlpaca(userId, symbol, quantity, alpacaKey, alpacaSecret) {
  const url = 'https://paper-api.alpaca.markets/v2/orders';

  const order = {
    symbol,
    qty: quantity,
    side: 'sell',
    type: 'market',
    time_in_force: 'gtc'
  };

  try {
    const res = await axios.post(url, order, {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret
      }
    });
    console.log(✅ פקודת מכירה נשלחה עבור ${symbol} (${quantity}) של ${userId});
  } catch (err) {
    console.error(❌ שגיאה בשליחת מכירה ל-Alpaca עבור ${symbol}:, err.message);
  }
}

// שליפת מחיר מממשק Alpaca
async function getAlpacaPrice(symbol, alpacaKey, alpacaSecret) {
  const url = https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest;

  try {
    const res = await axios.get(url, {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret
      }
    });

    return res.data.quote.ap; // ask price
  } catch (err) {
    console.error(❌ שגיאה בשליפת מחיר מ-Alpaca עבור ${symbol}:, err.message);
    return null;
  }
}

// בדיקת מחירים ומכירה לפי סטופ-לוס
async function checkAndUpdatePrices() {
  for (const [userId, portfolio] of Object.entries(userPortfolios)) {
    const { alpacaKeys, stocks } = portfolio;
    if (!userPrices[userId]) userPrices[userId] = {};

    for (const [symbol, data] of Object.entries(stocks)) {
  if (data.sold) {
    continue; // דלג על מניות שנמכרו
  }

      const price = await getAlpacaPrice(symbol, alpacaKeys.key, alpacaKeys.secret);
      const time = new Date();

      if (price !== null) {
        userPrices[userId][symbol] = { price, time };

        console.log(📈 ${userId} - ${symbol}: $${price} (סטופ: ${data.stopLoss}));

        if (price <= data.stopLoss && !data.sold) {
          console.log(🚨 ${symbol} הגיע לסטופ לוס עבור ${userId}, מבצע מכירה...);
          await sellWithAlpaca(userId, symbol, data.quantity || 1, alpacaKeys.key, alpacaKeys.secret);
          data.sold = true;
        }
      }
    }
  }
}

setInterval(checkAndUpdatePrices, 60 * 1000);
checkAndUpdatePrices();

// בדיקת חיים
app.get('/', (req, res) => {
  res.send('✅ השרת פועל עם Alpaca בלבד!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(🚀 השרת מאזין על פורט ${PORT});
});

const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_RISK_API = 'https://riskwise-app.base44.com/api/recalculate-risk';

// בדיקת שינויים שדורשים חישוב רמת סיכון מחדש
async function checkRiskTriggers() {
  for (const [userId, portfolio] of Object.entries(userPortfolios)) {
    const { alpacaKeys, stocks } = portfolio;
    const userPrevPrices = userPrices[userId] || {};

    for (const [symbol, data] of Object.entries(stocks)) {
      const newPrice = await getAlpacaPrice(symbol, alpacaKeys.key, alpacaKeys.secret);
      const time = new Date();

      if (!newPrice) continue;

      const oldPrice = userPrevPrices[symbol]?.price || newPrice;
      userPrices[userId][symbol] = { price: newPrice, time };

      const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

      if (Math.abs(changePercent) >= 5) {
        console.log(⚠ שינוי חד במחיר ${symbol} (${changePercent.toFixed(2)}%) עבור ${userId}. שולח חישוב סיכון חדש...);

        try {
          await axios.post(BASE44_RISK_API, {
            userId,
            symbol,
            reason: Price changed by ${changePercent.toFixed(2)}%,
            currentPrice: newPrice
          }, {
            headers: {
              'Authorization': Bearer ${BASE44_API_KEY},
              'Content-Type': 'application/json'
            }
          });

          console.log(✅ נשלחה בקשת חישוב סיכון מחודש עבור ${symbol} של ${userId});
        } catch (err) {
          console.error(❌ שגיאה בשליחת בקשת חישוב סיכון ל-${symbol}:, err.message);
        }
      }
    }
  }
}
setInterval(checkRiskTriggers, 30 * 60 * 1000);
checkRiskTriggers(); // ריצה מיידית בהתחלה
if (!BASE44_API_KEY) {
  console.warn('⚠ לא הוגדר BASE44_API_KEY בקובץ .env – לא תתבצע שליחת חישובי סיכון.');
  return;
}