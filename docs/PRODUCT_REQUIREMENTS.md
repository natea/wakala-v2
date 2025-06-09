### **Wakala & Kasipulse Integration: Initial Strategy & PRD**

* **Project:** Wakala OS Pilot \- Kasipulse Integration  
* **Date:** June 6, 2025  
* **Author:** Kris Mondlane (via Gemini Assistant)  
* **Status:** Version 1.0 \- Draft for Review

### **Part 1: Initial Strategy Document**

#### **1\. Overview & Vision**

This document outlines the strategy and requirements for the pilot integration of **Kasipulse** (`Kasipulse.store` and `Kasipulse.run`) as the first flagship tenant on the Wakala Operating System.

The vision is to create a seamless, end-to-end, WhatsApp-native experience that allows Kasipulse's vendors to easily list products and customers to purchase them, with integrated payments and hyper-local delivery. This pilot will serve as the foundational proof-of-concept for the Wakala OS model, demonstrating our ability to empower local entrepreneurs by solving their core technology challenges.

#### **2\. Strategic Goals**

The primary objectives for this pilot are:

1. **Validate the Wakala OS Model:** Prove that our multi-tenant orchestration engine can successfully power a third-party's business operations via WhatsApp.  
2. **Solve the "Uncle Charles" Problem:** Demonstrate tangible value by creating an AI-powered conversational onboarding flow that makes it radically simple for non-tech-savvy vendors to list products.  
3. **Test Core Platform Pillars:** Implement and test our shared **Payments** and **KYC** service layers in a real-world transactional environment.  
4. **Create a Reusable E-commerce Template:** Develop a set of conversational flows and integrations that can be templatized and rapidly deployed for future e-commerce tenants on the Wakala platform.

#### **3\. Key Partners & Roles**

* **Wakala (Platform & Integrator):**  
  * Provides the core Wakala OS, including the AI orchestration engine and WhatsApp integration.  
  * Develops the conversational user flows (the "apps") for vendor onboarding, customer purchasing, and driver dispatch.  
  * Integrates and manages the shared Payment Gateway and KYC provider services.  
* **Kasipulse (Lionel \- Technical Partner):**  
  * Provides and maintains the backend logic, databases, and APIs for `Kasipulse.store` (product/order management) and `Kasipulse.run` (delivery/driver management).  
  * Acts as the primary technical liaison for the API integration.  
* **Kasipulse (Joanie \- Business & Community Partner):**  
  * Provides deep domain expertise and validates the user experience.  
  * Recruits and manages the pilot group of vendors, customers, and drivers in Mitchells Plain.  
  * Leads on-the-ground user testing and feedback collection.

---

### **Part 2: Product Requirements Document (PRD)**

#### **1\. Introduction & Problem Statement**

**Problem:** Township entrepreneurs in communities like Mitchells Plain face significant barriers to participating in the digital economy. Existing e-commerce platforms like Shopify are too expensive and technically complex for aspiring sellers who may lack digital literacy. This results in lost economic opportunity and keeps local commerce offline and inefficient.

**Solution:** This project will create a suite of WhatsApp-based "apps" on the Wakala OS that allows Kasipulse vendors to manage their online stores and customers to buy from them through simple, guided conversations, with logistics handled by a local driver network.

#### **2\. Personas**

* **"Uncle Charles" \- The Aspiring Vendor:**  
  * A pensioner with deep community ties and valuable products/skills (e.g., gardening).  
  * Owns a smartphone and uses WhatsApp but is not tech-savvy. Is intimidated by terms like "banner" or "product description."  
  * **Goal:** To sell his products to a wider audience without needing to learn how to use a computer or complex software.  
* **Brenda \- The Local Buyer:**  
  * A resident of Mitchells Plain who is comfortable with WhatsApp and online payments.  
  * She wants to support local businesses but values the convenience of e-commerce.  
  * **Goal:** To easily discover and purchase products from local sellers and receive them quickly.  
* **David \- The Delivery Driver:**  
  * A local resident with a vehicle, looking for flexible work.  
  * He needs a simple way to receive and accept delivery jobs and get paid reliably. He does not want to use a complex, data-heavy mobile app.  
  * **Goal:** To get a steady stream of delivery requests on WhatsApp and manage his work and payments easily.

