const fs = require('fs');
const { JSDOM } = require('jsdom');

function extractAndSaveLinks(htmlFilePath, outputFilePath) {
    try {
        // Read the HTML file
        console.log(`Reading HTML file: ${htmlFilePath}`);
        const html = fs.readFileSync(htmlFilePath, 'utf8');
        
        // Parse HTML using JSDOM
        const dom = new JSDOM(html);
        const document = dom.window.document;
        
        // Find all anchor tags with the specified class
        const anchors = document.querySelectorAll('a.shortsLockupViewModelHostEndpoint');
        
        // Extract href attributes and filter out empty/null values
        const links = Array.from(anchors)
            .map(anchor => anchor.href)
            .filter(href => href && href.trim() !== '');
        
        console.log(`Found ${links.length} links with class 'shortsLockupViewModelHostEndpoint'`);
        
        if (links.length === 0) {
            console.log('No links found. No file will be created.');
            return;
        }
        
        // Prepare content for text file (one URL per line)
        const content = links.join('\n');
        
        // Write to text file
        fs.writeFileSync(outputFilePath, content, 'utf8');
        
        console.log(`Successfully wrote ${links.length} URLs to: ${outputFilePath}`);
        
        // Display first few links for verification
        console.log('\nFirst 5 links extracted:');
        links.slice(0, 5).forEach((link, index) => {
            console.log(`${index + 1}: ${link}`);
        });
        
        if (links.length > 5) {
            console.log(`... and ${links.length - 5} more`);
        }
        
        return links;
        
    } catch (error) {
        console.error('Error:', error.message);
        
        if (error.code === 'ENOENT') {
            console.error('File not found. Please check the file path.');
        }
        
        return [];
    }
}

// Usage example:
const htmlFile = 'nutshell.html'; // Replace with your HTML file path
const outputFile = 'nutshell.txt'; // Output text file name

extractAndSaveLinks(htmlFile, outputFile);