import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to http://localhost:3000');
    await page.goto('http://localhost:3000');

    console.log('Waiting for source selector...');
    await page.waitForSelector('#sourceSelect');

    console.log('Taking screenshot of the UI...');
    await page.screenshot({ path: 'verification/ui_screenshot.png' });
    console.log('Screenshot saved to verification/ui_screenshot.png');

    // Verify the select options
    const options = await page.$eval('#sourceSelect', (select) => {
        return Array.from(select.options).map(o => o.value);
    });
    console.log('Options found:', options);

    if (options.includes('emex') && options.includes('spartex')) {
        console.log('✅ Dropdown contains expected options.');
    } else {
        console.error('❌ Dropdown missing options.');
        process.exit(1);
    }

    // Check if search form exists
    await page.waitForSelector('#searchForm');
    console.log('✅ Search form present.');

  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
