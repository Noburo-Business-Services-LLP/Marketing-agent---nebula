/**
 * 
 * Lead Importer Service
 * 
 * AI-powered lead import system that handles:
 * - Excel/CSV file parsing
 * - Intelligent column mapping
 * - Data cleaning and validation
 * - Filtering out unnecessary data
 */

const XLSX = require('xlsx');
const geminiAI = require('./geminiAI');

// Common column name mappings for lead data
const COLUMN_MAPPINGS = {
  firstName: ['first name', 'firstname', 'first_name', 'fname', 'given name', 'givenname', 'name', 'contact name'],
  lastName: ['last name', 'lastname', 'last_name', 'lname', 'surname', 'family name'],
  email: ['email', 'e-mail', 'email address', 'emailaddress', 'email_address', 'contact email', 'work email'],
  phone: ['phone', 'telephone', 'phone number', 'phonenumber', 'phone_number', 'mobile', 'cell', 'contact phone', 'work phone', 'tel'],
  companyName: ['company', 'company name', 'companyname', 'company_name', 'organization', 'org', 'business', 'business name', 'employer'],
  companyWebsite: ['website', 'company website', 'url', 'web', 'company url', 'site', 'homepage'],
  companyIndustry: ['industry', 'sector', 'business type', 'vertical', 'category'],
  companySize: ['company size', 'size', 'employees', 'employee count', 'team size', 'headcount', 'company_size'],
  role: ['role', 'title', 'job title', 'jobtitle', 'job_title', 'position', 'designation', 'job role'],
  location: ['location', 'city', 'country', 'region', 'address', 'geography', 'area'],
  linkedinUrl: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedinurl', 'linkedin_url', 'profile url'],
  source: ['source', 'lead source', 'leadsource', 'lead_source', 'channel', 'origin', 'campaign source'],
  notes: ['notes', 'comments', 'description', 'remarks', 'additional info', 'additional_info']
};

// Columns to ignore (not relevant for lead data)
const IGNORE_PATTERNS = [
  /^id$/i, /^_id$/i, /^row$/i, /^index$/i, /^serial$/i, /^sr\.?$/i, /^s\.?no\.?$/i,
  /^created$/i, /^updated$/i, /^modified$/i, /^timestamp$/i, /^date$/i,
  /^password$/i, /^token$/i, /^key$/i, /^secret$/i,
  /^internal$/i, /^private$/i, /^hidden$/i,
  /^blank$/i, /^empty$/i, /^null$/i, /^undefined$/i,
  /^column\d+$/i, /^field\d+$/i, /^unnamed:/i
];

/**
 * Parse Excel/CSV file buffer and extract lead data
 */
const parseExcelBuffer = (buffer, filename) => {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON with headers
    const rawData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
      blankrows: false
    });
    
    if (rawData.length < 2) {
      throw new Error('File must contain at least a header row and one data row');
    }
    
    return {
      headers: rawData[0].map(h => String(h || '').trim()),
      rows: rawData.slice(1),
      sheetName,
      totalRows: rawData.length - 1
    };
  } catch (error) {
    throw new Error(`Failed to parse file: ${error.message}`);
  }
};

/**
 * Intelligently map column headers to lead fields
 */
