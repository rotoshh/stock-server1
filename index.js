require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const userPortfolios = {};  // { userId: { alpacaKeys, stocks: { symbol: { stopLoss, sold } }, sellApiUrl } }
const userPrices = {};      // { userId: { symbol: { price, time } } }

// קבלת תיק ועדכון API של Alpaca
app.post('/update-portfolio', (req, res) => {
  const { userId, stocks, sellApiUrl, alpacaKeys } = req.body;

  if (!userId || !stocks || !sellApiUrl || !alpacaKeys || !alpacaKeys.key || !alpacaKeys.secret) {
    return res.status(400).json({ error: 'חסרים userId, stocks, sellApiUrl או alpacaKeys' });
  }

  userPortfolios[userId] = { stocks, sellApiUrl, alpacaKeys };
  console.log(`📦 תיק עודכן עבור ${userId}`);
  res.json({ message: 'תיק נשמר בהצלחה' });
});

// שליחת מחירים בזמן אמת לפי משתמש
app.get('/prices/:userId', (req, res) => {
  const { userId } = req.params;
  const portfolio = userPortfolios[userId];
  const prices = userPrices[userId];

  if (!portfolio || !prices) {
    return res.status(404).json({ error: 'לא נמצאו מחירים או תיק למשתמש' });
  }

  const response = {};
  for (const [symbol, data] of Object.entries(portfolio.stocks)) {
    response[symbol] = {
      currentPrice: prices[symbol]?.price || null,
      lastUpdate: prices[symbol]?.time || null,
      stopLoss: data.stopLoss,
      sold: data.sold || false
    };
  }
  res.json({ userId, stocks: response });
});

// שליפת מחירים מ-Alpaca ובדיקת סטופ-לוס
async function checkAndUpdatePrices() {
  for (const [userId, portfolio] of Object.entries(userPortfolios)) {
    const { stocks, alpacaKeys, sellApiUrl } = portfolio;
    if (!userPrices[userId]) userPrices[userId] = {};

    for (const [symbol, data] of Object.entries(stocks)) {
      try {
        const response = await axios.get(
          `https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest`,
          {
            headers: {
              'APCA-API-KEY-ID': alpacaKeys.key,
              'APCA-API-SECRET-KEY': alpacaKeys.secret
            }
          }
        );

        const currentPrice = response.data.quote.ap;
        const timestamp = new Date();

        userPrices[userId][symbol] = { price: currentPrice, time: timestamp };

        console.log(`📈 ${userId} - ${symbol}: $${currentPrice} (סטופ: ${data.stopLoss})`);

        if (currentPrice <= data.stopLoss && !data.sold) {
          console.log(`🚨 ${symbol} הגיע לסטופ-לוס עבור ${userId}`);

          try {
            await axios.post(sellApiUrl, {
              userId,
              symbol,
              price: currentPrice,
              time: timestamp
            });
            data.sold = true;
            console.log(`✅ פקודת מכירה נשלחה עבור ${symbol}`);
          } catch (error) {
            console.error(`❌ שגיאה בשליחת מכירה ל-${sellApiUrl}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`❌ שגיאה בשליפת ${symbol} עבור ${userId}:`, error.message);
      }
    }
  }
}

setInterval(checkAndUpdatePrices, 60 * 1000);
checkAndUpdatePrices();

app.get('/', (req, res) => {
  res.send('✅ השרת פעיל ומשתמש ב-Alpaca למחירים בזמן אמת');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 מאזין על פורט ${PORT}`);
});
