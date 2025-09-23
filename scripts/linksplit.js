const fs = require('fs');
const path = require('path');

function splitTextFile(inputFilePath, linesPerFile = 10) {
    try {
        // Read the input file
        console.log(`Reading file: ${inputFilePath}`);
        const content = fs.readFileSync(inputFilePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim() !== '');
        
        if (lines.length === 0) {
            console.log('File is empty or contains no valid lines.');
            return;
        }
        
        // Get base filename without extension
        const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
        const folderName = baseName;
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(folderName)) {
            fs.mkdirSync(folderName);
            console.log(`Created directory: ${folderName}`);
        }
        
        // Calculate number of files needed
        const totalFiles = Math.ceil(lines.length / linesPerFile);
        console.log(`Splitting ${lines.length} lines into ${totalFiles} files with ${linesPerFile} lines each`);
        
        // Split and write files
        for (let i = 0; i < totalFiles; i++) {
            const startIndex = i * linesPerFile;
            const endIndex = Math.min(startIndex + linesPerFile, lines.length);
            const chunk = lines.slice(startIndex, endIndex);
            
            const outputFileName = `${folderName}/${baseName}-${i + 1}.txt`;
            const outputContent = chunk.join('\n');
            
            fs.writeFileSync(outputFileName, outputContent, 'utf8');
            console.log(`Created: ${outputFileName} (${chunk.length} lines)`);
        }
        
        console.log(`\nSuccessfully split ${lines.length} lines into ${totalFiles} files in the '${folderName}' directory`);
        
    } catch (error) {
        console.error('Error:', error.message);
        
        if (error.code === 'ENOENT') {
            console.error('File not found. Please check the file path.');
        }
    }
}


splitTextFile("keshav.txt", 10);