#### **3\. Core User Journeys (Epics)**

1. **Epic 1: Vendor Onboarding & Product Listing:** The end-to-end process for a seller like Uncle Charles to set up their store and list their first product.  
2. **Epic 2: Customer Discovery & Purchase:** The end-to-end process for a buyer like Brenda to find a product, pay for it, and receive confirmation.  
3. **Epic 3: Order Fulfillment & Delivery:** The workflow that connects the vendor, driver, and customer after a purchase is made.

#### **4\. User Stories & Conversational Flow "Receipts"**

##### **Epic 1: Vendor Onboarding & Product Listing**

* **User Story:** As Uncle Charles, I want to list a product for sale by sending a picture and answering simple questions so that I can start selling without any technical confusion.

**Conversational Flow "Receipt" (Vendor Product Listing):**

 \[User\]: I want to sell something

\[Wakala Bot\]: Great\! I can help with that. Let's list your new product on Kasipulse.store. First, please send me a clear photo of the item you want to sell.

\[User\]: (Sends an image: photo\_of\_potatoes.jpg)

\[Wakala Bot\]: Thanks\! That looks like a great product. I've optimized the image for you.

\[Wakala Bot\]: Now, what is the name of this product?  
(e.g., "Fresh Potatoes")

\[User\]: Uncle Charles's Fresh Potatoes

\[Wakala Bot\]: Perfect. Now, what price do you want to sell it for (in Rand)?  
(e.g., "50")

\[User\]: 50

\[Wakala Bot\]: Got it. Lastly, tell me a little bit about it. What makes it special? Don't worry, just a few words is fine\!

\[User\]: Fresh from my garden in Westridge. Very tasty.

\[Wakala Bot\]: Excellent. Let me put that all together for you.

\[Wakala Bot\]: \--- DRAFT \---  
\* \*\*Name:\*\* Uncle Charles's Fresh Potatoes  
\* \*\*Price:\*\* R50.00  
\* \*\*Description:\*\* Support local\! These delicious potatoes are grown fresh in Uncle Charles's garden in Westridge. Perfect for any meal\!  
\* \[Image: photo\_of\_potatoes.jpg\]  
\---  
Does this look correct?  
\[Quick Reply: Yes, List It\!\] \[Quick Reply: No, Change Something\]

\[User\]: (Clicks 'Yes, List It\!')

\[Wakala Bot\]: Fantastic\! Your product "Uncle Charles's Fresh Potatoes" is now live on Kasipulse.store. We will notify you when you get your first order\!

* 

##### **Epic 2: Customer Discovery & Purchase**

* **User Story:** As Brenda, I want to search for products from local sellers, add one to my cart, and pay for it securely, all within WhatsApp.

**Conversational Flow "Receipt" (Customer Purchase):**

 \[User\]: Hi Wakala, I'm looking for a hoodie in Mitchells Plain

\[Wakala Bot\]: Hi Brenda\! Searching Kasipulse.store for "hoodie"... Here's what I found from local sellers:

\[Wakala Bot\]: (Sends a rich media message with an image)  
\* \*\*1. Kasipulse Classic Hoodie\*\*  
\* \*\*Seller:\*\* Joanie's Swag  
\* \*\*Price:\*\* R350.00  
\* \[View Details\] \[Add to Cart\]

\[User\]: (Clicks 'Add to Cart')

\[Wakala Bot\]: The "Kasipulse Classic Hoodie" has been added to your cart. Your total is R350.00. Ready to checkout?  
\[Quick Reply: Checkout\] \[Quick Reply: Continue Shopping\]

\[User\]: (Clicks 'Checkout')

\[Wakala Bot\]: Please confirm your delivery address:  
\* 123 Hope Street, Westridge, Mitchells Plain  
Is this correct?  
\[Quick Reply: Yes, Confirm Address\] \[Quick Reply: Use Different Address\]

\[User\]: (Clicks 'Yes, Confirm Address')

\[Wakala Bot\]: Great\! Please choose your payment method. You will be redirected to our secure payment partner, Paystack.  
\[Button: Pay R350.00 with Paystack\]

