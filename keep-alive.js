const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'active',
    timestamp: Date.now()
  });
});

app.listen(PORT, () => {
  console.log(`✅ Keep-alive activo en puerto ${PORT}`);
});