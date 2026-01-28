/**
 * Canvas-based Poster Service
 * Creates posters by overlaying text on template images
 * Much more reliable than AI image generation for template-based posters
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');

/**
 * Parse content string into structured data
 * @param {string} content - Raw content string
 * @returns {Object} Structured content object
 */
function parseContent(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const result = {
    title: '',
    subtitle: '',
    date: '',
    time: '',
    venue: '',
    fees: '',
    topics: [],
    contact: '',
    whatsapp: '',
    other: []
  };
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    if (lowerLine.includes('program:') || lowerLine.includes('workshop') || lowerLine.includes('event:')) {
      result.title = line.replace(/^(program:|event:)/i, '').trim();
    } else if (lowerLine.includes('date:')) {
      result.date = line;
    } else if (lowerLine.includes('time:')) {
      result.time = line;
    } else if (lowerLine.includes('venue:') || lowerLine.includes('location:')) {
      result.venue = line;
    } else if (lowerLine.includes('fee') || lowerLine.includes('rs.') || lowerLine.includes('₹')) {
      result.fees = line;
    } else if (lowerLine.includes('contact:') || lowerLine.includes('phone:') || /^\d{10}$/.test(line.trim())) {
      result.contact = line;
    } else if (lowerLine.includes('whatsapp') || lowerLine.includes('chat.whatsapp')) {
      result.whatsapp = line;
    } else if (/^\d+\./.test(line.trim())) {
      result.topics.push(line.trim());
    } else if (lowerLine.includes('topics')) {
      // Skip the "Topics covered:" header
      continue;
    } else if (!result.title && line.length > 10) {
      result.title = line;
    } else {
      result.other.push(line);
    }
  }
  
  return result;
}

/**
 * Analyze template image to detect text regions (simplified version)
 * In a production app, you'd use AI vision to detect these regions
 * @param {Image} templateImage - Loaded template image
 * @returns {Object} Detected regions for text placement
 */
function getDefaultTextRegions(width, height) {
  // Standard template regions (works for most poster templates)
  return {
    header: {
      x: width * 0.05,
      y: height * 0.12,
      width: width * 0.9,
      height: height * 0.08,
      align: 'center',
      fontSize: Math.floor(height * 0.035),
      color: '#1a237e',
      fontWeight: 'bold'
    },
    title: {
      x: width * 0.05,
      y: height * 0.22,
      width: width * 0.9,
      height: height * 0.08,
      align: 'center',
      fontSize: Math.floor(height * 0.04),
      color: '#c62828',
      fontWeight: 'bold'
    },
    dateTime: {
      x: width * 0.05,
      y: height * 0.32,
      width: width * 0.9,
      height: height * 0.1,
      align: 'center',
      fontSize: Math.floor(height * 0.028),
      color: '#1565c0',
      fontWeight: 'bold'
    },
    fees: {
      x: width * 0.05,
      y: height * 0.44,
      width: width * 0.9,
      height: height * 0.05,
      align: 'center',
      fontSize: Math.floor(height * 0.03),
      color: '#c62828',
      fontWeight: 'bold'
    },
    content: {
      x: width * 0.05,
      y: height * 0.52,
      width: width * 0.9,
      height: height * 0.35,
      align: 'left',
      fontSize: Math.floor(height * 0.022),
      color: '#1a237e',
      fontWeight: 'normal',
      lineHeight: 1.6
    },
    footer: {
      x: width * 0.05,
      y: height * 0.88,
      width: width * 0.9,
      height: height * 0.1,
      align: 'center',
      fontSize: Math.floor(height * 0.02),
      color: '#f57c00',
      fontWeight: 'normal'
    }
  };
}

/**
 * Draw text with word wrapping
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} text - Text to draw
 * @param {Object} region - Region configuration
 */