\[User\]: (Clicks button, completes payment on Paystack's secure page, and returns to WhatsApp)

\[Wakala Bot\]: ✅ Payment successful\! Thank you for your order, Brenda. We've sent your order \#1024 to Joanie's Swag. You will receive a notification once it's out for delivery with Kasipulse.run.

* 

##### **Epic 3: Order Fulfillment & Delivery**

* **User Story (Driver):** As David, I want to receive a notification for a new delivery job on WhatsApp, see the fee, and accept it with one tap so I can quickly start earning.

* **User Story (Vendor):** As Joanie, once an order is ready, I want to notify all available drivers so the closest one can pick it up promptly.

* **User Story (KYC):** As David, before my first payout, I need to complete a simple, one-time identity verification to ensure my account is secure.

**Conversational Flow "Receipt" (Driver Dispatch & KYC):**

 // Step 1: Vendor marks order as "Ready for Pickup" in their interface  
// Step 2: Wakala sends a broadcast to available Kasipulse.run drivers

\[Wakala Bot\]: 🚚 New Delivery Job Available\!  
\* \*\*Order \#:\*\* 1024  
\* \*\*Pickup:\*\* Joanie's Swag (Container Park, Mitchells Plain)  
\* \*\*Dropoff:\*\* 123 Hope Street, Westridge  
\* \*\*Delivery Fee:\*\* R40.00  
\[Button: Accept Job\]

\[David\]: (Clicks 'Accept Job')

\[Wakala Bot\]: You've got it, David\! Order \#1024 is yours. Please head to Joanie's Swag for pickup. The customer has been notified.

\--- Sometime later, after first successful delivery \---

\[Wakala Bot\]: Congratulations on your first delivery, David\! To process your first payout of R40.00, we need to complete a quick, one-time identity verification with our partner, Smile Identity. This keeps your earnings secure. Ready to start?

\[David\]: Yes

\[Wakala Bot\]: Great. Please take a clear photo of the front of your South African ID card or Driver's License.

\[David\]: (Sends image of ID)

\[Wakala Bot\]: Thanks. Now, please take a selfie so we can match it to your ID. Look straight at the camera.

\[David\]: (Sends selfie)

\[Wakala Bot\]: Verifying... ✅ All done\! Your identity is confirmed. Your payout of R40.00 will be processed in the next payment cycle. Thanks for helping keep the Kasipulse network secure\!

* 

#### **5\. Technical Integration Points**

* **Kasipulse.store API:**  
  * `POST /products`: To create/update a product listing from the vendor flow.  
  * `GET /products`: To search for products for the customer.  
  * `POST /orders`: To create a new order after successful payment.  
* **Kasipulse.run API:**  
  * `GET /drivers/available`: To find drivers to notify for a new job.  
  * `POST /deliveries`: To create a new delivery record and assign it to a driver.  
  * `PUT /deliveries/{id}`: To update the status of a delivery (e.g., picked up, delivered).  
* **Payment Gateway API (e.g., Paystack):**  
  * API call to generate a unique payment link for a specific transaction amount.  
  * Webhook to receive confirmation of a successful payment.  
* **KYC Provider API (e.g., Smile Identity):**  
  * API calls to submit ID and selfie images for verification.  
  * Webhook to receive the verification result (pass/fail).

#### **6\. Out of Scope for MVP**

* Advanced vendor analytics dashboard.  
* Customer accounts with order history (all interactions are stateless for MVP).  
* Product returns or disputes management.  
* Complex inventory tracking (e.g., tracking raw materials).  
* Multi-language support (English only for MVP).

#### **7\. Success Metrics**

* **Vendor Onboarding:**  
  * **of vendors successfully onboarded via the WhatsApp flow.**

  * Average time from starting the flow to listing the first product \< 10 minutes.  
* **Transactions:**  
  * **of successful end-to-end purchase transactions.**

  * Total Gross Merchandise Value (GMV) processed.  
* **Delivery & KYC:**  
  * **of drivers successfully onboarded and KYC-verified.**

  * Average time from a job broadcast to driver acceptance \< 5 minutes.  
* **User Satisfaction (Qualitative):**  
  * Direct feedback from Joanie, Uncle Charles, Brenda, and David via user interviews.