const mapColumns = (headers) => {
  const mappings = {};
  const usedHeaders = new Set();
  
  // For each lead field, find the best matching column
  for (const [field, aliases] of Object.entries(COLUMN_MAPPINGS)) {
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      
      const normalizedHeader = header.toLowerCase().trim();
      
      // Check if header matches any alias
      if (aliases.some(alias => {
        return normalizedHeader === alias || 
               normalizedHeader.includes(alias) ||
               alias.includes(normalizedHeader);
      })) {
        mappings[field] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }
  
  // Determine which columns are unmapped and potentially useful
  const unmappedColumns = headers.filter(h => 
    !usedHeaders.has(h) && 
    h.trim() !== '' &&
    !IGNORE_PATTERNS.some(pattern => pattern.test(h))
  );
  
  return { mappings, unmappedColumns };
};

/**
 * Use AI to intelligently map unmapped columns
 */
const aiMapColumns = async (headers, unmappedColumns) => {
  if (unmappedColumns.length === 0) {
    return {};
  }
  
  try {
    const prompt = `You are analyzing column headers from a lead/contact spreadsheet.
    
Given these unmapped column headers: ${JSON.stringify(unmappedColumns)}

Map each column to one of these lead fields if appropriate:
- firstName (person's first name)
- lastName (person's last name)  
- email (email address)
- phone (phone number)
- companyName (company/organization name)
- companyWebsite (company website URL)
- companyIndustry (industry/sector)
- companySize (number of employees)
- role (job title/position)
- location (city/country/region)
- linkedinUrl (LinkedIn profile URL)
- source (lead source/channel)
- notes (additional notes/comments)
- IGNORE (not useful for leads - like IDs, timestamps, internal data)

Return ONLY a valid JSON object mapping column names to fields. Example:
{"Company HQ": "location", "Job Position": "role", "Record ID": "IGNORE"}`;

    const result = await geminiAI.callGemini(prompt);
    
    // Parse AI response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('AI column mapping failed:', error);
  }
  
  return {};
};

/**
 * Validate and clean a single lead row
 */
const cleanLeadRow = (row, headers, columnMappings) => {
  const lead = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: {
      name: '',
      website: '',
      industry: '',
      size: '',
      location: ''
    },
    role: '',
    linkedinUrl: '',
    source: 'import',
    notes: ''
  };
  
  // Map values to lead fields
  for (const [field, headerName] of Object.entries(columnMappings)) {
    if (field === 'IGNORE') continue;
    
    const colIndex = headers.indexOf(headerName);
    if (colIndex === -1) continue;
    
    let value = String(row[colIndex] || '').trim();
    if (!value) continue;
    
    // Clean and validate based on field type
    switch (field) {
      case 'email':
        // Basic email validation - more lenient
        const cleanEmail = value.toLowerCase().trim();
        if (cleanEmail.includes('@')) {
          lead.email = cleanEmail;
        }
        break;
        
      case 'phone':
        // Clean phone number (remove non-numeric except + and -)
        lead.phone = value.replace(/[^\d+\-\s()]/g, '');
        break;
        
      case 'firstName':
        lead.firstName = value;
        break;
        
      case 'lastName':
        lead.lastName = value;
        break;
        
      case 'companyName':
        lead.company.name = value;
        break;
        
      case 'companyWebsite':
        // Normalize URL
        if (!value.startsWith('http')) {
          value = 'https://' + value;
        }
        lead.company.website = value;
        break;
        
      case 'companyIndustry':
        lead.company.industry = value;
        break;
        
      case 'companySize':
        lead.company.size = value;
        break;
        
      case 'location':
        lead.company.location = value;
        break;
        
      case 'role':
        lead.role = value;
        break;
        
      case 'linkedinUrl':
        if (!value.startsWith('http')) {
          value = 'https://linkedin.com/in/' + value;
        }
        lead.linkedinUrl = value;
        break;
        
      case 'source':
        lead.source = value.toLowerCase().replace(/\s+/g, '_');
        break;
        
      case 'notes':
        lead.notes = value;
        break;
    }
  }
  
  // Handle "Name" column that might contain full name
  if (!lead.firstName && columnMappings.firstName) {
    const nameValue = String(row[headers.indexOf(columnMappings.firstName)] || '').trim();
    if (nameValue && nameValue.includes(' ')) {
      const parts = nameValue.split(/\s+/);
      lead.firstName = parts[0];
      lead.lastName = parts.slice(1).join(' ');
    } else if (nameValue) {
      lead.firstName = nameValue;
    }
  }
  
  // Generate firstName from email if still missing
  if (!lead.firstName && lead.email) {
    const emailPart = lead.email.split('@')[0];
    lead.firstName = emailPart.charAt(0).toUpperCase() + emailPart.slice(1);
  }
  
  // Generate a placeholder email if missing but has name
  if (!lead.email && lead.firstName) {
    lead.email = `${lead.firstName.toLowerCase().replace(/\s+/g, '')}@unknown.com`;
  }
  
  // Only require firstName or email to be valid
  const hasRequiredData = lead.firstName || lead.email;
  
  console.log('Cleaned lead:', { firstName: lead.firstName, email: lead.email, valid: hasRequiredData });
  
  return hasRequiredData ? lead : null;
};

/**
 * Process imported leads - main entry point
 */
const processLeadImport = async (buffer, filename, options = {}) => {
  console.log('=== LEAD IMPORTER ===');
  console.log('Processing file:', filename);
  
  // Parse the Excel file
  const { headers, rows, totalRows } = parseExcelBuffer(buffer, filename);
  console.log('Headers found:', headers);
  console.log('Total rows:', totalRows);
  
  // Get column mappings
  const { mappings, unmappedColumns } = mapColumns(headers);
  console.log('Auto-mapped columns:', mappings);
  console.log('Unmapped columns:', unmappedColumns);
  
  // Use AI to map any remaining columns if enabled
  let aiMappings = {};
  if (options.useAI !== false && unmappedColumns.length > 0) {
    console.log('Using AI to map unmapped columns...');
    aiMappings = await aiMapColumns(headers, unmappedColumns);
    console.log('AI mappings:', aiMappings);
  }
  
  // Merge mappings
  const finalMappings = { ...mappings };
  for (const [header, field] of Object.entries(aiMappings)) {
    if (field !== 'IGNORE' && !Object.values(finalMappings).includes(header)) {
      finalMappings[field] = header;
    }
  }
  console.log('Final mappings:', finalMappings);
  
  // Process each row
  const validLeads = [];
  const skippedRows = [];
  const duplicateEmails = new Set();
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lead = cleanLeadRow(row, headers, finalMappings);
    
    if (lead) {
      // Check for duplicate emails
      if (lead.email && duplicateEmails.has(lead.email)) {
        skippedRows.push({ row: i + 2, reason: 'Duplicate email' });
        continue;
      }
      
      if (lead.email) {
        duplicateEmails.add(lead.email);
      }
      
      validLeads.push(lead);
    } else {
      skippedRows.push({ row: i + 2, reason: 'Missing required data (name, email, or company)' });
    }
  }
  
  return {
    success: true,
    data: {
      leads: validLeads,
      stats: {
        totalRows,
        imported: validLeads.length,
        skipped: skippedRows.length,
        duplicates: skippedRows.filter(r => r.reason.includes('Duplicate')).length
      },
      columnMappings: finalMappings,
      skippedRows: skippedRows.slice(0, 10) // Only return first 10 skipped rows
    }
  };
};

/**
 * Preview import without saving - shows what will be imported
 */
const previewImport = async (buffer, filename) => {
  const result = await processLeadImport(buffer, filename, { useAI: true });
  
  return {
    success: true,
    data: {
      preview: result.data.leads.slice(0, 5), // Show first 5 leads
      stats: result.data.stats,
      columnMappings: result.data.columnMappings,
      skippedRows: result.data.skippedRows
    }
  };
};

module.exports = {
  parseExcelBuffer,
  mapColumns,
  aiMapColumns,
  cleanLeadRow,
  processLeadImport,
  previewImport
};
