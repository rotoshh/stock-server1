require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // כדי לאפשר קבלת JSON בבקשות POST

const API_KEY = process.env.API_KEY;

console.log("🔧 השרת פועל עם מפתח API:", API_KEY);

// רשימת מניות למעקב
const symbols = ['AAPL', 'MSFT', 'GOOGL'];
let stockPrices = {}; // מחירים עדכניים
let stopLosses = {};  // מחירי סטופ לוס

// שליחת מחירים עדכניים מהשרת
app.get('/prices', (req, res) => {
  res.json(stockPrices);
});

// קבלת מחיר סטופ לוס מהאתר
app.post('/set-stop-loss', (req, res) => {
  const { symbol, stopLoss } = req.body;

  if (!symbol || !stopLoss) {
    return res.status(400).json({ error: 'חובה לשלוח גם symbol וגם stopLoss' });
  }

  stopLosses[symbol.toUpperCase()] = parseFloat(stopLoss);
  console.log(`📉 נקבע סטופ לוס ל-${symbol.toUpperCase()}: $${stopLoss}`);
  res.json({ message: `הסטופ-לוס עבור ${symbol.toUpperCase()} נשמר בהצלחה.` });
});

// פונקציה שמביאה מחירי מניות מה-API כל דקה
async function fetchStockPrices() {
  for (let symbol of symbols) {
    try {
      const res = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`);
      const currentPrice = res.data.c;

      stockPrices[symbol] = {
        price: currentPrice,
        time: new Date()
      };

      console.log(`✅ ${symbol}: $${currentPrice}`);

      // בדיקת סטופ לוס
      const stopLoss = stopLosses[symbol];
      if (stopLoss && currentPrice <= stopLoss) {
        console.log(`🚨 ${symbol} הגיע לסטופ לוס! מחיר: $${currentPrice} <= $${stopLoss}`);
        
        // כאן ניתן לבצע פעולה אמיתית (אם בעתיד תשלב API של ברוקר)
        delete stopLosses[symbol]; // מסיר את הסטופ-לוס לאחר "מכירה"
      }

    } catch (error) {
      console.error(`❌ שגיאה במחיר של ${symbol}:`, error.message);
    }
  }
}

// עדכון מחירים כל דקה
setInterval(fetchStockPrices, 60 * 1000);
fetchStockPrices();

// הרצת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ השרת פועל על פורט ${PORT} - כתובת: http://localhost:${PORT}/prices`);
});


