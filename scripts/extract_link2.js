const fs = require('fs');
const path = require('path');

function extractSpecificInstagramReels(htmlFileName, outputFileName, baseUrl) {
    try {
        // Read the HTML file
        const htmlContent = fs.readFileSync(htmlFileName, 'utf8');
        
        // Regular expression to match all anchor tags
        const anchorTagRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>.*?<\/a>/gi;
        
        const specificUrls = [];
        let match;
        
        // Extract all anchor tags and filter by specific URL pattern
        while ((match = anchorTagRegex.exec(htmlContent)) !== null) {
            const fullTag = match[0];
            const url = match[1];
            
            // Check if URL starts with the specified base URL
            if (url.startsWith(baseUrl)) {
                specificUrls.push(url);
            }
        }
        
        // Remove duplicates
        const uniqueUrls = [...new Set(specificUrls)];
        
        // Write specific URLs to the output text file
        if (uniqueUrls.length > 0) {
            fs.writeFileSync(outputFileName, uniqueUrls.join('\n'), 'utf8');
            console.log(`Successfully extracted ${uniqueUrls.length} specific Instagram Reels URLs to ${outputFileName}`);
            console.log(`Base URL pattern: ${baseUrl}`);
        } else {
            fs.writeFileSync(outputFileName, '', 'utf8');
            console.log(`No URLs found matching the pattern: ${baseUrl}`);
        }
        
        return uniqueUrls;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// More precise version that ensures proper Instagram Reels URL format
function extractInstagramReelsByPattern(htmlFileName, outputFileName, username) {
    try {
        const htmlContent = fs.readFileSync(htmlFileName, 'utf8');
        
        // Construct the specific base URL pattern
        const baseUrlPattern = `https://www.instagram.com/${username}/reel/`;
        
        // Regex to match anchor tags with the specific URL pattern
        const specificReelRegex = new RegExp(`<a\\s+[^>]*href=["'](${escapeRegex(baseUrlPattern)}[^"']*)["'][^>]*>`, 'gi');
        
        const reelUrls = [];
        let match;
        
        while ((match = specificReelRegex.exec(htmlContent)) !== null) {
            reelUrls.push(match[1]);
        }
        
        // Remove duplicates
        const uniqueUrls = [...new Set(reelUrls)];
        
        if (uniqueUrls.length > 0) {
            fs.writeFileSync(outputFileName, uniqueUrls.join('\n'), 'utf8');
            console.log(`Successfully extracted ${uniqueUrls.length} Instagram Reels URLs for user '${username}' to ${outputFileName}`);
        } else {
            fs.writeFileSync(outputFileName, '', 'utf8');
            console.log(`No Instagram Reels URLs found for user '${username}'`);
        }
        
        return uniqueUrls;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// Helper function to escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Advanced version with validation and filtering
function extractAndValidateInstagramReels(htmlFileName, outputFileName, baseUrlPattern) {
    try {
        const htmlContent = fs.readFileSync(htmlFileName, 'utf8');
        
        // Regex to find all anchor tags
        const anchorRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>/gi;
        
        const validReelUrls = [];
        let match;
        
        while ((match = anchorRegex.exec(htmlContent)) !== null) {
            const url = match[1];
            
            // Check if URL matches the base pattern and is a valid Instagram Reel URL
            if (url.startsWith(baseUrlPattern) && isValidInstagramReelUrl(url)) {
                validReelUrls.push(url);
            }
        }
        
        // Remove duplicates
        const uniqueUrls = [...new Set(validReelUrls)];
        
        if (uniqueUrls.length > 0) {
            const outputContent = `# Instagram Reels URLs matching pattern: ${baseUrlPattern}\n# Extracted on: ${new Date().toISOString()}\n# Total URLs found: ${uniqueUrls.length}\n\n${uniqueUrls.join('\n')}`;
            
            fs.writeFileSync(outputFileName, outputContent, 'utf8');
            console.log(`✅ Successfully extracted ${uniqueUrls.length} valid Instagram Reels URLs`);
            console.log(`📁 Output file: ${outputFileName}`);
            console.log(`🔍 Pattern: ${baseUrlPattern}`);
        } else {
            fs.writeFileSync(outputFileName, `# No Instagram Reels URLs found matching pattern: ${baseUrlPattern}\n# Search performed on: ${new Date().toISOString()}`, 'utf8');
            console.log(`❌ No valid Instagram Reels URLs found matching pattern: ${baseUrlPattern}`);
        }
        
        return uniqueUrls;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// Validation function for Instagram Reel URLs
function isValidInstagramReelUrl(url) {
    const reelUrlPattern = /^https:\/\/www\.instagram\.com\/[a-zA-Z0-9_.]+\/reel\/[a-zA-Z0-9_-]+\/?$/;
    return reelUrlPattern.test(url.split('?')[0]); // Ignore query parameters
}

// Async version using promises
const fsAsync = require('fs').promises;

async function extractSpecificReelsAsync(htmlFileName, outputFileName, baseUrl) {
    try {
        const htmlContent = await fsAsync.readFile(htmlFileName, 'utf8');
        
        const anchorTagRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>/gi;
        
        const specificUrls = [];
        let match;
        
        while ((match = anchorTagRegex.exec(htmlContent)) !== null) {
            const url = match[1];
            if (url.startsWith(baseUrl)) {
                specificUrls.push(url);
            }
        }
        
        const uniqueUrls = [...new Set(specificUrls)];
        
        if (uniqueUrls.length > 0) {
            const header = `# Extracted Instagram Reels URLs\n# Base Pattern: ${baseUrl}\n# Count: ${uniqueUrls.length}\n# Date: ${new Date().toISOString()}\n\n`;
            await fsAsync.writeFile(outputFileName, header + uniqueUrls.join('\n'), 'utf8');
            console.log(`✅ Extracted ${uniqueUrls.length} URLs to ${outputFileName}`);
        } else {
            await fsAsync.writeFile(outputFileName, `# No URLs found matching: ${baseUrl}\n`, 'utf8');
            console.log(`❌ No URLs found for pattern: ${baseUrl}`);
        }
        
        return uniqueUrls;
        
    } catch (error) {
        console.error('Error:', error.message);
        throw error;
    }
}

// Example usage function
function demonstrateExtraction() {
    const htmlFile = 'capital_zaib.html';
    const outputFile = 'instagram/capital_zaib_reels.txt';
    const baseUrl = 'https://www.instagram.com/capital_zaib/reel/';
    
    console.log('🔍 Extracting Instagram Reels URLs...');
    console.log(`📄 Input file: ${htmlFile}`);
    console.log(`💾 Output file: ${outputFile}`);
    console.log(`🎯 URL pattern: ${baseUrl}`);
    console.log('─'.repeat(50));
    
    try {
        const extractedUrls = extractSpecificInstagramReels(htmlFile, outputFile, baseUrl);
        
        // if (extractedUrls.length > 0) {
        //     console.log('\n📋 Extracted URLs:');
        //     extractedUrls.forEach((url, index) => {
        //         console.log(`${index + 1}. ${url}`);
        //     });
        // }
        console.log("All urls extracted successfully.");
        
    } catch (error) {
        console.error('❌ Extraction failed:', error.message);
    }
}

// Function to process multiple files
function extractFromMultipleFiles(fileList, outputFileName, baseUrl) {
    const allUrls = [];
    
    fileList.forEach(file => {
        try {
            if (fs.existsSync(file)) {
                const urls = extractSpecificInstagramReels(file, `${file}_temp.txt`, baseUrl);
                allUrls.push(...urls);
                console.log(`Processed ${file}: found ${urls.length} URLs`);
            } else {
                console.log(`File not found: ${file}`);
            }
        } catch (error) {
            console.error(`Error processing ${file}:`, error.message);
        }
    });
    
    // Combine all URLs and remove duplicates
    const uniqueUrls = [...new Set(allUrls)];
    
    if (uniqueUrls.length > 0) {
        fs.writeFileSync(outputFileName, uniqueUrls.join('\n'), 'utf8');
        console.log(`\n✅ Combined ${uniqueUrls.length} unique URLs from ${fileList.length} files into ${outputFileName}`);
    }
    
    return uniqueUrls;
}

// Export functions
module.exports = {
    extractSpecificInstagramReels,
    extractInstagramReelsByPattern,
    extractAndValidateInstagramReels,
    extractSpecificReelsAsync,
    extractFromMultipleFiles,
    demonstrateExtraction
};

// Run demonstration if executed directly
if (require.main === module) {
    demonstrateExtraction();
}