import { IncomingMessage } from '../interfaces/whatsapp.interface';

export interface Intent {
  name: string;
  confidence: number;
  entities: Record<string, any>;
}

export interface NLPResponse {
  intent: Intent;
  suggestedResponse: string;
  quickReplies?: string[];
  requiresContext?: boolean;
}

export class NLPService {
  /**
   * Process incoming message and extract intent
   */
  async processMessage(message: IncomingMessage): Promise<NLPResponse> {
    let text = '';
    
    // Handle different message types
    if (message.type === 'text') {
      text = message.text?.body?.toLowerCase() || '';
    } else if (message.type === 'interactive') {
      // Handle button replies
      if (message.interactive?.type === 'button_reply') {
        text = message.interactive.button_reply?.title?.toLowerCase() || '';
      }
      // Handle list replies
      else if (message.interactive?.type === 'list_reply') {
        text = message.interactive.list_reply?.title?.toLowerCase() || '';
      }
    }
    
    // Simple intent matching for MVP
    if (this.matchGreeting(text)) {
      return this.handleGreeting();
    }
    
    if (this.matchOrderIntent(text)) {
      return this.handleOrderIntent(text);
    }
    
    if (this.matchRestaurantSearch(text)) {
      return this.handleRestaurantSearch(text);
    }
    
    if (this.matchMenuRequest(text)) {
      return this.handleMenuRequest(text);
    }
    
    if (this.matchOrderStatus(text)) {
      return this.handleOrderStatus();
    }
    
    if (this.matchHelp(text)) {
      return this.handleHelp();
    }
    
    if (this.matchPaymentQuery(text)) {
      return this.handlePaymentQuery();
    }
    
    if (this.matchDeliveryQuery(text)) {
      return this.handleDeliveryQuery();
    }
    
    if (this.matchCancellation(text)) {
      return this.handleCancellation();
    }
    
    // Handle quick reply buttons
    if (this.matchQuickReply(text)) {
      return this.handleQuickReply(text);
    }
    
    // Check if this might be an address
    if (this.isPossibleAddress(text)) {
      return this.handleAddressInput(text);
    }
    
    // Default fallback
    return this.handleUnknown();
  }

  private matchGreeting(text: string): boolean {
    const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
    return greetings.some(greeting => text.includes(greeting));
  }

  private matchOrderIntent(text: string): boolean {
    const orderKeywords = ['order', 'want', 'like to order', 'get', 'buy', 'purchase'];
    return orderKeywords.some(keyword => text.includes(keyword));
  }

  private matchRestaurantSearch(text: string): boolean {
    const searchKeywords = ['restaurant', 'restaurants', 'places', 'where', 'find', 'available', 'near'];
    return searchKeywords.some(keyword => text.includes(keyword));
  }

  private matchMenuRequest(text: string): boolean {
    const menuKeywords = ['menu', 'items', 'what do you have', 'options', 'dishes'];
    return menuKeywords.some(keyword => text.includes(keyword));
  }

  private matchOrderStatus(text: string): boolean {
    const statusKeywords = ['status', 'where is my', 'track', 'delivery time', 'when will'];
    return statusKeywords.some(keyword => text.includes(keyword));
  }

  private matchHelp(text: string): boolean {
    const helpKeywords = ['help', 'support', 'assist', 'how do i', 'how to'];
    return helpKeywords.some(keyword => text.includes(keyword));
  }

  private matchPaymentQuery(text: string): boolean {
    const paymentKeywords = ['payment', 'pay', 'card', 'cash', 'wallet', 'methods'];
    return paymentKeywords.some(keyword => text.includes(keyword));
  }

  private matchDeliveryQuery(text: string): boolean {
    const deliveryKeywords = ['delivery', 'deliver', 'cost', 'fee', 'charge', 'how much'];
    return deliveryKeywords.some(keyword => text.includes(keyword));
  }

  private matchCancellation(text: string): boolean {
    const cancelKeywords = ['cancel', 'stop', 'remove', 'delete'];
    return cancelKeywords.some(keyword => text.includes(keyword));
  }

  private matchQuickReply(text: string): boolean {
    const quickReplies = ['order food', 'track order', 'browse restaurants', 'view restaurants', 
                         'payment info', 'delivery info', 'back', 'see all',
                         'pizza', 'burgers', 'chinese', 'nigerian', 'indian',
                         'view menu #1', 'view menu #2', 'view menu #3',
                         'order large pizza', 'order medium pizza', 'back to restaurants'];
    return quickReplies.includes(text);
  }

