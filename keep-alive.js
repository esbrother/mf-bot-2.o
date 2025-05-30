const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>MafiaBot</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #7289DA; }
      </style>
    </head>
    <body>
      <h1>🤖 MafiaBot está en línea</h1>
      <p>Este servidor mantiene activo el bot de música</p>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ Keep-alive en puerto ${PORT}`);
  console.log(`🔗 URL: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
});