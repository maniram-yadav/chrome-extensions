const fs = require('fs');
const path = require('path');

function extractAllAnchorTags(htmlFileName, outputFileName) {
    try {
        // Read the HTML file
        const htmlContent = fs.readFileSync(htmlFileName, 'utf8');
        
        // Regular expression to match all anchor tags
        const anchorTagRegex = /<a\s+[^>]*>.*?<\/a>/gi;
        
        const anchorTags = [];
        let match;
        
        // Extract all anchor tags
        while ((match = anchorTagRegex.exec(htmlContent)) !== null) {
            anchorTags.push(match[0]);
        }
        
        // Write anchor tags to the output text file
        if (anchorTags.length > 0) {
            fs.writeFileSync(outputFileName, anchorTags.join('\n\n'), 'utf8');
            console.log(`Successfully extracted ${anchorTags.length} anchor tags to ${outputFileName}`);
        } else {
            fs.writeFileSync(outputFileName, '', 'utf8');
            console.log('No anchor tags found in the HTML file.');
        }
        
        return anchorTags;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// Enhanced version that extracts anchor tags with their content and attributes
function extractAnchorTagsWithDetails(htmlFileName, outputFileName) {
    try {
        const htmlContent = fs.readFileSync(htmlFileName, 'utf8');
        
        // Improved regex to handle various anchor tag formats
        const anchorTagRegex = /<a\s+[^>]*>.*?<\/a>/gsi;
        
        const anchorTags = [];
        let match;
        
        while ((match = anchorTagRegex.exec(htmlContent)) !== null) {
            anchorTags.push(match[0].trim());
        }
        
        // Write to file with separators
        if (anchorTags.length > 0) {
            const outputContent = anchorTags.map((tag, index) => 
                `=== Anchor Tag ${index + 1} ===\n${tag}\n`
            ).join('\n');
            
            fs.writeFileSync(outputFileName, outputContent, 'utf8');
            console.log(`Successfully extracted ${anchorTags.length} anchor tags to ${outputFileName}`);
        } else {
            fs.writeFileSync(outputFileName, 'No anchor tags found.', 'utf8');
            console.log('No anchor tags found in the HTML file.');
        }
        
        return anchorTags;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// Version that extracts only the HTML of anchor tags without content
function extractAnchorTagsSimple(htmlFileName, outputFileName) {
    try {
        const htmlContent = fs.readFileSync(htmlFileName, 'utf8');
        
        // Regex for opening anchor tags only
        const anchorTagRegex = /<a\s+[^>]*>/gi;
        
        const anchorTags = [];
        let match;
        
        while ((match = anchorTagRegex.exec(htmlContent)) !== null) {
            anchorTags.push(match[0]);
        }
        
        if (anchorTags.length > 0) {
            fs.writeFileSync(outputFileName, anchorTags.join('\n'), 'utf8');
            console.log(`Successfully extracted ${anchorTags.length} anchor tags to ${outputFileName}`);
        } else {
            fs.writeFileSync(outputFileName, '', 'utf8');
            console.log('No anchor tags found in the HTML file.');
        }
        
        return anchorTags;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// Async version using promises
const fsAsync = require('fs').promises;

async function extractAllAnchorTagsAsync(htmlFileName, outputFileName) {
    try {
        // Read the HTML file
        const htmlContent = await fsAsync.readFile(htmlFileName, 'utf8');
        
        // Regular expression to match all anchor tags
        const anchorTagRegex = /<a\s+[^>]*>.*?<\/a>/gsi;
        
        const anchorTags = [];
        let match;
        
        while ((match = anchorTagRegex.exec(htmlContent)) !== null) {
            anchorTags.push(match[0].trim());
        }
        
        // Write anchor tags to the output text file
        if (anchorTags.length > 0) {
            const outputContent = anchorTags.map((tag, index) => 
                `// Anchor Tag ${index + 1}\n${tag}\n`
            ).join('\n');
            
            await fsAsync.writeFile(outputFileName, outputContent, 'utf8');
            console.log(`Successfully extracted ${anchorTags.length} anchor tags to ${outputFileName}`);
        } else {
            await fsAsync.writeFile(outputFileName, 'No anchor tags found.', 'utf8');
            console.log('No anchor tags found in the HTML file.');
        }
        
        return anchorTags;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// Function to extract and categorize anchor tags
function extractAndCategorizeAnchorTags(htmlFileName, outputFileName) {
    try {
        const htmlContent = fs.readFileSync(htmlFileName, 'utf8');
        
        const anchorTagRegex = /<a\s+[^>]*>.*?<\/a>/gsi;
        
        const anchorTags = [];
        let match;
        
        while ((match = anchorTagRegex.exec(htmlContent)) !== null) {
            const fullTag = match[0].trim();
            
            // Extract href attribute if present
            const hrefMatch = fullTag.match(/href=["']([^"']*)["']/i);
            const href = hrefMatch ? hrefMatch[1] : 'No href';
            
            // Extract text content
            const textMatch = fullTag.match(/<a[^>]*>(.*?)<\/a>/si);
            const textContent = textMatch ? textMatch[1].replace(/<[^>]*>/g, '').trim() : 'No text content';
            
            anchorTags.push({
                fullTag: fullTag,
                href: href,
                textContent: textContent
            });
        }
        
        // Write categorized information to file
        if (anchorTags.length > 0) {
            const outputContent = anchorTags.map((tag, index) => 
                `=== Anchor Tag ${index + 1} ===
Full HTML: ${tag.fullTag}
HREF: ${tag.href}
Text Content: ${tag.textContent}
`
            ).join('\n');
            
            fs.writeFileSync(outputFileName, outputContent, 'utf8');
            console.log(`Successfully extracted and categorized ${anchorTags.length} anchor tags to ${outputFileName}`);
        } else {
            fs.writeFileSync(outputFileName, 'No anchor tags found.', 'utf8');
            console.log('No anchor tags found in the HTML file.');
        }
        
        return anchorTags;
        
    } catch (error) {
        console.error('Error processing files:', error.message);
        throw error;
    }
}

// Example usage and test function
function demonstrateUsage() {
    // Create a sample HTML file for testing
    const sampleHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Test Page</title>
</head>
<body>
    <h1>Welcome to my website</h1>
    
    <nav>
        <a href="/home">Home</a>
        <a href="/about" class="nav-link">About Us</a>
        <a href="/contact" id="contact-link">Contact</a>
    </nav>
    
    <div class="content">
        <a href="https://www.google.com" target="_blank">Visit Google</a>
        <a href="https://www.instagram.com/user/reel/ABC123">
            <img src="reel-thumbnail.jpg" alt="Instagram Reel">
        </a>
        <a href="mailto:example@email.com">Email Us</a>
    </div>
    
    <footer>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
    </footer>
</body>
</html>
`;
    
    // Write sample HTML to file
    fs.writeFileSync('sample.html', sampleHTML);
    
    console.log('Testing anchor tag extraction...\n');
    
    // Test different extraction methods
    console.log('1. Extracting all anchor tags:');
    const allTags = extractAllAnchorTags('capital_zaib.html', 'all_anchor_tags.txt');
    
    // console.log('\n2. Extracting with details:');
    // const detailedTags = extractAnchorTagsWithDetails('sample.html', 'detailed_anchor_tags.txt');
    
    // console.log('\n3. Extracting and categorizing:');
    // const categorizedTags = extractAndCategorizeAnchorTags('sample.html', 'categorized_anchor_tags.txt');
    
    console.log('\nExtraction completed!');
}

// Export all functions
module.exports = {
    extractAllAnchorTags,
    extractAnchorTagsWithDetails,
    extractAnchorTagsSimple,
    extractAllAnchorTagsAsync,
    extractAndCategorizeAnchorTags,
    demonstrateUsage
};

// Run demonstration if this file is executed directly
if (require.main === module) {
    demonstrateUsage();
}