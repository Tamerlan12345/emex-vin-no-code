import express from 'express';
import cors from 'cors';
import { EmexParser } from './parser.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Глобальный парсер (переиспользуем браузер)
let globalParser = null;

/**
 * Инициализация парсера при старте сервера
 */
async function initParser() {
  try {
    globalParser = new EmexParser();
    await globalParser.init();
    console.log('✅ Глобальный парсер инициализирован');
  } catch (error) {
    console.error('❌ Ошибка инициализации парсера:', error.message);
  }
}

/**
 * Health check эндпоинт
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    playwright_ready: globalParser !== null,
    timestamp: new Date().toISOString()
  });
});

/**
 * Эндпоинт поиска
 */
app.post('/api/search', async (req, res) => {
  const startTime = Date.now();
  const { vin, part_name, mode, brand, model, year, engine } = req.body;

  console.log(`\n📥 [${new Date().toISOString()}] Новый запрос:`, { mode, vin, part_name });

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

  // Формируем поисковый запрос
  let searchQuery = '';
  if (mode === 'vin' && vin) {
    searchQuery = `${vin} ${part_name}`;
  } else if (mode === 'params' && brand && model) {
    searchQuery = `${brand} ${model} ${year || ''} ${engine || ''} ${part_name}`.trim();
  } else {
    searchQuery = part_name;
  }

  try {
    // Если глобальный парсер не инициализирован, создаем новый
    let parser = globalParser;
    let shouldClose = false;

    if (!parser) {
      console.log('⚠️ Создание нового парсера...');
      parser = new EmexParser();
      await parser.init();
      shouldClose = true;
    }

    // Выполняем поиск
    const results = await parser.searchByQuery(searchQuery);

    // Закрываем временный парсер
    if (shouldClose) {
      await parser.close();
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Поиск завершен за ${duration}ms. Найдено: ${results.length} товаров`);

    res.json({
      success: true,
      results,
      total: results.length,
      message: results.length > 0 ? 'Поиск выполнен успешно' : 'Товары не найдены',
      search_params: { mode, vin, part_name, brand, model, year, engine },
      duration_ms: duration
    });

  } catch (error) {
    console.error('❌ Ошибка при поиске:', error.message);

    if (error.message === 'TIMEOUT_ERROR') {
      return res.status(504).json({
        success: false,
        message: 'Время ожидания ответа от Emex истекло (таймаут)',
        error: 'Timeout exceeded'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Ошибка при выполнении поиска',
      error: error.message
    });
  }
});

/**
 * Корневой маршрут - if static file not found
 */
// Note: express.static is already used, so this might not be reached for '/', but good as a fallback
// However, if index.html exists in public, it takes precedence for '/'.
// I will omit the inline HTML from the guide since I'm creating a real index.html in public/

/**
 * Запуск сервера
 */
app.listen(PORT, async () => {
  console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`💚 Health: http://localhost:${PORT}/health\n`);

  // Инициализируем парсер
  await initParser();
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM получен, закрываем парсер...');
  if (globalParser) {
    await globalParser.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️ SIGINT получен, закрываем парсер...');
  if (globalParser) {
    await globalParser.close();
  }
  process.exit(0);
});
