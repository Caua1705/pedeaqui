const fs = require('fs');
const path = 'c:/Users/Arenapc/Desktop/PROJETOS/pedeaqui_front/junior-da-picanha.html';

function recover() {
    let content = fs.readFileSync(path);
    // The content is currently UTF-8 bytes of a string that was incorrectly converted from UTF-16LE
    // Actually, if I did `content.toString('utf16le')`, I took the original bytes and paired them up.
    
    let text = content.toString('utf8');
    console.log('Current text snippet:', text.substring(0, 20));
    
    // Convert back to buffer using utf16le
    let recoveredBytes = Buffer.from(text, 'utf16le');
    let recoveredText = recoveredBytes.toString('utf8');
    
    if (recoveredText.includes('<html') || recoveredText.includes('<!DOCTYPE')) {
        console.log('Recovery successful!');
        // Apply the fix while we are at it
        const fixed = recoveredText.replace('<div class="prod-add">+</div', '<div class="prod-add">+</div>');
        fs.writeFileSync(path, fixed, 'utf8');
        console.log('File saved as UTF-8 with fix.');
    } else {
        console.log('Recovery failed. Still looks like gibberish.');
        // Let's try the other way around just in case
        recoveredBytes = Buffer.from(text, 'utf8');
        recoveredText = recoveredBytes.toString('utf16le');
        if (recoveredText.includes('<html') || recoveredText.includes('<!DOCTYPE')) {
             console.log('Recovery successful (other way)!');
             const fixed = recoveredText.replace('<div class="prod-add">+</div', '<div class="prod-add">+</div>');
             fs.writeFileSync(path, fixed, 'utf8');
        } else {
             console.log('Totally stuck.');
        }
    }
}

recover();
