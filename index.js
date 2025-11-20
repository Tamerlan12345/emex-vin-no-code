import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import { EmexParser } from './parser.js';
import { SpartexParser } from './spartex-parser.js';
import { RulimParser } from './rulim-parser.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Shared browser instance
let browser = null;

// Parser instances
let emexParser = null;
let spartexParser = null;
let rulimParser = null;

async function initBrowser() {
  console.log('🚀 Запуск общего браузера...');
  if (browser) {
      await browser.close().catch(() => {});
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080'
    ]
  });
  console.log('✅ Браузер запущен');
}

async function initParsers() {
  try {
    if (!browser || !browser.isConnected()) await initBrowser();

    // Инициализируем Emex
    emexParser = new EmexParser();
    await emexParser.init(browser);
    console.log('✅ Emex парсер готов');

    // Инициализируем Spartex
    spartexParser = new SpartexParser();
    await spartexParser.init(browser);
    console.log('✅ Spartex парсер готов');

    // Инициализируем Rulim
    rulimParser = new RulimParser();
    await rulimParser.init(browser);
    console.log('✅ Rulim парсер готов');

  } catch (error) {
    console.error('❌ Ошибка инициализации:', error.message);
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    emex: !!emexParser,
    spartex: !!spartexParser,
    rulim: !!rulimParser,
    browser_connected: browser && browser.isConnected()
  });
});

app.post('/api/search', async (req, res) => {
  const startTime = Date.now();
  const { vin, part_name, mode, brand, model, year, engine, source = 'emex' } = req.body;

  console.log(`Search [${source.toUpperCase()}]: ${part_name}`);

  // Валидация
  if (!part_name || part_name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Название детали должно содержать минимум 2 символа'
      });
  }

  if (mode === 'vin' && (!vin || vin.length !== 17)) {
      return res.status(400).json({
        success: false,
        message: 'VIN должен содержать ровно 17 символов'
      });
  }

  // Формируем строку запроса
  let searchQuery = part_name;
  if (mode === 'vin' && vin) {
    searchQuery = `${vin} ${part_name}`;
  } else if (mode === 'params' && brand && model) {
    searchQuery = `${brand} ${model} ${year || ''} ${engine || ''} ${part_name}`.trim();
  }

  try {
    let results = [];

    // Ensure browser is running
    if (!browser || !browser.isConnected()) {
        console.log('⚠️ Браузер отключен, перезапуск...');
        await initBrowser();
        // Re-init parsers with new browser
        if (emexParser) await emexParser.init(browser);
        if (spartexParser) await spartexParser.init(browser);
        if (rulimParser) await rulimParser.init(browser);
    }

    // Выбираем парсер
    if (source === 'emex') {
        if (!emexParser) {
            emexParser = new EmexParser();
            await emexParser.init(browser);
        }
        results = await emexParser.searchByQuery(searchQuery);
    } else if (source === 'spartex') {
        if (!spartexParser) {
            spartexParser = new SpartexParser();
            await spartexParser.init(browser);
        }
        results = await spartexParser.searchByQuery(searchQuery);
    } else if (source === 'rulim') {
        if (!rulimParser) {
            rulimParser = new RulimParser();
            await rulimParser.init(browser);
        }
        results = await rulimParser.searchByQuery(searchQuery);
    }

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      results,
      total: results.length,
      message: results.length > 0 ? 'Поиск выполнен успешно' : 'Товары не найдены',
      duration_ms: duration
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initParsers();
});

/**
 * Graceful shutdown
 */
async function shutdown() {
    console.log('⚠️ Shutting down parsers...');
    if (browser) await browser.close();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
