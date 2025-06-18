require('dotenv').config();
const API_KEY = process.env.API_KEY;

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

console.log("🔧 השרת מתחיל לפעול עם המפתח:", API_KEY);

let stockPrices = {};
const symbols = ['AAPL', 'MSFT', 'GOOGL']; // תוכל להוסיף או לשנות

// פונקציה לשליפת מחירים
async function fetchStockPrices() {
  for (let symbol of symbols) {
    try {
      const res = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`);
      stockPrices[symbol] = {
        price: res.data.c,
        time: new Date()
      };
      console.log(`✅ ${symbol}: ${res.data.c}`);
    } catch (error) {
      console.error(`❌ שגיאה במחיר של ${symbol}:`, error.message);
    }
  }
}

// קריאה ראשונית וכל דקה
setInterval(fetchStockPrices, 60 * 1000);
fetchStockPrices();

// נתיב בסיסי "/" שיחזיר הודעה פשוטה
app.get('/', (req, res) => {
  res.send('✅ השרת פעיל! היכנס לנתיב /prices כדי לראות מחירים.');
});

// נתיב "/prices" שמחזיר את כל המחירים
app.get('/prices', (req, res) => {
  res.json(stockPrices);
});

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 השרת פועל על פורט ${PORT}`);
});