function drawWrappedText(ctx, text, region) {
  const words = text.split(' ');
  let line = '';
  let y = region.y;
  const lineHeight = region.fontSize * (region.lineHeight || 1.4);
  
  ctx.font = `${region.fontWeight || 'normal'} ${region.fontSize}px Arial, sans-serif`;
  ctx.fillStyle = region.color;
  ctx.textAlign = region.align || 'left';
  
  const x = region.align === 'center' ? region.x + region.width / 2 : 
            region.align === 'right' ? region.x + region.width : region.x;
  
  for (const word of words) {
    const testLine = line + word + ' ';
    const metrics = ctx.measureText(testLine);
    
    if (metrics.width > region.width && line !== '') {
      ctx.fillText(line.trim(), x, y);
      line = word + ' ';
      y += lineHeight;
      
      // Stop if we exceed the region height
      if (y > region.y + region.height) break;
    } else {
      line = testLine;
    }
  }
  
  if (line.trim() && y <= region.y + region.height) {
    ctx.fillText(line.trim(), x, y);
  }
  
  return y + lineHeight; // Return next Y position
}

/**
 * Generate poster by overlaying content on template
 * @param {string} templateBase64 - Template image in base64
 * @param {string} content - Content to add to poster
 * @param {Object} options - Options like platform, style
 * @returns {Promise<{success: boolean, imageBase64?: string, error?: string}>}
 */
