import { chromium } from 'playwright';

/**
 * Класс для парсинга Spartex.kz (Rulim.kz)
 */
export class SpartexParser {
  constructor() {
    // Используем прямую ссылку на поиск, если она известна, или главную
    this.baseUrl = 'https://www.spartex.kz/front/';
    this.browser = null;
    this.context = null;
  }

  async init() {
    console.log('🚀 [Spartex] Запуск браузера...');
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  async searchByQuery(query) {
    const page = await this.context.newPage();
    try {
      console.log(`🔍 [Spartex] Поиск: "${query}"`);
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // 1. Ищем поле поиска
      // Обычно на Spartex id="search_input" или name="search"
      const searchSelectors = [
        'input[name="search"]',
        '#search',
        '.search-input',
        'input[type="text"]'
      ];

      let searchInput = null;
      for (const sel of searchSelectors) {
        try {
          searchInput = await page.waitForSelector(sel, { timeout: 3000 });
          if (searchInput) break;
        } catch(e) {}
      }

      if (!searchInput) throw new Error('Не найдено поле поиска на Spartex');

      await searchInput.fill(query);
      await page.keyboard.press('Enter');

      // 2. Ждем результаты
      // Обычно это таблица или список карточек
      try {
        await page.waitForSelector('.result_table, .price_table, .catalog-list', { timeout: 20000 });
      } catch(e) {
        console.log('⚠️ [Spartex] Таблица результатов не появилась явно, пробуем парсить...');
      }

      return await this.parseResults(page);

    } catch (error) {
      console.error('❌ [Spartex] Ошибка:', error.message);
      return []; // Возвращаем пустой массив при ошибке
    } finally {
      await page.close();
    }
  }

  async parseResults(page) {
    // Селекторы строк таблицы. Нужно уточнить через F12 на сайте
    const rowSelectors = ['tr.price_line', '.result-row', '.catalog-item'];
    let rows = [];

    for (const sel of rowSelectors) {
      rows = await page.$$(sel);
      if (rows.length > 0) break;
    }

    const results = [];
    const limit = Math.min(rows.length, 20);

    for (let i = 0; i < limit; i++) {
      try {
        const row = rows[i];

        // Логика извлечения данных (может потребоваться корректировка селекторов)
        const brand = await this.safeText(row, '.brand, .manufacturer');
        const article = await this.safeText(row, '.article, .number');
        const name = await this.safeText(row, '.description, .name');
        const priceText = await this.safeText(row, '.price, .cost');
        const deliveryText = await this.safeText(row, '.delivery, .days');

        // Картинка (часто на Spartex её нет в таблице, ставим заглушку или ищем)
        const image = 'https://via.placeholder.com/60?text=Spartex';

        results.push({
          image,
          brand: brand || 'N/A',
          article: article || '---',
          name: name || 'Запчасть',
          price: this.parsePrice(priceText),
          delivery: this.parseDelivery(deliveryText),
          link: this.baseUrl, // Ссылку можно уточнить, если есть <a>
          availability: 'В наличии'
        });
      } catch (e) {}
    }

    return results;
  }

  async safeText(element, selector) {
    try {
      const el = await element.$(selector);
      return el ? (await el.innerText()).trim() : null;
    } catch { return null; }
  }

  parsePrice(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[^\d]/g, '')) || 0;
  }

  parseDelivery(str) {
    if (!str) return 0;
    const match = str.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }
}
