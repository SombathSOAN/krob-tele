# krob-tele

This repository contains a minimal Python example that loads its
configuration from `config.json`. You can modify the values in
`config.json` or change the `CONFIG` dictionary in `config.py` to suit
your needs.

It also includes a Telegram bot written in Node.js. The bot polls the
remote seller API for orders, vouchers and products and notifies users
via Telegram.

## Usage

### Python example

1. Edit `config.json` to adjust settings.
2. Run the script:

```bash
python3 main.py
```

You should see the current configuration values printed to the console.

### Telegram bot

1. Install dependencies (Node.js v18+ recommended):

```bash
npm install node-telegram-bot-api axios
```

2. Set the `TELEGRAM_TOKEN` environment variable to your BotFather token.
3. Run the bot:

```bash
node bot.js
```

The bot will exit immediately if the token is missing.