async function generatePosterFromTemplate(templateBase64, content, options = {}) {
  try {
    console.log('🎨 Generating poster using Canvas overlay...');
    
    // Load the template image
    let imageBuffer;
    if (templateBase64.startsWith('data:')) {
      const base64Data = templateBase64.split(',')[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      imageBuffer = Buffer.from(templateBase64, 'base64');
    }
    
    const templateImage = await loadImage(imageBuffer);
    const width = templateImage.width;
    const height = templateImage.height;
    
    // Create canvas with same dimensions as template
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw the template as background
    ctx.drawImage(templateImage, 0, 0, width, height);
    
    // Parse the content
    const parsedContent = parseContent(content);
    
    // Get text regions (in future, use AI to detect these from template)
    const regions = getDefaultTextRegions(width, height);
    
    // Check if we should use overlay mode or full replacement mode
    if (options.overlayOnly) {
      // Only overlay on specific white/content areas
      // This preserves the template header and logos
      
      // Draw semi-transparent content box
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillRect(
        width * 0.03, 
        height * 0.18, 
        width * 0.94, 
        height * 0.72
      );
      
      // Add border
      ctx.strokeStyle = '#c62828';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        width * 0.03, 
        height * 0.18, 
        width * 0.94, 
        height * 0.72
      );
    }
    
    // Draw title if available
    if (parsedContent.title) {
      drawWrappedText(ctx, parsedContent.title, regions.title);
    }
    
    // Draw date and time
    let nextY = regions.dateTime.y;
    if (parsedContent.date) {
      ctx.font = `bold ${regions.dateTime.fontSize}px Arial, sans-serif`;
      ctx.fillStyle = regions.dateTime.color;
      ctx.textAlign = 'center';
      ctx.fillText(parsedContent.date, width / 2, nextY);
      nextY += regions.dateTime.fontSize * 1.5;
    }
    if (parsedContent.time) {
      ctx.fillText(parsedContent.time, width / 2, nextY);
      nextY += regions.dateTime.fontSize * 1.5;
    }
    
    // Draw fees
    if (parsedContent.fees) {
      ctx.font = `bold ${regions.fees.fontSize}px Arial, sans-serif`;
      ctx.fillStyle = regions.fees.color;
      ctx.textAlign = 'center';
      ctx.fillText(parsedContent.fees, width / 2, regions.fees.y);
    }
    
    // Draw topics
    if (parsedContent.topics.length > 0) {
      let topicY = regions.content.y;
      ctx.font = `bold ${regions.content.fontSize * 1.1}px Arial, sans-serif`;
      ctx.fillStyle = '#2e7d32';
      ctx.textAlign = 'center';
      ctx.fillText('Topics Covered:', width / 2, topicY);
      topicY += regions.content.fontSize * 2;
      
      ctx.font = `${regions.content.fontSize}px Arial, sans-serif`;
      ctx.fillStyle = regions.content.color;
      ctx.textAlign = 'left';
      
      for (const topic of parsedContent.topics) {
        if (topicY > regions.content.y + regions.content.height) break;
        ctx.fillText(topic, regions.content.x + 20, topicY);
        topicY += regions.content.fontSize * 1.6;
      }
    }
    
    // Draw contact info
    let footerY = regions.footer.y;
    if (parsedContent.contact) {
      ctx.font = `${regions.footer.fontSize}px Arial, sans-serif`;
      ctx.fillStyle = '#1a237e';
      ctx.textAlign = 'center';
      ctx.fillText(parsedContent.contact, width / 2, footerY);
      footerY += regions.footer.fontSize * 1.5;
    }
    if (parsedContent.whatsapp) {
      ctx.fillStyle = regions.footer.color;
      ctx.fillText(parsedContent.whatsapp, width / 2, footerY);
    }
    
    // Convert canvas to base64
    const outputBuffer = canvas.toBuffer('image/png');
    const outputBase64 = `data:image/png;base64,${outputBuffer.toString('base64')}`;
    
    console.log('✅ Poster generated successfully using Canvas');
    
    return {
      success: true,
      imageBase64: outputBase64,
      model: 'canvas-overlay',
      method: 'programmatic'
    };
    
  } catch (error) {
    console.error('❌ Canvas poster generation failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Edit poster by modifying specific text elements
 * @param {string} currentImageBase64 - Current poster image
 * @param {string} originalContent - Original content
 * @param {string} editInstructions - What to change
 * @param {string} templateBase64 - Original template (optional)
 * @returns {Promise<{success: boolean, imageBase64?: string, error?: string}>}
 */
async function editPosterFromTemplate(currentImageBase64, originalContent, editInstructions, templateBase64 = null) {
  try {
    console.log('✏️ Editing poster using Canvas...');
    console.log('📝 Instructions:', editInstructions);
    
    // If we have the original template, regenerate with modified content
    if (templateBase64) {
      // Apply edit instructions to content
      let modifiedContent = originalContent;
      const lowerInstructions = editInstructions.toLowerCase();
      
      // Parse common edit instructions
      if (lowerInstructions.includes('change date to')) {
        const match = editInstructions.match(/change date to[:\s]+(.+)/i);
        if (match) {
          modifiedContent = modifiedContent.replace(/Date:[^\n]+/i, `Date: ${match[1]}`);
        }
      }
      if (lowerInstructions.includes('change time to')) {
        const match = editInstructions.match(/change time to[:\s]+(.+)/i);
        if (match) {
          modifiedContent = modifiedContent.replace(/Time:[^\n]+/i, `Time: ${match[1]}`);
        }
      }
      if (lowerInstructions.includes('change fee') || lowerInstructions.includes('change price')) {
        const match = editInstructions.match(/change (?:fee|price) to[:\s]+(.+)/i);
        if (match) {
          modifiedContent = modifiedContent.replace(/(?:Training fees?|Fee|Price):[^\n]+/i, `Training Fees: ${match[1]}`);
        }
      }
      if (lowerInstructions.includes('change title to')) {
        const match = editInstructions.match(/change title to[:\s]+(.+)/i);
        if (match) {
          // Replace the first significant line (title)
          const lines = modifiedContent.split('\n');
          if (lines.length > 0) {
            lines[0] = match[1];
            modifiedContent = lines.join('\n');
          }
        }
      }
      
      // Regenerate with modified content
      return await generatePosterFromTemplate(templateBase64, modifiedContent, { overlayOnly: true });
    }
    
    // If no template, we can't reliably edit - return error
    return {
      success: false,
      error: 'Original template is required for editing. Please regenerate the poster.'
    };
    
  } catch (error) {
    console.error('❌ Canvas poster edit failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  generatePosterFromTemplate,
  editPosterFromTemplate,
  parseContent
};
