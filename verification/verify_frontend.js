
import { chromium } from 'playwright';

async function verify() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Navigating to http://localhost:3000');
  await page.goto('http://localhost:3000');

  console.log('Waiting for page to load...');
  await page.waitForLoadState('networkidle');

  // We can inspect the onerror handler by checking the DOM or injecting a script
  // But visually, we can check if the placeholder logic is there.

  // Let's inject a mock item into the results grid to test the image rendering manually
  await page.evaluate(() => {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = `
        <div class="results-grid">
            <div class="product-card">
                <img src="http://invalid-url-to-trigger-error.com/img.png" alt="Test Item" class="card-image" onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMzAwIDIwMCI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNlNmU2ZTYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjAiIGZpbGw9IiM5OTkiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg=='">
                <div class="card-content">
                    <div class="brand">TEST BRAND</div>
                    <div class="product-name">Test Part with Broken Image</div>
                    <div class="article">12345</div>
                    <div class="details">
                        <div class="price">1000 ₽</div>
                    </div>
                </div>
            </div>
        </div>
    `;
  });

  console.log('Waiting for image error handling...');
  await page.waitForTimeout(1000); // Wait for onerror to trigger

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'verification/frontend_verification.png', fullPage: true });

  await browser.close();
}

verify().catch(console.error);
