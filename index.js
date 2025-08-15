const log = require('./logger');

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// ---- CORS + JSON SAFE ----
const allowedOrigins = [
  'https://app.base44.com/apps/684c3006b888b466396ab87e/editor/preview/Dashboard',   // החלף בדומיין של האתר ב-VibeCoding
  'http://localhost:3000',          // לפיתוח מקומי (אם צריך)
];

app.use(cors({
  origin: (origin, cb) => {
    // לאפשר גם Postman/שרתים ללא Origin
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // לא לאפשר דומיינים לא מוכרים (אפשר להקל אם צריך)
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));

// לאפשר Preflight לכל הנתיבים
app.options('*', cors());

// להגדיל את מגבלת גוף ה-JSON (למקרה של תיקים גדולים)
app.use(express.json({ limit: '1mb' }));

const userPortfolios = {};
const userPrices = {};
const userNotifications = new Map();

const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_RISK_API = 'https://riskwise-app.base44.com/api/recalculate-risk';

app.post('/update-portfolio', (req, res) => {
  const { userId, stocks, alpacaKeys } = req.body;
  if (!userId || !stocks) {
    return res.status(400).json({ error: 'חסר userId או stocks' });
  }
  userPortfolios[userId] = { stocks, alpacaKeys };
  log.info(`📦 תיק עודכן עבור ${userId}`);
  res.json({ message: 'התיק נשמר בהצלחה' });
});

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
      log.error(`❌ שגיאה בשליפת מחיר מ-Alpaca עבור ${symbol}: ${err.message}`);
      return null;
    }
  } else {
    const token = process.env.FINNHUB_API_KEY;
    if (!token) return null;
    try {
      const res = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${token}`);
      return res.data.c || null;
    } catch (err) {
      log.error(`❌ שגיאה בשליפת מחיר מ-Finnhub עבור ${symbol}: ${err.message}`);
      return null;
    }
  }
}

async function getQuoteForSymbol(symbol, alpacaKeys) {
  try {
    if (alpacaKeys) {
      const { data: quoteData } = await axios.get(`https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest`, {
        headers: {
          'APCA-API-KEY-ID': alpacaKeys.key,
          'APCA-API-SECRET-KEY': alpacaKeys.secret
        }
      });
      const { data: barsData } = await axios.get(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&limit=2`, {
        headers: {
          'APCA-API-KEY-ID': alpacaKeys.key,
          'APCA-API-SECRET-KEY': alpacaKeys.secret
        }
      });
      const todayBar = barsData.bars[1];
      const yesterdayBar = barsData.bars[0];
      return {
        latestPrice: quoteData.quote.ap,
        open: todayBar.o,
        previousClose: yesterdayBar.c
      };
    } else {
      const token = process.env.FINNHUB_API_KEY;
      const [quoteRes, candleRes] = await Promise.all([
        axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${token}`),
        axios.get(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&count=2&token=${token}`)
      ]);
      const candleData = candleRes.data;
      return {
        latestPrice: quoteRes.data.c,
        open: candleData.o[1],
        previousClose: candleData.c[0]
      };
    }
  } catch (err) {
    log.error(`❌ שגיאה בשליפת quote ל-${symbol}: ${err.message}`);
    return null;
  }
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

async function sendRiskUpdate(userId, symbol, reason, currentPrice) {
  try {
    await axios.post(BASE44_RISK_API, {
      userId,
      symbol,
      reason,
      currentPrice
    }, {
      headers: {
        Authorization: `Bearer ${BASE44_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    log.info(`📊 חישוב סיכון נשלח עבור ${symbol} של ${userId} (${reason})`);
  } catch (err) {
    log.error(`❌ שגיאה בשליחת חישוב סיכון ל-${symbol}: ${err.message}`);
  }
}

async function checkVolatilityTriggers() {
  if (!BASE44_API_KEY) return;

  log.info('🔍 התחלת בדיקת תנודתיות המחירים...');

  for (const [userId, { stocks, alpacaKeys }] of Object.entries(userPortfolios)) {
    const previous = userPrices[userId] || {};
    userPrices[userId] = previous;

    for (const [symbol, data] of Object.entries(stocks)) {
      if (data.sold) continue;

      const quote = await getQuoteForSymbol(symbol, alpacaKeys);
      if (!quote || !quote.latestPrice) continue;

      const now = new Date();
      const oldData = previous[symbol] || {};
      const oldPrice = oldData.price || quote.latestPrice;

      if (!oldData.openPrice || !oldData.previousClose || !isSameDay(now, new Date(oldData.time))) {
        previous[symbol] = {
          price: quote.latestPrice,
          openPrice: quote.open,
          previousClose: quote.previousClose,
          time: now
        };
        continue;
      }

      const dailyChange = ((quote.latestPrice - oldData.openPrice) / oldData.openPrice) * 100;
      const gapChange = ((oldData.openPrice - oldData.previousClose) / oldData.previousClose) * 100;

      previous[symbol] = {
        price: quote.latestPrice,
        openPrice: oldData.openPrice,
        previousClose: oldData.previousClose,
        time: now
      };

      if (Math.abs(dailyChange) >= 5) {
        await sendRiskUpdate(userId, symbol, `Intraday price changed by ${dailyChange.toFixed(2)}%`, quote.latestPrice);
      }

      if (Math.abs(gapChange) >= 5) {
        await sendRiskUpdate(userId, symbol, `Open vs previous close gap: ${gapChange.toFixed(2)}%`, quote.latestPrice);
      }
    }
  }
}

async function checkAndUpdatePrices() {
  for (const [userId, { stocks, alpacaKeys }] of Object.entries(userPortfolios)) {
    if (!userPrices[userId]) userPrices[userId] = {};

    for (const [symbol, data] of Object.entries(stocks)) {
      if (data.sold) continue;

      const price = await getPriceForSymbol(symbol, alpacaKeys);
      const time = new Date();

      if (price !== null) {
        userPrices[userId][symbol] = { ...(userPrices[userId][symbol] || {}), price, time };
        log.info(`📈 ${userId} - ${symbol}: $${price} (סטופ: ${data.stopLoss})`);

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
      userPrices[userId][symbol] = { ...(userPrices[userId][symbol] || {}), price: newPrice, time };

      if (Math.abs(changePercent) >= 5) {
        await sendRiskUpdate(userId, symbol, `Price changed by ${changePercent.toFixed(2)}%`, newPrice);
      }
    }
  }
}

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
    log.info(`✅ פקודת מכירה נשלחה עבור ${symbol} (${quantity}) של ${userId}`);
  } catch (err) {
    log.error(`❌ שגיאה בשליחת מכירה ל-Alpaca עבור ${symbol}: ${err.message}`);
  }
}

function simulateSell(userId, symbol, quantity) {
  log.info(`🟡 סימולציית מכירה למניה ${symbol} של ${userId} (${quantity})`);
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
  log.info(`🚨 התראה נוספה למשתמש ${userId}: ${notification.message}`);
}

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
setInterval(checkVolatilityTriggers, 15 * 60 * 1000);

checkAndUpdatePrices();
checkRiskTriggers();
checkVolatilityTriggers();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log.info(`🚀 השרת מאזין על פורט ${PORT}`);
});