  private isPossibleAddress(text: string): boolean {
    // Simple heuristics to detect if input might be an address
    const addressIndicators = [
      /\d+\s+\w+/,  // Number followed by street name
      /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|blvd|boulevard)\b/i,
      /\b(apt|apartment|suite|unit|#)\b/i,
      /\b\d{5}\b/,  // ZIP code
      /\b(north|south|east|west|n|s|e|w)\b/i,
    ];
    
    const hasNumber = /\d/.test(text);
    const hasMultipleWords = text.split(' ').length > 2;
    const hasAddressPattern = addressIndicators.some(pattern => pattern.test(text));
    
    return (hasNumber && hasMultipleWords) || hasAddressPattern;
  }

  private handleGreeting(): NLPResponse {
    return {
      intent: { name: 'greeting', confidence: 0.95, entities: {} },
      suggestedResponse: `Welcome to Wakala! 🍔 I'm here to help you order delicious food. How can I assist you today?`,
      quickReplies: ['Order Food', 'Track Order', 'Browse Restaurants', 'Help']
    };
  }

  private handleOrderIntent(text: string): NLPResponse {
    // Extract potential food items
    const foodItems = this.extractFoodItems(text);
    
    if (foodItems.length > 0) {
      return {
        intent: { name: 'order', confidence: 0.9, entities: { foodItems } },
        suggestedResponse: `Great choice! I found "${foodItems.join(', ')}" in your request. Let me check which restaurants serve these items.\n\nWhat's your delivery address?`,
        requiresContext: true
      };
    }
    
    return {
      intent: { name: 'order', confidence: 0.85, entities: {} },
      suggestedResponse: `I'd be happy to help you order food! First, I'll need your delivery address.\n\nPlease share your full delivery address:`,
      requiresContext: true
    };
  }

  private handleRestaurantSearch(text: string): NLPResponse {
    // Extract location if mentioned
    const location = this.extractLocation(text);
    
    if (location) {
      return {
        intent: { name: 'restaurant_search', confidence: 0.9, entities: { location } },
        suggestedResponse: `Finding restaurants that deliver to ${location}...`,
        requiresContext: true
      };
    }
    
    return {
      intent: { name: 'restaurant_search', confidence: 0.85, entities: {} },
      suggestedResponse: `I'll help you find great restaurants! What's your delivery address?`,
      requiresContext: true
    };
  }

  private handleMenuRequest(text: string): NLPResponse {
    const cuisine = this.extractCuisineType(text);
    
    if (cuisine) {
      return {
        intent: { name: 'menu_request', confidence: 0.9, entities: { cuisine } },
        suggestedResponse: `Here are popular ${cuisine} restaurants:\n\n1. ${cuisine} Palace (4.5⭐)\n2. Express ${cuisine} (4.3⭐)\n3. ${cuisine} Delight (4.2⭐)\n\nWhich restaurant's menu would you like to see?`,
        quickReplies: ['View Menu #1', 'View Menu #2', 'View Menu #3', 'Back']
      };
    }
    
    return {
      intent: { name: 'menu_request', confidence: 0.85, entities: {} },
      suggestedResponse: `Which restaurant's menu would you like to see? Please tell me the restaurant name or type of cuisine.`,
      requiresContext: true
    };
  }

  private handleOrderStatus(): NLPResponse {
    return {
      intent: { name: 'order_status', confidence: 0.95, entities: {} },
      suggestedResponse: `To track your order, I'll need your order number. It usually starts with "ORD-" followed by numbers.\n\nYou can find it in your order confirmation message.`,
      requiresContext: true
    };
  }

  private handleHelp(): NLPResponse {
    return {
      intent: { name: 'help', confidence: 0.95, entities: {} },
      suggestedResponse: `I can help you with:\n\n📱 *Order Food* - Browse restaurants and place orders\n📍 *Track Orders* - Check your delivery status\n🍕 *View Menus* - See restaurant menus and prices\n💳 *Payment Info* - Learn about payment options\n🚚 *Delivery Info* - Check delivery fees and times\n\nWhat would you like to do?`,
      quickReplies: ['Order Food', 'Track Order', 'Payment Info', 'Delivery Info']
    };
  }

  private handlePaymentQuery(): NLPResponse {
    return {
      intent: { name: 'payment_query', confidence: 0.9, entities: {} },
      suggestedResponse: `We accept the following payment methods:\n\n💳 *Card Payment* - Visa, Mastercard, Verve\n💵 *Cash on Delivery*\n📱 *Mobile Wallets* - Paystack, Flutterwave\n🏦 *Bank Transfer*\n\nAll payments are secure and processed instantly.`
    };
  }

