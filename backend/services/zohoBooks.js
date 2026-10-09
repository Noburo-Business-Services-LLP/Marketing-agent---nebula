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
    console.error(`📄 [ZOHO] Token refresh failed:`, data);
    throw new Error(`Zoho token refresh failed: ${data.error}`);
  }

  console.log(`📄 [ZOHO] Token refreshed successfully`);
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

  const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}organization_id=${orgId}`;
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
    console.error(`📄 [ZOHO] API error on ${method} ${endpoint}:`, JSON.stringify(data, null, 2));
    if (body) console.error(`📄 [ZOHO] Request body was:`, JSON.stringify(body, null, 2));
    throw new Error(`Zoho Books API error: ${data.message || JSON.stringify(data)}`);
  }

  console.log(`📄 [ZOHO] ${method} ${endpoint} — success`);
  return data;
}

/**
 * Get or create the 18% GST tax and return its tax_id
 */
let cachedTaxId = null;
async function getGST18TaxId() {
  if (cachedTaxId) return cachedTaxId;

  try {
    // List existing taxes
    const taxList = await zohoRequest('GET', '/settings/taxes');
    console.log('📄 [ZOHO] Available taxes:', JSON.stringify(taxList.taxes, null, 2));

    // Find existing 18% GST tax
    const gst18 = (taxList.taxes || []).find(t => t.tax_percentage === 18);
    if (gst18) {
      cachedTaxId = gst18.tax_id;
      console.log(`📄 [ZOHO] Found existing 18% tax: ${gst18.tax_name} (${cachedTaxId})`);
      return cachedTaxId;
    }

    // Create 18% GST tax if not found
    const newTax = await zohoRequest('POST', '/settings/taxes', {
      tax_name: 'GST',
      tax_percentage: 18,
      tax_type: 'tax'
    });
    cachedTaxId = newTax.tax.tax_id;
    console.log(`📄 [ZOHO] Created 18% GST tax: ${cachedTaxId}`);
    return cachedTaxId;
  } catch (e) {
    console.error('📄 [ZOHO] Failed to get/create tax:', e.message);
    return ''; // fallback — let Zoho decide
  }
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
    gst_treatment: 'consumer',
    place_of_supply: 'TN',
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
  // Newer purchases pass an item name and a GST rate: GST is its own line and the
  // contact is not tax-exempt. Without them the original behaviour is unchanged.
  const gstPercent = params.gstPercent || 0;
  const paidAmount = params.totalAmount || amount;

  // Step 1: Get or create contact
  const contactId = await getOrCreateContact({ email, firstName, lastName, companyName });

  // Step 1b: Update contact with tax exemption (original invoices only)
  if (!gstPercent) try {
    await zohoRequest('PUT', `/contacts/${contactId}`, {
      gst_treatment: 'consumer',
      tax_exemption_id: '3659166000000048005',
      place_of_supply: 'TN'
    });
    console.log('📄 [ZOHO] Updated contact with tax exemption');
  } catch (e) {
    console.warn('📄 [ZOHO] Could not update contact tax exemption:', e.message);
  }

  // Step 2: Create invoice
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  let lineItem = {
    name: `Nebulaa - ${credits} Quarks`,
    description: `${credits} AI marketing Quarks for Nebulaa platform`,
    rate: amount,
    quantity: 1
  };
  const invoiceData = {
    customer_id: contactId,
    date: today,
    is_inclusive_tax: false,
    gst_treatment: 'consumer',
    tax_exemption_id: '3659166000000048005',
    place_of_supply: 'TN',
    line_items: [lineItem],
    notes: `Payment via Razorpay (${razorpayPaymentId})`,
    reference_number: razorpayPaymentId
  };
  if (gstPercent) {
    const taxId = await getGST18TaxId();
    if (!taxId) throw new Error('18% GST tax is not set up in Zoho Books');
    lineItem.name = params.itemName;
    lineItem.description = params.description || params.itemName;
    lineItem.tax_id = taxId;
    delete invoiceData.tax_exemption_id;
  }

  const invoiceResult = await zohoRequest('POST', '/invoices', invoiceData);
  const invoice = invoiceResult.invoice;

  // Step 2b: an invoice created through the API starts as a draft; a customer-facing paid invoice is "sent".
  await markInvoiceSent(invoice.invoice_id);

  // Step 3: Record payment against the invoice
  try {
    await recordPayment({ customerId: contactId, invoiceId: invoice.invoice_id, amount: paidAmount, date: today, mode: 'Razorpay', reference: razorpayPaymentId });
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

// ---------------------------------------------------------------------------------------------------------------
// Managed clients: read invoices, create one for a service month, mark it sent, record how it was paid.
// ---------------------------------------------------------------------------------------------------------------

/** Marks a draft invoice as sent. Never throws: a failure here must not lose the invoice. */
async function markInvoiceSent(invoiceId) {
  try {
    await zohoRequest('POST', `/invoices/${invoiceId}/status/sent`);
    return true;
  } catch (e) {
    console.warn('📄 [ZOHO] Could not mark the invoice as sent (non-blocking):', e.message);
    return false;
  }
}

// Zoho's own payment modes; anything else is sent as 'other' so a missing custom mode never blocks recording.
const ZOHO_MODE = { bank: 'banktransfer', cheque: 'check', cash: 'cash', upi: 'other', razorpay: 'other', other: 'other' };

/** Records a payment against an invoice. `mode` may be one of our names (bank, cheque, ...) or a Zoho mode. */
async function recordPayment({ customerId, invoiceId, amount, date, mode, reference }) {
  const base = {
    customer_id: customerId, amount, date, reference_number: reference || '',
    invoices: [{ invoice_id: invoiceId, amount_applied: amount }]
  };
  const wanted = ZOHO_MODE[mode] || mode || 'other';
  try {
    return await zohoRequest('POST', '/customerpayments', { ...base, payment_mode: wanted });
  } catch (e) {
    if (wanted === 'other') throw e;
    return zohoRequest('POST', '/customerpayments', { ...base, payment_mode: 'other' }); // custom mode not set up in Zoho
  }
}

/** A shareable link for the customer, or null. */
async function sharingUrl(invoiceId) {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${BASE_URL}/invoices/${invoiceId}/sharingurl?organization_id=${process.env.ZOHO_BOOKS_ORG_ID}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const d = await res.json();
    return d.code === 0 && d.sharing_url ? d.sharing_url : null;
  } catch (e) {
    return null;
  }
}

const slim = (i) => ({
  invoiceId: i.invoice_id, invoiceNumber: i.invoice_number, customerId: i.customer_id, customerName: i.customer_name || '',
  email: String(i.email || '').toLowerCase(), date: i.date, dueDate: i.due_date, status: i.status,
  total: Number(i.total) || 0, balance: Number(i.balance) || 0, lastPaymentDate: i.last_payment_date || '', reference: i.reference_number || ''
});

let invoiceCache = { at: 0, rows: [] };
/** Every invoice of the organisation (about a minute of cache), newest first. */
async function listInvoices({ force = false } = {}) {
  if (!force && Date.now() - invoiceCache.at < 60000 && invoiceCache.rows.length) return invoiceCache.rows;
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const d = await zohoRequest('GET', `/invoices?per_page=200&page=${page}&sort_column=date&sort_order=D`);
    rows.push(...(d.invoices || []).map(slim));
    if (!d.page_context || !d.page_context.has_more_page) break;
  }
  invoiceCache = { at: Date.now(), rows };
  return rows;
}

/** One invoice with its amounts before and after tax. */
async function getInvoice(invoiceId) {
  const d = await zohoRequest('GET', `/invoices/${invoiceId}`);
  const i = d.invoice || {};
  return {
    ...slim(i), subTotal: Number(i.sub_total) || 0, taxTotal: Number(i.tax_total) || 0,
    invoiceUrl: i.invoice_url || '', paymentsCount: Array.isArray(i.payments) ? i.payments.length : 0,
    lineItems: (i.line_items || []).map((l) => ({ itemId: l.item_id || '', name: l.name || '', description: l.description || '', rate: Number(l.rate) || 0, quantity: Number(l.quantity) || 1 }))
  };
}

/** The tax_id of a GST rate in this organisation, or '' when there is none. Only 18 percent is created automatically. */
async function getGstTaxId(percent) {
  if (Number(percent) === 18) return getGST18TaxId();
  const list = await zohoRequest('GET', '/settings/taxes');
  const hit = (list.taxes || []).find((t) => t.tax_percentage === Number(percent));
  return hit ? hit.tax_id : '';
}

let itemCache = { at: 0, rows: [] };
/** The products (plans) of the organisation: id, name, description and price before tax. */
async function listItems({ force = false } = {}) {
  if (!force && Date.now() - itemCache.at < 300000 && itemCache.rows.length) return itemCache.rows;
  const d = await zohoRequest('GET', '/items?per_page=200');
  const rows = (d.items || []).filter((i) => i.status !== 'inactive').map((i) => ({ itemId: i.item_id, name: i.name || '', description: i.description || '', rate: Number(i.rate) || 0 }));
  itemCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Creates the invoice for one service month of a managed client (not yet marked sent or paid) and returns
 * { invoiceId, invoiceNumber, customerId }. The reference makes a retry safe: an invoice that already carries
 * the same reference is returned instead of creating a second one.
 */
async function createManagedInvoice(p) {
  const existing = (await listInvoices({ force: true })).find((i) => i.reference === p.reference);
  if (existing) return { invoiceId: existing.invoiceId, invoiceNumber: existing.invoiceNumber, customerId: existing.customerId, reused: true };
  const taxId = await getGstTaxId(p.gstPercent);
  if (!(Number(p.gstPercent) > 0)) throw new Error('Automatic invoices need a GST rate above 0%. Raise this invoice in Zoho Books and link it.');
  if (!taxId) throw new Error(`A ${p.gstPercent}% GST tax is not set up in Zoho Books`);
  const contactId = p.customerId || await getOrCreateContact({ email: p.email, firstName: p.firstName, lastName: p.lastName, companyName: p.companyName });
  const line = { name: p.itemName, description: p.description || p.itemName, rate: p.exInr, quantity: 1 };
  if (p.itemId) line.item_id = p.itemId; // the plan as a product of the organisation, so reports group by plan
  line.tax_id = taxId;
  const data = {
    customer_id: contactId, date: p.date, due_date: p.dueDate, is_inclusive_tax: false, gst_treatment: 'consumer', place_of_supply: 'TN',
    line_items: [line], reference_number: p.reference, notes: p.notes || ''
  };
  const out = await zohoRequest('POST', '/invoices', data);
  invoiceCache = { at: 0, rows: [] };
  return { invoiceId: out.invoice.invoice_id, invoiceNumber: out.invoice.invoice_number, customerId: contactId, reused: false };
}

module.exports = { createInvoice, listItems, listInvoices, getInvoice, createManagedInvoice, markInvoiceSent, recordPayment, sharingUrl, getGstTaxId };
