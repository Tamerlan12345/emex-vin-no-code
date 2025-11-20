import { chromium } from 'playwright';

/**
 * Класс для парсинга Emex.ru
 */
export class EmexParser {
  constructor() {
    this.baseUrl = 'https://emex.ru';
    this.browser = null;
  }

  /**
   * Инициализация
   * @param {import('playwright').Browser} browser
   */
  async init(browser) {
    this.browser = browser;
  }

  async close() {
    // No persistent context to close
  }

  /**
   * Поиск по общему запросу
   */
  async searchByQuery(query) {
    if (!this.browser) throw new Error('EmexParser not initialized with browser');

    let context = null;
    let page = null;

    try {
      console.log('🚀 [Emex] Создание временного контекста...');
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
        deviceScaleFactor: 1,
      });

      // Дополнительная маскировка
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      // Блокируем ресурсы
      await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());

      page = await context.newPage();

      console.log(`🔍 [Emex] Поиск: "${query}"`);

      await page.goto(this.baseUrl, { waitUntil: 'commit', timeout: 45000 });

      try {
        await page.waitForSelector('body', { timeout: 30000 });
      } catch (e) {
        console.log('⚠️ Body не загрузился быстро, продолжаем...');
      }

      await this.randomDelay(2000, 3000);

      const searchSelectors = [
        '[data-test="search-input"]',
        'input[placeholder*="Найти"]',
        'input[name="search"]',
        'input[type="search"]',
        '.search-input input',
        '#search-input'
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await page.waitForSelector(selector, { timeout: 5000 });
          if (searchInput) {
            console.log(`✅ [Emex] Найдено поле поиска: ${selector}`);
            break;
          }
        } catch (e) { continue; }
      }

      if (!searchInput) {
        throw new Error('Не удалось найти поле поиска на Emex.');
      }

      await searchInput.fill(query);
      await this.randomDelay(500, 1000);
      await searchInput.press('Enter');

      try {
         await page.waitForSelector('.search-result__item, .product-card, [data-test="product-card"]', { timeout: 30000 });
      } catch(e) {
         console.log('⚠️ Результаты не появились сразу, пробуем парсить то, что есть...');
      }

      await this.randomDelay(2000, 4000);

      return await this.parseResults(page);

    } catch (error) {
      console.error('❌ [Emex] Ошибка поиска:', error.message);
      if (error.message.includes('Timeout')) return this.generateDemoData();
      throw error;
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  async parseResults(page) {
    console.log('📊 Парсинг результатов...');

    const cardSelectors = [
      '[data-test="product-card"]',
      '.search-result__item',
      '.product-card',
      '.goods-item',
      '.detail-item'
    ];

    let cards = [];
    for (const selector of cardSelectors) {
      try {
        cards = await page.$$(selector);
        if (cards.length > 0) break;
      } catch (e) { continue; }
    }

    if (cards.length === 0) return this.generateDemoData();

    const results = [];
    const limit = Math.min(cards.length, 20);

    for (let i = 0; i < limit; i++) {
      try {
        const card = cards[i];
        const product = await this.parseProductCard(card);
        if (product) results.push(product);
      } catch (error) {}
    }

    return results.length > 0 ? results : this.generateDemoData();
  }

  async parseProductCard(card) {
    try {
      let image = null;
      const imgSelectors = ['img', '.product-image img'];
      for (const selector of imgSelectors) {
        const img = await card.$(selector);
        if (img) {
            image = await img.getAttribute('src');
            if (!image) image = await img.getAttribute('data-src');
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

      let link = this.baseUrl;
      const linkElem = await card.$('a');
      if (linkElem) {
        const href = await linkElem.getAttribute('href');
        if (href) link = href.startsWith('http') ? href : this.baseUrl + href;
      }

      return {
        image: image || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDYwIDYwIj48cmVjdCB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIGZpbGw9IiNlNmU2ZTYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5OTkiPlBhcnQ8L3RleHQ+PC9zdmc+',
        brand,
        article,
        name,
        price,
        delivery,
        link,
        availability: price > 0 ? 'В наличии' : 'Нет в наличии'
      };

    } catch (error) { return null; }
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
    return [
      {
        image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDYwIDYwIj48cmVjdCB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIGZpbGw9IiNlNmU2ZTYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5OTkiPkRlbW88L3RleHQ+PC9zdmc+',
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
