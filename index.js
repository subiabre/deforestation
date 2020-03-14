var express = require('express'),
    app = express(),
    Deforestation = require('./src/bot'),
    bot = new Deforestation();

app.get('/status', (req, res) => {
    res.send(bot.getLog());
});

var listener = app.listen(process.env.PORT, async () => {
    let address = 'http://localhost:' + listener.address().port;
    console.log('SERVER LISTENING AT: ' + address);
    console.log('REPORTING STATUS AT: ' + address + '/status');

    await bot.routine();
});
