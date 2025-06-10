import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Browser, Page, chromium } from 'playwright';
import { MultiTenantService } from '../../backend/services/multi-tenant-service/src/services/tenant.service';
import { WhatsAppService } from '../../backend/services/whatsapp-service/src/services/whatsapp.service';
import { PaymentService } from '../../backend/services/payment-service/src/services/payment.service';

describe('E2E: Uncle Charles Vendor Onboarding Flow', () => {
  let browser: Browser;
  let page: Page;
  let tenantService: MultiTenantService;
  let whatsappService: WhatsAppService;
  let paymentService: PaymentService;

  const vendorDetails = {
    businessName: "Uncle Charles Kitchen",
    ownerName: "Charles Mwangi",
    email: "charles@unclecharles.co.zw",
    phone: "+263771234567",
    address: "123 Samora Machel Avenue, Harare, Zimbabwe",
    businessType: "Restaurant",
    cuisineTypes: ["Traditional Zimbabwean", "African Fusion"],
    operatingHours: {
      monday: { open: "08:00", close: "22:00" },
      tuesday: { open: "08:00", close: "22:00" },
      wednesday: { open: "08:00", close: "22:00" },
      thursday: { open: "08:00", close: "22:00" },
      friday: { open: "08:00", close: "23:00" },
      saturday: { open: "09:00", close: "23:00" },
      sunday: { open: "10:00", close: "21:00" }
    }
  };

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false'
    });
    page = await browser.newPage();

    // Initialize services
    tenantService = new MultiTenantService();
    whatsappService = new WhatsAppService();
    paymentService = new PaymentService();

    await Promise.all([
      tenantService.initialize(),
      whatsappService.initialize(),
      paymentService.initialize()
    ]);
  });

  afterAll(async () => {
    await browser.close();
    await Promise.all([
      tenantService.shutdown(),
      whatsappService.shutdown(),
      paymentService.shutdown()
    ]);
  });

  describe('Vendor Registration Process', () => {
    it('should complete the initial registration form', async () => {
      // Navigate to vendor registration page
      await page.goto('http://localhost:3000/vendor/register');
      
      // Fill in business information
      await page.fill('[data-testid="business-name"]', vendorDetails.businessName);
      await page.fill('[data-testid="owner-name"]', vendorDetails.ownerName);
      await page.fill('[data-testid="email"]', vendorDetails.email);
      await page.fill('[data-testid="phone"]', vendorDetails.phone);
      
      // Select business type
      await page.selectOption('[data-testid="business-type"]', vendorDetails.businessType);
      
      // Select cuisine types
      for (const cuisine of vendorDetails.cuisineTypes) {
        await page.check(`[data-testid="cuisine-${cuisine.toLowerCase().replace(/\s+/g, '-')}"]`);
      }
      
      // Fill address
      await page.fill('[data-testid="address"]', vendorDetails.address);
      
      // Click next
      await page.click('[data-testid="next-button"]');
      
      // Verify we're on the next step
      await expect(page.locator('[data-testid="step-indicator"]')).toContainText('Step 2');
    });

    it('should configure operating hours and delivery zones', async () => {
      // Set operating hours
      for (const [day, hours] of Object.entries(vendorDetails.operatingHours)) {
        await page.fill(`[data-testid="${day}-open"]`, hours.open);
        await page.fill(`[data-testid="${day}-close"]`, hours.close);
      }
      
      // Configure delivery zones
      await page.click('[data-testid="add-delivery-zone"]');
      await page.fill('[data-testid="zone-name-0"]', 'Central Harare');
      await page.fill('[data-testid="zone-radius-0"]', '5');
      await page.fill('[data-testid="zone-fee-0"]', '2.00');
      
      await page.click('[data-testid="add-delivery-zone"]');
      await page.fill('[data-testid="zone-name-1"]', 'Greater Harare');
      await page.fill('[data-testid="zone-radius-1"]', '15');
      await page.fill('[data-testid="zone-fee-1"]', '5.00');
      
      // Set preparation time
      await page.fill('[data-testid="avg-prep-time"]', '30');
      
      // Enable delivery and pickup
      await page.check('[data-testid="enable-delivery"]');
      await page.check('[data-testid="enable-pickup"]');
      
      await page.click('[data-testid="next-button"]');
    });

    it('should set up payment methods', async () => {
      // Select payment methods for Zimbabwe
      await page.check('[data-testid="payment-ecocash"]');
      await page.check('[data-testid="payment-onemoney"]');
      await page.check('[data-testid="payment-cash"]');
      
      // Configure EcoCash merchant details
      await page.fill('[data-testid="ecocash-merchant-code"]', 'UCK-12345');
      await page.fill('[data-testid="ecocash-merchant-pin"]', '****');
      
      // Configure settlement preferences
      await page.selectOption('[data-testid="settlement-frequency"]', 'daily');
      await page.selectOption('[data-testid="settlement-bank"]', 'Standard Chartered Zimbabwe');
      await page.fill('[data-testid="account-number"]', '1234567890');
      await page.fill('[data-testid="account-name"]', 'Uncle Charles Kitchen Ltd');
      
      await page.click('[data-testid="next-button"]');
    });

    it('should configure WhatsApp Business integration', async () => {
      // Enter WhatsApp Business number
      await page.fill('[data-testid="whatsapp-number"]', '+263771234567');
      
      // Trigger verification
      await page.click('[data-testid="verify-whatsapp"]');
      
      // Wait for verification code input to appear
      await page.waitForSelector('[data-testid="verification-code"]');
      
      // In real scenario, we'd get this from SMS/WhatsApp
      // For testing, we'll mock the verification
      const verificationCode = '123456';
      await page.fill('[data-testid="verification-code"]', verificationCode);
      await page.click('[data-testid="submit-verification"]');
      
      // Wait for success message
      await expect(page.locator('[data-testid="verification-success"]')).toBeVisible();
      
      // Configure WhatsApp greeting message
      await page.fill('[data-testid="greeting-message"]', 
        'Welcome to Uncle Charles Kitchen! 🍽️\n' +
        'Zimbabwe\'s favorite traditional cuisine.\n' +
        'Reply with:\n' +
        '1. View Menu\n' +
        '2. Place Order\n' +
        '3. Track Order\n' +
        '4. Contact Us'
      );
      
      // Configure auto-reply settings
      await page.check('[data-testid="enable-auto-reply"]');
      await page.fill('[data-testid="response-time"]', '1'); // 1 minute
      
      await page.click('[data-testid="next-button"]');
    });

    it('should upload menu items', async () => {
      // Add menu categories
      const categories = ['Sadza Meals', 'Grilled Meats', 'Vegetables', 'Beverages'];
      
      for (const category of categories) {
        await page.click('[data-testid="add-category"]');
        await page.fill('[data-testid="category-name-input"]', category);
        await page.click('[data-testid="save-category"]');
      }
      
      // Add menu items
      const menuItems = [
        {
          category: 'Sadza Meals',
          name: 'Sadza & Beef Stew',
          description: 'Traditional white maize meal with tender beef stew',
          price: '8.00',
          prepTime: '25'
        },
        {
          category: 'Sadza Meals',
          name: 'Sadza & Chicken',
          description: 'Sadza served with grilled chicken and vegetables',
          price: '7.50',
          prepTime: '20'
        },
        {
          category: 'Grilled Meats',
          name: 'Nyama Choma',
          description: 'Grilled beef served with tomato & onion relish',
          price: '12.00',
          prepTime: '30'
        }
      ];
      
      for (const item of menuItems) {
        await page.click('[data-testid="add-menu-item"]');
        await page.selectOption('[data-testid="item-category"]', item.category);
        await page.fill('[data-testid="item-name"]', item.name);
        await page.fill('[data-testid="item-description"]', item.description);
        await page.fill('[data-testid="item-price"]', item.price);
        await page.fill('[data-testid="item-prep-time"]', item.prepTime);
        
        // Upload image (mock file upload)
        const fileInput = await page.locator('[data-testid="item-image"]');
        await fileInput.setInputFiles({
          name: `${item.name.toLowerCase().replace(/\s+/g, '-')}.jpg`,
          mimeType: 'image/jpeg',
          buffer: Buffer.from('fake-image-data')
        });
        
        await page.click('[data-testid="save-menu-item"]');
        
        // Wait for item to be added
        await expect(page.locator(`[data-testid="menu-item-${item.name}"]`)).toBeVisible();
      }
      
      await page.click('[data-testid="next-button"]');
    });

    it('should complete legal and compliance setup', async () => {
      // Upload business registration
      const businessRegInput = await page.locator('[data-testid="business-registration"]');
      await businessRegInput.setInputFiles({
        name: 'business-registration.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('fake-pdf-data')
      });
      
      // Upload tax certificate
      const taxCertInput = await page.locator('[data-testid="tax-certificate"]');
      await taxCertInput.setInputFiles({
        name: 'tax-certificate.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('fake-pdf-data')
      });
      
      // Upload health permit
      const healthPermitInput = await page.locator('[data-testid="health-permit"]');
      await healthPermitInput.setInputFiles({
        name: 'health-permit.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('fake-pdf-data')
      });
      
      // Accept terms and conditions
      await page.check('[data-testid="accept-terms"]');
      await page.check('[data-testid="accept-privacy-policy"]');
      await page.check('[data-testid="accept-merchant-agreement"]');
      
      // Sign merchant agreement
      await page.fill('[data-testid="signature-name"]', vendorDetails.ownerName);
      await page.fill('[data-testid="signature-title"]', 'Owner');
      
      // Draw signature (mock canvas interaction)
      const canvas = await page.locator('[data-testid="signature-pad"]');
      await canvas.click({ position: { x: 50, y: 50 } });
      await canvas.click({ position: { x: 100, y: 50 } });
      
      await page.click('[data-testid="submit-registration"]');
    });

    it('should verify successful tenant creation', async () => {
      // Wait for success page
      await page.waitForURL('**/vendor/registration-success');
      
      // Verify success message
      await expect(page.locator('[data-testid="success-message"]')).toContainText(
        'Welcome to Wakala, Uncle Charles Kitchen!'
      );
      
      // Verify tenant was created in backend
      const tenant = await tenantService.getTenantByDomain('unclecharles.wakala.com');
      expect(tenant).toBeDefined();
      expect(tenant.name).toBe('Uncle Charles Kitchen');
      expect(tenant.status).toBe('ACTIVE');
      
      // Verify WhatsApp configuration
      const whatsappConfig = await whatsappService.getTenantConfig(tenant.id);
      expect(whatsappConfig).toBeDefined();
      expect(whatsappConfig.phoneNumber).toBe('+263771234567');
      
      // Verify payment configuration
      const paymentConfig = await paymentService.getTenantConfig(tenant.id);
      expect(paymentConfig.supportedMethods).toContain('ecocash');
      expect(paymentConfig.supportedMethods).toContain('onemoney');
    });

    it('should receive welcome WhatsApp message', async () => {
      // Mock WhatsApp message reception
      const welcomeMessage = await whatsappService.getLastMessageSent('+263771234567');
      
      expect(welcomeMessage).toBeDefined();
      expect(welcomeMessage.text).toContain('Welcome to Wakala');
      expect(welcomeMessage.text).toContain('Your vendor account has been successfully created');
      expect(welcomeMessage.buttons).toContainEqual(
        expect.objectContaining({
          id: 'view_dashboard',
          title: 'View Dashboard'
        })
      );
    });

    it('should access vendor dashboard', async () => {
      // Click dashboard link from success page
      await page.click('[data-testid="go-to-dashboard"]');
      
      // Login with credentials
      await page.fill('[data-testid="email"]', vendorDetails.email);
      await page.fill('[data-testid="password"]', 'TempPassword123!'); // Sent via email
      await page.click('[data-testid="login-button"]');
      
      // Wait for dashboard
      await page.waitForURL('**/vendor/dashboard');
      
      // Verify dashboard elements
      await expect(page.locator('[data-testid="business-name"]')).toContainText('Uncle Charles Kitchen');
      await expect(page.locator('[data-testid="tenant-id"]')).toContainText('uncle-charles-kitchen');
      
      // Verify key metrics are displayed
      await expect(page.locator('[data-testid="total-orders"]')).toContainText('0');
      await expect(page.locator('[data-testid="total-revenue"]')).toContainText('$0.00');
      await expect(page.locator('[data-testid="active-menu-items"]')).toContainText('3');
      
      // Verify quick actions
      await expect(page.locator('[data-testid="add-menu-item-action"]')).toBeVisible();
      await expect(page.locator('[data-testid="view-orders-action"]')).toBeVisible();
      await expect(page.locator('[data-testid="manage-drivers-action"]')).toBeVisible();
    });

    it('should configure first promotion', async () => {
      // Navigate to promotions
      await page.click('[data-testid="nav-promotions"]');
      
      // Create welcome promotion
      await page.click('[data-testid="create-promotion"]');
      await page.fill('[data-testid="promotion-name"]', 'Grand Opening - 20% Off');
      await page.fill('[data-testid="promotion-description"]', 'Get 20% off all orders this week!');
      await page.selectOption('[data-testid="promotion-type"]', 'percentage');
      await page.fill('[data-testid="discount-value"]', '20');
      await page.fill('[data-testid="min-order-amount"]', '10.00');
      
      // Set duration
      await page.fill('[data-testid="start-date"]', new Date().toISOString().split('T')[0]);
      await page.fill('[data-testid="end-date"]', 
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      );
      
      // Configure auto-broadcast
      await page.check('[data-testid="auto-broadcast-whatsapp"]');
      await page.fill('[data-testid="broadcast-message"]', 
        '🎉 Uncle Charles Kitchen is now on Wakala! 🎉\n\n' +
        'Celebrate with us - get 20% off all orders this week!\n' +
        'Use code: GRAND20\n\n' +
        'Order now: wa.me/263771234567'
      );
      
      await page.click('[data-testid="create-promotion-button"]');
      
      // Verify promotion created
      await expect(page.locator('[data-testid="promotion-created-success"]')).toBeVisible();
    });
  });

  describe('Post-Onboarding Verification', () => {
    it('should verify all systems are operational', async () => {
      const tenant = await tenantService.getTenantByDomain('unclecharles.wakala.com');
      
      // Test WhatsApp webhook
      const webhookTest = await whatsappService.testWebhook(tenant.id);
      expect(webhookTest.success).toBe(true);
      
      // Test payment gateway
      const paymentTest = await paymentService.testGateway(tenant.id, 'ecocash');
      expect(paymentTest.success).toBe(true);
      
      // Verify menu items are searchable
      const menuItems = await page.evaluate(async () => {
        const response = await fetch('/api/v1/menu/search?q=sadza', {
          headers: {
            'X-Tenant-ID': 'uncle-charles-kitchen'
          }
        });
        return response.json();
      });
      
      expect(menuItems.results.length).toBeGreaterThan(0);
      expect(menuItems.results[0].name).toContain('Sadza');
    });

    it('should send test order through WhatsApp', async () => {
      // Simulate customer WhatsApp message
      const testMessage = {
        entry: [{
          id: 'uncle-charles-kitchen',
          changes: [{
            value: {
              messages: [{
                from: '263776543210',
                id: 'test-msg-001',
                timestamp: Date.now(),
                type: 'text',
                text: { body: 'Hi, I want to order food' }
              }]
            }
          }]
        }]
      };
      
      const response = await whatsappService.handleWebhook(testMessage);
      expect(response.status).toBe('processed');
      
      // Verify menu was sent
      const sentMessages = await whatsappService.getSentMessages('263776543210');
      expect(sentMessages.some(m => m.text?.includes('Welcome to Uncle Charles Kitchen'))).toBe(true);
      expect(sentMessages.some(m => m.interactive?.type === 'list')).toBe(true);
    });
  });
});