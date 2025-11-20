import { chromium } from 'playwright';

/**
 * Класс для парсинга Emex.ru
 */
export class EmexParser {
  constructor() {
    this.baseUrl = 'https://emex.ru';
    this.browser = null;
    this.context = null;
  }

  /**
   * Инициализация браузера
   */
  async init() {
    console.log('🚀 Запуск браузера...');

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled', // Скрываем автоматизацию
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080'
      ]
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      deviceScaleFactor: 1,
    });

    // Дополнительная маскировка от обнаружения ботов
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    // Блокируем загрузку картинок и шрифтов для ускорения
    await this.context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());

    console.log('✅ Браузер запущен');
  }

  /**
   * Закрытие браузера
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 Браузер закрыт');
    }
  }

  /**
   * Поиск по общему запросу
   */
  async searchByQuery(query) {
    const page = await this.context.newPage();

    try {
      console.log(`🔍 Поиск: "${query}"`);

      // ОПТИМИЗАЦИЯ: Увеличили таймаут до 60 сек и изменили стратегию ожидания
      // 'commit' означает, что мы получили ответ от сервера, но не ждем полной загрузки скриптов
      await page.goto(this.baseUrl, {
        waitUntil: 'commit',
        timeout: 60000
      });

      // Теперь явно ждем появления любого элемента интерфейса, чтобы убедиться, что сайт жив
      // Это надежнее, чем domcontentloaded для SPA приложений
      try {
        await page.waitForSelector('body', { timeout: 30000 });
      } catch (e) {
        console.log('⚠️ Body не загрузился быстро, продолжаем...');
      }

      await this.randomDelay(2000, 3000);

      const searchSelectors = [
        '[data-test="search-input"]', // Часто используется в Emex
        'input[placeholder*="Найти"]',
        'input[name="search"]',
        'input[type="search"]',
        '.search-input input',
        '#search-input'
      ];

      let searchInput = null;
      // Ищем поле поиска с увеличенным таймаутом для первого элемента
      for (const selector of searchSelectors) {
        try {
          searchInput = await page.waitForSelector(selector, { timeout: 5000 });
          if (searchInput) {
            console.log(`✅ Найдено поле поиска: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        // Если поле не найдено, возможно Emex показал капчу или заблокировал IP
        // Делаем скриншот для отладки (в Railway его не увидеть, но полезно для локального теста)
        // await page.screenshot({ path: 'error_debug.png' });
        throw new Error('Не удалось найти поле поиска. Возможно, IP заблокирован или сайт изменился.');
      }

      await searchInput.fill(query);
      await this.randomDelay(500, 1000);
      await searchInput.press('Enter');

      // Ждем не networkidle (который часто виснет), а появления результатов
      // Увеличиваем таймаут ожидания результатов
      try {
         await page.waitForSelector('.search-result__item, .product-card, [data-test="product-card"]', { timeout: 30000 });
      } catch(e) {
         console.log('⚠️ Результаты не появились сразу, пробуем парсить то, что есть...');
      }

      await this.randomDelay(2000, 4000);

      const results = await this.parseResults(page);
      return results;

    } catch (error) {
      console.error('❌ Ошибка поиска:', error.message);
      throw error;
    } finally {
      await page.close();
    }
  }

  /**
   * Парсинг результатов поиска
   */
  async parseResults(page) {
    console.log('📊 Парсинг результатов...');

    const cardSelectors = [
      '[data-test="product-card"]', // Приоритетный селектор
      '.search-result__item',
      '.product-card',
      '.goods-item',
      '.detail-item'
    ];

    let cards = [];
    for (const selector of cardSelectors) {
      try {
        cards = await page.$$(selector);
        if (cards.length > 0) {
          console.log(`✅ Найдено ${cards.length} карточек по селектору: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (cards.length === 0) {
      console.warn('⚠️ Карточки товаров не найдены. Пробуем фоллбек данные.');
      // Важно: если парсинг упал, лучше вернуть демо-данные, чем ошибку, чтобы фронтенд не падал
      return this.generateDemoData();
    }

    const results = [];
    const limit = Math.min(cards.length, 20);

    for (let i = 0; i < limit; i++) {
      try {
        const card = cards[i];
        const product = await this.parseProductCard(card);
        if (product) {
          results.push(product);
        }
      } catch (error) {
        // Игнорируем ошибки отдельных карточек
      }
    }

    console.log(`✅ Успешно спарсено: ${results.length} товаров`);
    return results.length > 0 ? results : this.generateDemoData();
  }

  /**
   * Парсинг одной карточки товара
   */
  async parseProductCard(card) {
    try {
      // Изображение
      let image = null;
      // Мы отключили загрузку картинок, поэтому src может быть пустым, но попробуем найти атрибут
      const imgSelectors = ['img', '.product-image img'];
      for (const selector of imgSelectors) {
        const img = await card.$(selector);
        if (img) {
            image = await img.getAttribute('src');
            if (!image) image = await img.getAttribute('data-src'); // Иногда бывает lazy load
            if (image && !image.startsWith('http')) {
              image = this.baseUrl + image;
            }
            break;
        }
      }

      const brand = await this.extractText(card, ['.product-brand', '[data-test="brand"]', '.brand-name']) || 'N/A';
      const article = await this.extractText(card, ['.product-article', '[data-test="article"]', '.part-number']) || '---';
      const name = await this.extractText(card, ['.product-name', '[data-test="product-name"]', '.title']) || 'Автозапчасть';

      const priceText = await this.extractText(card, ['.product-price', '[data-test="price"]', '.cost']) || '0';
      const price = this.parsePrice(priceText);

      const deliveryText = await this.extractText(card, ['.delivery-time', '[data-test="delivery"]']) || '0';
      const delivery = this.parseDeliveryDays(deliveryText);

      // Ссылка
      let link = this.baseUrl;
      const linkElem = await card.$('a');
      if (linkElem) {
        const href = await linkElem.getAttribute('href');
        if (href) link = href.startsWith('http') ? href : this.baseUrl + href;
      }

      return {
        image: image || 'https://via.placeholder.com/60?text=Part',
        brand,
        article,
        name,
        price,
        delivery,
        link,
        availability: price > 0 ? 'В наличии' : 'Нет в наличии'
      };

    } catch (error) {
      return null;
    }
  }

  async extractText(element, selectors) {
    for (const selector of selectors) {
      try {
        const elem = await element.$(selector);
        if (elem) return (await elem.innerText()).trim();
      } catch (e) { continue; }
    }
    return null;
  }

  parsePrice(priceStr) {
    try {
      return parseFloat(priceStr.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    } catch { return 0; }
  }

  parseDeliveryDays(deliveryStr) {
    try {
      const match = deliveryStr.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    } catch { return 0; }
  }

  async randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  generateDemoData() {
    // Возвращаем демо данные если парсинг не прошел (чтобы не крашить приложение)
    return [
      {
        image: 'https://via.placeholder.com/60?text=Demo',
        brand: 'DEMO DATA',
        article: 'TIMEOUT-ERROR',
        name: 'Emex не ответил вовремя (Попробуйте позже)',
        price: 0,
        delivery: 0,
        link: '#',
        availability: 'Ошибка сети'
      }
    ];
  }
}
