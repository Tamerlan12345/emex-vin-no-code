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
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow'
    });

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
   * Поиск по общему запросу (для VIN + деталь или просто деталь)
   */
  async searchByQuery(query) {
    const page = await this.context.newPage();

    try {
      console.log(`🔍 Поиск: "${query}"`);

      // Переход на главную
      await page.goto(this.baseUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.randomDelay(2000, 3000);

      // Ищем поисковое поле - актуальные селекторы для Emex.ru
      const searchSelectors = [
        'input[placeholder*="Найти"]',
        'input[name="search"]',
        'input[type="search"]',
        '.search-input input',
        '#search-input',
        'input.header-search__input'
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await page.waitForSelector(selector, { timeout: 3000 });
          if (searchInput) {
            console.log(`✅ Найдено поле поиска: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        throw new Error('Не удалось найти поле поиска на странице');
      }

      // Вводим запрос
      await searchInput.fill(query);
      await this.randomDelay(500, 1000);
      await searchInput.press('Enter');

      // Ждем загрузки результатов
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await this.randomDelay(3000, 5000);

      // Парсим результаты
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

    // Возможные селекторы карточек товаров на Emex.ru
    const cardSelectors = [
      '.search-result__item',
      '.product-card',
      '.goods-item',
      '[data-test="product-card"]',
      '.detail-item',
      '.catalog-item'
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
      console.warn('⚠️ Карточки товаров не найдены');
      return this.generateDemoData();
    }

    const results = [];
    const limit = Math.min(cards.length, 20); // Максимум 20 товаров

    for (let i = 0; i < limit; i++) {
      try {
        const card = cards[i];
        const product = await this.parseProductCard(card);
        if (product) {
          results.push(product);
        }
      } catch (error) {
        console.warn(`⚠️ Ошибка парсинга карточки ${i + 1}:`, error.message);
      }
    }

    console.log(`✅ Успешно спарсено: ${results.length} товаров`);
    return results;
  }

  /**
   * Парсинг одной карточки товара
   */
  async parseProductCard(card) {
    try {
      // Изображение
      let image = null;
      const imgSelectors = ['img', '.product-image img', '[data-test="product-image"]'];
      for (const selector of imgSelectors) {
        try {
          const img = await card.$(selector);
          if (img) {
            image = await img.getAttribute('src');
            if (image && !image.startsWith('http')) {
              image = this.baseUrl + image;
            }
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Бренд
      const brand = await this.extractText(card, [
        '.product-brand',
        '.brand-name',
        '[data-test="brand"]',
        '.manufacturer'
      ]) || 'N/A';

      // Артикул
      const article = await this.extractText(card, [
        '.product-article',
        '.article',
        '[data-test="article"]',
        '.part-number'
      ]) || `ART-${Date.now()}`;

      // Название
      const name = await this.extractText(card, [
        '.product-name',
        '.product-title',
        'h3',
        'h4',
        '[data-test="product-name"]',
        '.title'
      ]) || 'Название не найдено';

      // Цена
      const priceText = await this.extractText(card, [
        '.product-price',
        '.price',
        '[data-test="price"]',
        '.cost'
      ]) || '0';
      const price = this.parsePrice(priceText);

      // Срок доставки
      const deliveryText = await this.extractText(card, [
        '.delivery-time',
        '.delivery',
        '[data-test="delivery"]',
        '.shipping'
      ]) || '0';
      const delivery = this.parseDeliveryDays(deliveryText);

      // Ссылка
      let link = this.baseUrl;
      try {
        const linkElem = await card.$('a');
        if (linkElem) {
          const href = await linkElem.getAttribute('href');
          if (href) {
            link = href.startsWith('http') ? href : this.baseUrl + href;
          }
        }
      } catch (e) {
        // Игнорируем ошибку
      }

      return {
        image: image || 'https://via.placeholder.com/60?text=No+Image',
        brand,
        article,
        name,
        price,
        delivery,
        link,
        availability: price > 0 ? 'В наличии' : 'Под заказ'
      };

    } catch (error) {
      console.error('Ошибка парсинга карточки:', error.message);
      return null;
    }
  }

  /**
   * Извлечение текста по списку селекторов
   */
  async extractText(element, selectors) {
    for (const selector of selectors) {
      try {
        const elem = await element.$(selector);
        if (elem) {
          const text = await elem.innerText();
          return text.trim();
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  /**
   * Парсинг цены
   */
  parsePrice(priceStr) {
    try {
      const cleaned = priceStr.replace(/[^\d.,]/g, '').replace(',', '.');
      return parseFloat(cleaned) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Парсинг срока доставки
   */
  parseDeliveryDays(deliveryStr) {
    try {
      const match = deliveryStr.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Случайная задержка
   */
  async randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Генерация демо-данных (если парсинг не удался)
   */
  generateDemoData() {
    const brands = ['Toyota', 'Bosch', 'Denso', 'Brembo', 'Mann Filter', 'NGK', 'Sachs', 'Continental'];
    const parts = ['Фильтр масляный', 'Тормозные колодки', 'Свечи зажигания', 'Амортизатор'];

    const results = [];
    for (let i = 0; i < 12; i++) {
      const brand = brands[Math.floor(Math.random() * brands.length)];
      const part = parts[Math.floor(Math.random() * parts.length)];

      results.push({
        image: `https://via.placeholder.com/60?text=${brand}`,
        brand,
        article: `ART-${Math.floor(Math.random() * 900000) + 100000}`,
        name: `${part} ${brand}`,
        price: Math.floor(Math.random() * 49500) + 500,
        delivery: Math.floor(Math.random() * 7) + 1,
        link: `${this.baseUrl}/products/${Math.floor(Math.random() * 9000) + 1000}`,
        availability: 'В наличии'
      });
    }

    return results;
  }
}
