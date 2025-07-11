require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const userPortfolios = {};  // { userId: { alpacaKeys?, stocks: { symbol: { stopLoss, quantity, sold } } } }
const userPrices = {};      // { userId: { symbol: { price, time } } }
const userNotifications = new Map();

const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_RISK_API = 'https://riskwise-app.base44.com/api/recalculate-risk';

// ================ תפעול תיקים ===================
app.post('/update-portfolio', (req, res) => {
  const { userId, stocks, alpacaKeys } = req.body;
  if (!userId || !stocks) {
    return res.status(400).json({ error: 'חסר userId או stocks' });
  }
  userPortfolios[userId] = { stocks, alpacaKeys };
  console.log(`📦 תיק עודכן עבור ${userId}`);
  res.json({ message: 'התיק נשמר בהצלחה' });
});

// ========= שליפת מחירים ==========
async function getPriceForSymbol(symbol, alpacaKeys) {
  if (alpacaKeys) {
    try {
      const res = await axios.get(`https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest`, {
        headers: {
          'APCA-API-KEY-ID': alpacaKeys.key,
          'APCA-API-SECRET-KEY': alpacaKeys.secret
        }
      });
      return res.data.quote?.ap || null;
    } catch (err) {
      console.error(`❌ שגיאה בשליפת מחיר מ-Alpaca עבור ${symbol}:`, err.message);
      return null;
    }
  } else {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return null;
    try {
      const res = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${token}`);
      return res.data.c || null;
    } catch (err) {
      console.error(`❌ שגיאה בשליפת מחיר מ-Finnhub עבור ${symbol}:`, err.message);
      return null;
    }
  }
}

// ========= מכירה ==========
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
    await axios.post(url, order, {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret
      }
    });
    console.log(`✅ פקודת מכירה נשלחה עבור ${symbol} (${quantity}) של ${userId}`);
  } catch (err) {
    console.error(`❌ שגיאה בשליחת מכירה ל-Alpaca עבור ${symbol}:`, err.message);
  }
}

function simulateSell(userId, symbol, quantity) {
  console.log(`🟡 סימולציית מכירה למניה ${symbol} של ${userId} (${quantity})`);
}

function onStopLossTriggered(userId, symbol, price, stopLoss) {
  if (!userNotifications.has(userId)) {
    userNotifications.set(userId, []);
  }
  const notification = {
    id: Date.now() + Math.random(),
    type: 'stop_loss',
    message: `מניית ${symbol} הגיעה ל-Stop Loss! מחיר: $${price}, Stop Loss: $${stopLoss}`,
    timestamp: new Date().toISOString(),
    stockTicker: symbol,
    price,
    stopLossPrice: stopLoss,
    read: false
  };
  userNotifications.get(userId).push(notification);
  console.log(`🚨 התראה נוספה למשתמש ${userId}:`, notification.message);
}

// ========= בדיקת מחירים וסטופ ==========
async function checkAndUpdatePrices() {
  for (const [userId, { stocks, alpacaKeys }] of Object.entries(userPortfolios)) {
    if (!userPrices[userId]) userPrices[userId] = {};

    for (const [symbol, data] of Object.entries(stocks)) {
      if (data.sold) continue;

      const price = await getPriceForSymbol(symbol, alpacaKeys);
      const time = new Date();

      if (price !== null) {
        userPrices[userId][symbol] = { price, time };
        console.log(`📈 ${userId} - ${symbol}: $${price} (סטופ: ${data.stopLoss})`);

        if (price <= data.stopLoss) {
          if (alpacaKeys) {
            await sellWithAlpaca(userId, symbol, data.quantity || 1, alpacaKeys.key, alpacaKeys.secret);
          } else {
            simulateSell(userId, symbol, data.quantity || 1);
            onStopLossTriggered(userId, symbol, price, data.stopLoss);
          }
          data.sold = true;
        }
      }
    }
  }
}

// ========= חישוב סיכון ==========
async function checkRiskTriggers() {
  if (!BASE44_API_KEY) return;

  for (const [userId, { stocks, alpacaKeys }] of Object.entries(userPortfolios)) {
    const previous = userPrices[userId] || {};

    for (const [symbol, data] of Object.entries(stocks)) {
      if (data.sold) continue;

      const newPrice = await getPriceForSymbol(symbol, alpacaKeys);
      const time = new Date();
      if (!newPrice) continue;

      const oldPrice = previous[symbol]?.price || newPrice;
      const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;
      userPrices[userId][symbol] = { price: newPrice, time };

      if (Math.abs(changePercent) >= 5) {
        try {
          await axios.post(BASE44_RISK_API, {
            userId,
            symbol,
            reason: `Price changed by ${changePercent.toFixed(2)}%`,
            currentPrice: newPrice
          }, {
            headers: {
              Authorization: `Bearer ${BASE44_API_KEY}`,
              'Content-Type': 'application/json'
            }
          });
          console.log(`✅ חישוב סיכון נשלח עבור ${symbol} של ${userId}`);
        } catch (err) {
          console.error(`❌ שגיאה בשליחת חישוב סיכון ל-${symbol}:`, err.message);
        }
      }
    }
  }
}

// ========= API ==========
app.get('/notifications/:userId', (req, res) => {
  const userId = req.params.userId;
  const notifications = userNotifications.get(userId) || [];
  res.json({ notifications: notifications.filter(n => !n.read) });
});

app.post('/notifications/:userId/:notificationId/read', (req, res) => {
  const { userId, notificationId } = req.params;
  const notifications = userNotifications.get(userId) || [];
  const note = notifications.find(n => n.id == notificationId);
  if (note) note.read = true;
  res.json({ success: true });
});

app.get('/prices/:userId', (req, res) => {
  const { userId } = req.params;
  const portfolio = userPortfolios[userId];
  const prices = userPrices[userId];

  if (!portfolio || !prices) {
    return res.status(404).json({ error: 'לא נמצא תיק או מחירים עבור המשתמש' });
  }

  const result = {};
  for (const [symbol, data] of Object.entries(portfolio.stocks)) {
    result[symbol] = {
      currentPrice: prices[symbol]?.price || null,
      lastUpdate: prices[symbol]?.time || null,
      stopLoss: data.stopLoss,
      sold: data.sold || false
    };
  }

  res.json({ userId, stocks: result });
});

app.get('/', (req, res) => {
  res.send('✅ השרת פועל עם Alpaca, Finnhub ו־Base44!');
});

setInterval(checkAndUpdatePrices, 60 * 1000);
setInterval(checkRiskTriggers, 30 * 60 * 1000);
checkAndUpdatePrices();
checkRiskTriggers();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 השרת מאזין על פורט ${PORT}`);
});
