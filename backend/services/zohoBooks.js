/**
 * Zoho Books Service — Create invoices after Razorpay payment
 *
 * Flow:
 * 1. Get/create contact (customer) in Zoho Books
 * 2. Create invoice with line items
 * 3. Record payment against the invoice
 * 4. Return invoice URL for the user
 */

const BASE_URL = 'https://www.zohoapis.in/books/v3';

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Get a valid access token, refreshing if expired
 */
async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt) {
    return cachedAccessToken;
  }

  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_BOOKS_REFRESH_TOKEN,
    client_id: process.env.ZOHO_BOOKS_CLIENT_ID,
    client_secret: process.env.ZOHO_BOOKS_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });

  const res = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST',
    body: params
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Zoho token refresh failed: ${data.error}`);
  }

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // refresh 60s early
  return cachedAccessToken;
}

/**
 * Make an authenticated request to Zoho Books API
 */
async function zohoRequest(method, endpoint, body = null) {
  const token = await getAccessToken();
  const orgId = process.env.ZOHO_BOOKS_ORG_ID;

  const url = `${BASE_URL}${endpoint}?organization_id=${orgId}`;
  const options = {
    method,
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (data.code !== 0) {
    throw new Error(`Zoho Books API error: ${data.message || JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Find existing contact by email, or create a new one
 */
async function getOrCreateContact(customerInfo) {
  const { email, firstName, lastName, companyName } = customerInfo;

  // Search for existing contact
  try {
    const token = await getAccessToken();
    const orgId = process.env.ZOHO_BOOKS_ORG_ID;
    const searchUrl = `${BASE_URL}/contacts?organization_id=${orgId}&email=${encodeURIComponent(email)}`;

    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    const searchData = await searchRes.json();

    if (searchData.code === 0 && searchData.contacts?.length > 0) {
      return searchData.contacts[0].contact_id;
    }
  } catch (e) {
    console.warn('Zoho contact search failed, creating new:', e.message);
  }

  // Create new contact
  const contactData = {
    contact_name: companyName || `${firstName} ${lastName}`.trim(),
    contact_type: 'customer',
    email,
    contact_persons: [{
      first_name: firstName,
      last_name: lastName || '',
      email,
      is_primary_contact: true
    }]
  };

  if (companyName) {
    contactData.company_name = companyName;
  }

  const result = await zohoRequest('POST', '/contacts', contactData);
  return result.contact.contact_id;
}

/**
 * Create an invoice in Zoho Books and record payment
 *
 * @param {Object} params
 * @param {string} params.email - Customer email
 * @param {string} params.firstName - Customer first name
 * @param {string} params.lastName - Customer last name
 * @param {string} params.companyName - Customer company name
 * @param {number} params.amount - Amount in INR (e.g. 5000)
 * @param {number} params.credits - Credits purchased
 * @param {string} params.razorpayPaymentId - Razorpay payment ID for reference
 * @returns {Object} { invoiceId, invoiceNumber, invoiceUrl }
 */
async function createInvoice(params) {
  const { email, firstName, lastName, companyName, amount, credits, razorpayPaymentId } = params;

  // Step 1: Get or create contact
  const contactId = await getOrCreateContact({ email, firstName, lastName, companyName });

  // Step 2: Create invoice
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const invoiceData = {
    customer_id: contactId,
    date: today,
    line_items: [{
      name: `Nebulaa Gravity - ${credits} Credits`,
      description: `${credits} AI marketing credits for Nebulaa Gravity platform`,
      rate: amount,
      quantity: 1
    }],
    notes: `Payment via Razorpay (${razorpayPaymentId})`,
    reference_number: razorpayPaymentId
  };

  const invoiceResult = await zohoRequest('POST', '/invoices', invoiceData);
  const invoice = invoiceResult.invoice;

  // Step 3: Record payment against the invoice
  try {
    const paymentData = {
      customer_id: contactId,
      payment_mode: 'Razorpay',
      amount,
      date: today,
      reference_number: razorpayPaymentId,
      invoices: [{
        invoice_id: invoice.invoice_id,
        amount_applied: amount
      }]
    };

    await zohoRequest('POST', '/customerpayments', paymentData);
  } catch (e) {
    console.warn('Zoho payment recording failed (non-blocking):', e.message);
  }

  // Step 4: Get the shareable invoice URL
  let invoiceUrl = invoice.invoice_url || null;
  if (!invoiceUrl) {
    try {
      const token = await getAccessToken();
      const orgId = process.env.ZOHO_BOOKS_ORG_ID;
      const shareRes = await fetch(
        `${BASE_URL}/invoices/${invoice.invoice_id}/sharingurl?organization_id=${orgId}`,
        { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } }
      );
      const shareData = await shareRes.json();
      if (shareData.code === 0 && shareData.sharing_url) {
        invoiceUrl = shareData.sharing_url;
      }
    } catch (e) {
      console.warn('Zoho invoice share URL fetch failed:', e.message);
    }
  }

  return {
    invoiceId: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number,
    invoiceUrl
  };
}

module.exports = { createInvoice };
