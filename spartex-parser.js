
import { chromium } from 'playwright';

/**
 * Класс для парсинга Spartex.kz
 */
export class SpartexParser {
  constructor() {
    this.baseUrl = 'https://www.spartex.kz/front/';
    this.browser = null;
  }

  async init(browser) {
    this.browser = browser;
  }

  async close() {
    // No persistent context to close
  }

  async searchByQuery(query) {
    if (!this.browser) throw new Error('SpartexParser not initialized with browser');

    let context = null;
    let page = null;

    try {
      console.log('🚀 [Spartex] Создание временного контекста...');
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
      });

      // Блокируем ресурсы
      await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());

      page = await context.newPage();

      console.log(`🔍 [Spartex] Поиск: "${query}"`);

      // Retry logic for navigation
      let attempts = 0;
      const maxAttempts = 3;
      let navigationSuccess = false;

      while (attempts < maxAttempts) {
        try {
          console.log(`🔄 [Spartex] Attempt ${attempts + 1}/${maxAttempts} navigating to ${this.baseUrl}`);
          await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          navigationSuccess = true;
          break;
        } catch (e) {
          attempts++;
          console.log(`⚠️ [Spartex] Navigation attempt ${attempts} failed: ${e.message}`);
          if (attempts === maxAttempts) throw e;
          await page.waitForTimeout(2000);
        }
      }

      if (!navigationSuccess) throw new Error('Failed to navigate to Spartex after multiple attempts');

      const searchSelectors = [
        'input[type="search"]',
        'input[placeholder*="ртикул"]',
        'input[placeholder*="Article"]',
        '#search-input',
        '.search-field input',
        'input'
      ];

      let searchInput = null;

      // Wait for hydration/loading
      try {
        await page.waitForTimeout(2000);
        // Try waiting for any input
        await page.waitForSelector('input', { timeout: 15000, state: 'attached' });
      } catch (e) {
        console.log('⚠️ [Spartex] Input not immediately visible, waiting longer...');
      }

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
         console.log('⚠️ [Spartex] Поле поиска не найдено стандартными методами, пробуем еще раз...');
         // Angular might be slow
         await page.waitForTimeout(3000);
         const headerInput = await page.$('header input');
         if (headerInput) {
             searchInput = headerInput;
             console.log('✅ [Spartex] Найдено поле поиска в хедере.');
         } else {
             // Last ditch effort: find any input that is visible
             const allInputs = await page.$$('input');
             for(const inp of allInputs) {
                 if(await inp.isVisible()) {
                     searchInput = inp;
                     console.log('✅ [Spartex] Найдено fallback поле поиска.');
                     break;
                 }
             }
         }
      }

      if (!searchInput) {
          throw new Error('Не найдено поле поиска на Spartex');
      }

      await searchInput.fill(query);
      await page.keyboard.press('Enter');

      try {
        await page.waitForSelector('table, .list-view, .products-list, app-product-list', { timeout: 25000 });
      } catch(e) {
        console.log('⚠️ [Spartex] Таблица результатов не появилась явно, пробуем парсить...');
      }

      await page.waitForTimeout(2000);

      return await this.parseResults(page);

    } catch (error) {
      console.error('❌ [Spartex] Ошибка:', error.message);
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  async parseResults(page) {
    const rows = await page.$$('tr, .product-item, app-product-item');
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
                image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDYwIDYwIj48cmVjdCB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIGZpbGw9IiNlNmU2ZTYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM5OTkiPlNwYXJ0ZXg8L3RleHQ+PC9zdmc+',
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
