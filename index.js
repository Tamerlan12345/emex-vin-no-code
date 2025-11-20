import express from 'express';
import cors from 'cors';
import { EmexParser } from './parser.js';
import { SpartexParser } from './spartex-parser.js'; // <--- Импорт нового парсера

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Храним инстансы парсеров
let emexParser = null;
let spartexParser = null;

async function initParsers() {
  try {
    // Инициализируем Emex
    emexParser = new EmexParser();
    await emexParser.init();
    console.log('✅ Emex парсер готов');

    // Инициализируем Spartex
    spartexParser = new SpartexParser();
    await spartexParser.init();
    console.log('✅ Spartex парсер готов');
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error.message);
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', emex: !!emexParser, spartex: !!spartexParser });
});

app.post('/api/search', async (req, res) => {
  const startTime = Date.now();
  const { vin, part_name, mode, brand, model, year, engine, source = 'emex' } = req.body; // <--- Получаем source

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

    // Выбираем парсер
    if (source === 'emex') {
        if (!emexParser) { // Рестарт если упал
            emexParser = new EmexParser();
            await emexParser.init();
        }
        results = await emexParser.searchByQuery(searchQuery);
    } else if (source === 'spartex') {
        if (!spartexParser) {
            spartexParser = new SpartexParser();
            await spartexParser.init();
        }
        results = await spartexParser.searchByQuery(searchQuery);
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
process.on('SIGTERM', async () => {
    console.log('⚠️ SIGTERM получен, закрываем парсеры...');
    if (emexParser) await emexParser.close();
    if (spartexParser) await spartexParser.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n⚠️ SIGINT получен, закрываем парсеры...');
    if (emexParser) await emexParser.close();
    if (spartexParser) await spartexParser.close();
    process.exit(0);
});