  private handleDeliveryQuery(): NLPResponse {
    return {
      intent: { name: 'delivery_query', confidence: 0.9, entities: {} },
      suggestedResponse: `Delivery fees vary by distance:\n\n🚴 *0-3km*: ₦500\n🛵 *3-7km*: ₦800\n🚗 *7-15km*: ₦1,200\n\nDelivery usually takes 30-45 minutes. You can track your rider in real-time once your order is confirmed.`
    };
  }

  private handleCancellation(): NLPResponse {
    return {
      intent: { name: 'cancellation', confidence: 0.9, entities: {} },
      suggestedResponse: `To cancel an order, please provide your order number. Note that orders can only be cancelled within 5 minutes of placement or before the restaurant starts preparing your food.`,
      requiresContext: true
    };
  }

  private handleUnknown(): NLPResponse {
    return {
      intent: { name: 'unknown', confidence: 0.3, entities: {} },
      suggestedResponse: `I'm not sure I understood that. Here's what I can help you with:`,
      quickReplies: ['Order Food', 'Track Order', 'View Restaurants', 'Help']
    };
  }

  private handleQuickReply(text: string): NLPResponse {
    switch(text) {
      case 'order food':
        return this.handleOrderIntent('order food');
      case 'track order':
        return this.handleOrderStatus();
      case 'browse restaurants':
      case 'view restaurants':
        return this.handleRestaurantSearch('');
      case 'payment info':
        return this.handlePaymentQuery();
      case 'delivery info':
        return this.handleDeliveryQuery();
      case 'see all':
        return {
          intent: { name: 'browse_all', confidence: 0.9, entities: {} },
          suggestedResponse: `Here are all available cuisine types:\n\n🍕 Pizza\n🍔 Burgers\n🥘 Nigerian\n🍜 Chinese\n🍛 Indian\n🌮 Mexican\n🍝 Italian\n🥗 Healthy\n\nWhich type would you like to explore?`
        };
      case 'back':
        return this.handleHelp();
      case 'pizza':
      case 'burgers':
      case 'chinese':
      case 'nigerian':
      case 'indian':
        return this.handleCuisineSelection(text);
      case 'view menu #1':
      case 'view menu #2':
      case 'view menu #3':
        return this.handleMenuSelection(text);
      case 'order large pizza':
      case 'order medium pizza':
        return this.handlePizzaOrder(text);
      case 'back to restaurants':
        return this.handleRestaurantSearch('');
      default:
        return this.handleUnknown();
    }
  }

  private handleAddressInput(address: string): NLPResponse {
    return {
      intent: { name: 'address_provided', confidence: 0.85, entities: { address } },
      suggestedResponse: `Great! I've noted your delivery address as:\n📍 ${address}\n\nNow, what type of food are you craving today?`,
      quickReplies: ['Pizza', 'Burgers', 'Chinese', 'Nigerian', 'Indian', 'See All']
    };
  }

  private handleCuisineSelection(cuisine: string): NLPResponse {
    const cuisineCapitalized = cuisine.charAt(0).toUpperCase() + cuisine.slice(1);
    const restaurantExamples: Record<string, string[]> = {
      'pizza': ['Domino\'s Pizza (4.5⭐)', 'Pizza Hut (4.3⭐)', 'Debonairs (4.2⭐)'],
      'burgers': ['Burger King (4.4⭐)', 'McDonald\'s (4.2⭐)', 'KFC (4.3⭐)'],
      'chinese': ['China Express (4.6⭐)', 'Wok This Way (4.4⭐)', 'Golden Dragon (4.3⭐)'],
      'nigerian': ['Mama Put (4.7⭐)', 'Kilimanjaro (4.5⭐)', 'Yellow Chilli (4.4⭐)'],
      'indian': ['Sherlaton Indian (4.6⭐)', 'Curry House (4.4⭐)', 'Spice Temple (4.3⭐)']
    };
    
    const restaurants = restaurantExamples[cuisine] || ['Restaurant 1', 'Restaurant 2', 'Restaurant 3'];
    
    return {
      intent: { name: 'cuisine_selected', confidence: 0.95, entities: { cuisine: cuisineCapitalized } },
      suggestedResponse: `Excellent choice! Here are the top ${cuisineCapitalized} restaurants in your area:\n\n${restaurants.map((r: string, i: number) => `${i+1}. ${r}`).join('\n')}\n\nWhich restaurant would you like to order from?`,
      quickReplies: ['View Menu #1', 'View Menu #2', 'View Menu #3']
    };
  }

