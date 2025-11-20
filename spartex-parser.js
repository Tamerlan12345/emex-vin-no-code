
import { chromium } from 'playwright';

/**
 * Класс для парсинга Spartex.kz
 */
export class SpartexParser {
  constructor() {
    this.baseUrl = 'https://www.spartex.kz/front/';
    this.context = null;
  }

  async init(browser) {
    console.log('🚀 [Spartex] Создание контекста...');
    this.context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
  }

  async close() {
    if (this.context) await this.context.close();
  }

  async searchByQuery(query) {
    if (!this.context) throw new Error('SpartexParser not initialized');
    const page = await this.context.newPage();
    try {
      console.log(`🔍 [Spartex] Поиск: "${query}"`);
      await page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 45000 });

      const searchSelectors = [
        'input[type="search"]',
        'input[placeholder*="ртикул"]',
        'input[placeholder*="Article"]',
        '#search-input',
        '.search-field input',
        'input'
      ];

      let searchInput = null;

      await page.waitForTimeout(2000);

      for (const sel of searchSelectors) {
        try {
           const inputs = await page.$$(sel);
           for (const input of inputs) {
             if (await input.isVisible()) {
               searchInput = input;
               console.log(`✅ [Spartex] Найдено поле поиска: ${sel}`);
               break;
             }
           }
           if (searchInput) break;
        } catch(e) {}
      }

      if (!searchInput) {
         console.log('⚠️ [Spartex] Поле поиска не найдено стандартными методами.');
         const headerInput = await page.$('header input');
         if (headerInput) {
             searchInput = headerInput;
             console.log('✅ [Spartex] Найдено поле поиска в хедере.');
         } else {
             throw new Error('Не найдено поле поиска на Spartex');
         }
      }

      await searchInput.fill(query);
      await page.keyboard.press('Enter');

      try {
        await page.waitForSelector('table, .list-view, .products-list', { timeout: 20000 });
      } catch(e) {
        console.log('⚠️ [Spartex] Таблица результатов не появилась явно, пробуем парсить...');
      }

      await page.waitForTimeout(2000);

      return await this.parseResults(page);

    } catch (error) {
      console.error('❌ [Spartex] Ошибка:', error.message);
      return [];
    } finally {
      await page.close();
    }
  }

  async parseResults(page) {
    const rows = await page.$$('tr, .product-item');
    const results = [];
    const limit = Math.min(rows.length, 30);

    for (let i = 0; i < limit; i++) {
      try {
        const row = rows[i];
        const text = await row.innerText();
        if (!text || text.length < 10) continue;

        let brand = 'N/A';
        let article = '---';
        let name = 'Запчасть';
        let price = 0;
        let delivery = 0;

        const priceMatch = text.match(/([\d\s]+)\s?(тг|KZT|rub|руб)/i);
        if (priceMatch) {
            price = this.parsePrice(priceMatch[1]);
        } else {
             const numbers = text.match(/(\d[\d\s]*)/g);
             if (numbers && numbers.length > 0) {
                 price = this.parsePrice(numbers[numbers.length - 1]);
             }
        }

        if (price > 0) {
             const parts = text.split(/\s+/);
             if (parts.length >= 2) {
                 brand = parts[0];
                 article = parts[1];
             }
             name = text.substring(0, 50) + '...';

             results.push({
                image: 'https://via.placeholder.com/60?text=Spartex',
                brand,
                article,
                name,
                price,
                delivery,
                link: this.baseUrl,
                availability: 'В наличии'
             });
        }

      } catch (e) {}
    }

    return results;
  }

  parsePrice(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[^\d]/g, '')) || 0;
  }
}
