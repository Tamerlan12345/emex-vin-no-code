
import { chromium } from 'playwright';

/**
 * Класс для парсинга Rulim.kz
 */
export class RulimParser {
  constructor() {
    this.baseUrl = 'https://rulim.kz';
    this.browser = null;
  }

  async init(browser) {
    this.browser = browser;
  }

  async close() {
    // No persistent context
  }

  async searchByQuery(query) {
    if (!this.browser) throw new Error('RulimParser not initialized with browser');

    let context = null;
    let page = null;

    try {
      console.log('🚀 [Rulim] Создание временного контекста...');
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
      });

      // Блокируем ресурсы
      await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());

      page = await context.newPage();

      console.log(`🔍 [Rulim] Поиск: "${query}"`);
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      const searchSelectors = [
        'input[name="code"]',
        'input[name="search"]',
        '#search_input',
        '.search_input',
        'input[placeholder*="Поиск"]',
        'input[placeholder*="поиск"]',
        'input[placeholder*="Артикул"]'
      ];

      let searchInput = null;
      for (const sel of searchSelectors) {
        try {
          searchInput = await page.waitForSelector(sel, { timeout: 5000 });
          if (searchInput) {
             console.log(`✅ [Rulim] Найдено поле поиска: ${sel}`);
             break;
          }
        } catch(e) {}
      }

      if (!searchInput) {
          console.log('⚠️ [Rulim] Поле поиска не найдено, пробуем прямой URL...');
          const searchUrl = `${this.baseUrl}/?part=search&code=${encodeURIComponent(query)}`;
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } else {
          await searchInput.fill(query);
          await page.keyboard.press('Enter');
      }

      try {
        await page.waitForSelector('table.result, .search-results, .goods-table, tr[class*="row"]', { timeout: 20000 });
      } catch(e) {
        console.log('⚠️ [Rulim] Таблица результатов не появилась явно, пробуем парсить...');
      }

      return await this.parseResults(page);

    } catch (error) {
      console.error('❌ [Rulim] Ошибка:', error.message);
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  async parseResults(page) {
    const rowSelectors = ['tr[class*="row"]', 'table.result tr', '.goods-item'];
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
        const text = await row.innerText();
        if (!text) continue;

        const cells = await row.$$('td');
        if (cells.length < 4) continue;

        const brand = await (await cells[0].innerText()).trim();
        const article = await (await cells[1].innerText()).trim();
        const name = await (await cells[2].innerText()).trim();
        const priceText = await (await cells[cells.length - 2].innerText()).trim();

        results.push({
          image: 'https://via.placeholder.com/60?text=Rulim',
          brand: brand || 'N/A',
          article: article || '---',
          name: name || 'Запчасть',
          price: this.parsePrice(priceText),
          delivery: 0,
          link: this.baseUrl,
          availability: 'В наличии'
        });
      } catch (e) {}
    }

    return results;
  }

  parsePrice(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[^\d]/g, '')) || 0;
  }
}