  private handleMenuSelection(selection: string): NLPResponse {
    // Extract menu number
    const menuNumber = selection.match(/\d+/)?.[0] || '1';
    
    // In a real app, this would fetch actual menu data based on context
    // For now, we'll show sample menus
    const sampleMenus: Record<string, any> = {
      '1': {
        restaurant: 'Domino\'s Pizza',
        items: [
          '🍕 Pepperoni Pizza - Large: ₦4,500 | Medium: ₦3,200',
          '🍕 BBQ Chicken Pizza - Large: ₦5,000 | Medium: ₦3,500',
          '🍕 Veggie Supreme - Large: ₦4,200 | Medium: ₦3,000',
          '🍕 Meat Lovers - Large: ₦5,500 | Medium: ₦4,000',
          '🥤 Soft Drinks - ₦500',
          '🍟 Garlic Bread - ₦1,200'
        ]
      },
      '2': {
        restaurant: 'Pizza Hut',
        items: [
          '🍕 Super Supreme - Large: ₦4,800 | Medium: ₦3,400',
          '🍕 Hawaiian - Large: ₦4,500 | Medium: ₦3,200',
          '🍕 Chicken Supreme - Large: ₦5,200 | Medium: ₦3,700',
          '🍕 Margherita - Large: ₦3,800 | Medium: ₦2,800',
          '🥤 Beverages - From ₦400',
          '🍗 Wings (6pcs) - ₦2,500'
        ]
      },
      '3': {
        restaurant: 'Debonairs Pizza',
        items: [
          '🍕 Triple-Decker - Large: ₦5,200 | Medium: ₦3,800',
          '🍕 Meaty Triple - Large: ₦5,500 | Medium: ₦4,000',
          '🍕 Chicken & Mushroom - Large: ₦4,700 | Medium: ₦3,300',
          '🍕 Something Meaty - Large: ₦5,000 | Medium: ₦3,600',
          '🥤 2L Coke - ₦800',
          '🍞 Cheesy Bread - ₦1,500'
        ]
      }
    };
    
    const menu = sampleMenus[menuNumber] || sampleMenus['1'];
    
    return {
      intent: { name: 'menu_viewed', confidence: 0.95, entities: { restaurant: menu.restaurant, menuNumber } },
      suggestedResponse: `📋 *${menu.restaurant} Menu*\n\n${menu.items.join('\n')}\n\nWhat would you like to order? Just tell me the item and size!`,
      quickReplies: ['Order Large Pizza', 'Order Medium Pizza', 'Back to Restaurants']
    };
  }

  private handlePizzaOrder(text: string): NLPResponse {
    const size = text.includes('large') ? 'Large' : 'Medium';
    
    return {
      intent: { name: 'pizza_order_started', confidence: 0.95, entities: { size } },
      suggestedResponse: `Great! You're ordering a ${size} pizza.\n\nWhich pizza would you like?\n\n1. Pepperoni Pizza\n2. BBQ Chicken Pizza\n3. Veggie Supreme\n4. Meat Lovers\n\nJust type the number or name of the pizza you want!`,
      requiresContext: true
    };
  }

  private extractFoodItems(text: string): string[] {
    const commonFoods = [
      'pizza', 'burger', 'pasta', 'rice', 'chicken', 'beef', 'fish',
      'salad', 'sandwich', 'wrap', 'tacos', 'sushi', 'noodles',
      'jollof', 'suya', 'amala', 'eba', 'pounded yam', 'egusi',
      'pepperoni', 'margherita', 'hawaiian', 'veggie'
    ];
    
    const found: string[] = [];
    commonFoods.forEach(food => {
      if (text.includes(food)) {
        found.push(food);
      }
    });
    
    return found;
  }

  private extractLocation(text: string): string | null {
    // Simple location extraction - in production, use proper NER
    const locations = ['lekki', 'victoria island', 'ikeja', 'surulere', 'yaba', 'ikoyi'];
    
    for (const location of locations) {
      if (text.includes(location)) {
        return location.charAt(0).toUpperCase() + location.slice(1);
      }
    }
    
    return null;
  }

  private extractCuisineType(text: string): string | null {
    const cuisines = ['pizza', 'burger', 'chinese', 'indian', 'nigerian', 'italian', 'mexican'];
    
    for (const cuisine of cuisines) {
      if (text.includes(cuisine)) {
        return cuisine.charAt(0).toUpperCase() + cuisine.slice(1);
      }
    }
    
    return null;
  }
}